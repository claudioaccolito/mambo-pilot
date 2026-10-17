import {
  CHARS,
  CMD,
  DATA_TYPE,
  FLIP_DIRECTIONS,
  HANDSHAKE,
  SERVICES,
  buildAck,
  buildPacket,
  buildPcmd,
  parsePacket,
  type Arg,
  type CmdId,
  type DroneEvent,
  type FlipDirection,
} from './protocol';

export type Pcmd = { roll: number; pitch: number; yaw: number; gaz: number };
type Listener = (e: DroneEvent) => void;

const PCMD_INTERVAL_MS = 50; // 20 Hz, come l'app originale

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

/**
 * Connessione Web Bluetooth a un Parrot Mambo.
 * - Le scritture GATT sono serializzate (Web Bluetooth non ne accetta due insieme).
 * - Il PCMD viene inviato in loop a 20 Hz finché si è connessi.
 */
export class MamboConnection {
  private device: BluetoothDevice | null = null;
  private chars = new Map<string, BluetoothRemoteGATTCharacteristic>();
  private seq = { noAck: 0, withAck: 0, high: 0, ack: 0 };
  private queue: Promise<unknown> = Promise.resolve();
  private pcmdTimer: number | null = null;
  private listeners = new Set<Listener>();
  private disconnectListeners = new Set<() => void>();
  private errorListeners = new Set<(msg: string) => void>();

  /** Diagnostica: scritture riuscite/fallite e proprietà delle caratteristiche di invio. */
  stats = { ok: 0, failed: 0, rx: 0, lastRx: '', notifyFailed: [] as string[], lastError: '', props: {} as Record<string, string> };

  /** Valore corrente degli stick, letto dal loop PCMD. */
  pcmd: Pcmd = { roll: 0, pitch: 0, yaw: 0, gaz: 0 };

  /** Ultimi id accessori riportati dal drone (default 0). */
  clawId = 0;
  gunId = 0;

  get connected(): boolean {
    return !!this.device?.gatt?.connected;
  }

  get name(): string {
    return this.device?.name ?? '';
  }

  onEvent(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onError(fn: (msg: string) => void): () => void {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  onDisconnect(fn: () => void): () => void {
    this.disconnectListeners.add(fn);
    return () => this.disconnectListeners.delete(fn);
  }

  async connect(): Promise<void> {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'Mambo' }, { namePrefix: 'Swing' }, { namePrefix: 'RS_' }],
      optionalServices: Object.values(SERVICES),
    });
    this.device = device;
    device.addEventListener('gattserverdisconnected', this.handleDisconnect);

    const server = await connectWithRetry(device);

    // Caratteristiche di invio
    const sendSvc = await server.getPrimaryService(SERVICES.send);
    for (const uuid of [CHARS.sendNoAck, CHARS.sendWithAck, CHARS.sendHighPriority, CHARS.ackCommand]) {
      const c = await sendSvc.getCharacteristic(uuid);
      this.chars.set(uuid, c);
      const p = c.properties;
      this.stats.props[uuid.slice(4, 8)] = [p.write && 'write', p.writeWithoutResponse && 'writeNoResp', p.notify && 'notify']
        .filter(Boolean)
        .join('+');
    }

    // Handshake: il drone accetta comandi solo dopo che le notifiche sono attive
    for (const group of HANDSHAKE) {
      let svc: BluetoothRemoteGATTService;
      try {
        svc = await server.getPrimaryService(group.service);
      } catch {
        continue; // servizi FTP opzionali a seconda del firmware
      }
      for (const uuid of group.chars) {
        try {
          const c = await svc.getCharacteristic(uuid);
          await c.startNotifications();
          if (group.service === SERVICES.receive) {
            c.addEventListener('characteristicvaluechanged', (ev) =>
              this.handleNotification(uuid, (ev.target as BluetoothRemoteGATTCharacteristic).value!),
            );
          }
        } catch (err) {
          console.warn('Notifica non attivabile', uuid, err);
          this.stats.notifyFailed.push(uuid.slice(4, 8));
        }
      }
    }

    // Inizializzazione come fa l'app ufficiale: data/ora e richiesta stati
    const now = new Date();
    await this.send(CMD.currentDate, [{ t: 'string', v: now.toISOString().slice(0, 10) }]);
    await this.send(CMD.currentTime, [{ t: 'string', v: isoTime(now) }]);
    await this.send(CMD.allSettings);
    await this.send(CMD.allStates);

    this.startPcmdLoop();
  }

  disconnect(): void {
    this.stopPcmdLoop();
    this.device?.gatt?.disconnect();
  }

  // ---------------- comandi di alto livello

  takeOff = () => this.send(CMD.takeOff);
  land = () => this.send(CMD.landing);
  flatTrim = () => this.send(CMD.flatTrim);
  takePicture = () => this.send(CMD.pictureV2);

  /** Taglia i motori. Usa il canale ad alta priorità. */
  emergency = () => this.write(CHARS.sendHighPriority, buildPacket(DATA_TYPE.dataWithAck, ++this.seq.high, CMD.emergency));

  flip = (dir: FlipDirection) => this.send(CMD.flip, [{ t: 'enum', v: FLIP_DIRECTIONS.indexOf(dir) }]);

  openClaw = () => this.send(CMD.clawControl, [{ t: 'u8', v: this.clawId }, { t: 'enum', v: 0 }]);
  closeClaw = () => this.send(CMD.clawControl, [{ t: 'u8', v: this.clawId }, { t: 'enum', v: 1 }]);
  fireGun = () => this.send(CMD.gunControl, [{ t: 'u8', v: this.gunId }, { t: 'enum', v: 0 }]);

  /** Inclinazione massima in gradi (5–25): più alta = più veloce. */
  setMaxTilt = (deg: number) => this.send(CMD.maxTilt, [{ t: 'float', v: deg }]);
  /** Velocità verticale massima in m/s (0.5–2). */
  setMaxVerticalSpeed = (v: number) => this.send(CMD.maxVerticalSpeed, [{ t: 'float', v }]);
  /** Velocità di rotazione massima in °/s (50–360). */
  setMaxRotationSpeed = (v: number) => this.send(CMD.maxRotationSpeed, [{ t: 'float', v }]);

  // ---------------- interni

  private send(cmd: CmdId, args: Arg[] = []): Promise<void> {
    this.seq.withAck = (this.seq.withAck + 1) & 0xff;
    return this.write(CHARS.sendWithAck, buildPacket(DATA_TYPE.dataWithAck, this.seq.withAck, cmd, args));
  }

  /**
   * Scrive un pacchetto. Come pyparrot, usa la scrittura senza conferma quando la
   * caratteristica la supporta (il Mambo la preferisce); altrimenti quella con conferma.
   */
  private write(uuid: string, packet: Uint8Array): Promise<void> {
    const c = this.chars.get(uuid);
    if (!c || !this.connected) return Promise.resolve();
    const noResp = c.properties.writeWithoutResponse || !c.properties.write;
    const op = this.queue.then(() =>
      noResp ? c.writeValueWithoutResponse(packet as BufferSource) : c.writeValueWithResponse(packet as BufferSource),
    );
    const done = op.then(
      () => {
        this.stats.ok++;
      },
      (err: unknown) => {
        this.stats.failed++;
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        this.stats.lastError = `${uuid.slice(4, 8)} · ${msg}`;
        console.warn('Scrittura BLE fallita', uuid, err);
        for (const l of this.errorListeners) l(this.stats.lastError);
      },
    );
    // la coda non si blocca se una scrittura fallisce
    this.queue = done;
    return done;
  }

  private startPcmdLoop() {
    this.stopPcmdLoop();
    let busy = false;
    this.pcmdTimer = window.setInterval(async () => {
      if (busy || !this.connected) return; // salta un tick se il BLE è lento
      busy = true;
      this.seq.noAck = (this.seq.noAck + 1) & 0xff;
      const { roll, pitch, yaw, gaz } = this.pcmd;
      await this.write(CHARS.sendNoAck, buildPcmd(this.seq.noAck, roll, pitch, yaw, gaz));
      busy = false;
    }, PCMD_INTERVAL_MS);
  }

  private stopPcmdLoop() {
    if (this.pcmdTimer !== null) clearInterval(this.pcmdTimer);
    this.pcmdTimer = null;
  }

  private handleNotification(uuid: string, value: DataView) {
    this.stats.rx++;
    this.stats.lastRx = `${uuid.slice(4, 8)}: ${Array.from(new Uint8Array(value.buffer, value.byteOffset, Math.min(value.byteLength, 10)), (b) => b.toString(16).padStart(2, '0')).join(' ')}`;
    const { type, seq, event } = parsePacket(value);
    // I dati su fb0e vanno confermati sul canale fa1e
    if (uuid === CHARS.ackDroneData && type === DATA_TYPE.dataWithAck) {
      this.seq.ack = (this.seq.ack + 1) & 0xff;
      void this.write(CHARS.ackCommand, buildAck(this.seq.ack, seq));
    }
    if (!event || event.kind === 'unknown') return;
    if (event.kind === 'claw') this.clawId = event.id;
    if (event.kind === 'gun') this.gunId = event.id;
    for (const l of this.listeners) l(event);
  }

  private handleDisconnect = () => {
    this.stopPcmdLoop();
    this.chars.clear();
    for (const l of this.disconnectListeners) l();
  };
}

function isoTime(d: Date): string {
  // formato ISO-8601 di base, es. T214530+0200
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}${pad(Math.abs(off) % 60)}`;
}

/** Su Android il primo tentativo GATT fallisce spesso: riprova qualche volta prima di arrendersi. */
export async function connectWithRetry(device: BluetoothDevice, attempts = 4): Promise<BluetoothRemoteGATTServer> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      if (device.gatt!.connected) device.gatt!.disconnect();
      return await device.gatt!.connect();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 800 + i * 700));
    }
  }
  throw lastErr;
}
