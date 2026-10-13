import { MamboConnection, isWebBluetoothSupported, type Pcmd } from './mambo/connection';
import type { AlertState, FlipDirection, FlyingState } from './mambo/protocol';

export type Action = 'takeOff' | 'land' | 'takePicture' | 'openClaw' | 'closeClaw' | 'fireGun' | `flip:${FlipDirection}`;

type Step = { t: number } & ({ type: 'pcmd'; v: Pcmd } | { type: 'action'; a: Action });
export type Recording = { name: string; createdAt: number; durationMs: number; steps: Step[] };

const STORAGE_KEY = 'mambo.recordings';
const SAMPLE_MS = 50;

function loadRecordings(): Recording[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveRecordings(list: Recording[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage non disponibile: le registrazioni restano solo in memoria */
  }
}

class DroneStore {
  /** ?demo nell'URL: simula un drone, per provare l'interfaccia senza Bluetooth. */
  readonly demo = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');
  readonly supported = this.demo || isWebBluetoothSupported();
  readonly conn = new MamboConnection();

  status = $state<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  error = $state('');
  name = $state('');
  battery = $state<number | null>(null);
  flying = $state<FlyingState>('landed');
  alert = $state<AlertState>('none');
  altitude = $state<number | null>(null);
  pictureReady = $state(true);
  lastPicture = $state<'' | 'ok' | string>('');
  photoCount = $state<number | null>(null);
  claw = $state<string>('');
  gun = $state<string>('');

  // stick: sinistro = gaz/yaw, destro = pitch/roll
  sticks = $state<Pcmd>({ roll: 0, pitch: 0, yaw: 0, gaz: 0 });

  // registrazione e replay
  recordings = $state<Recording[]>(loadRecordings());
  recording = $state(false);
  replaying = $state<string | null>(null);
  replayProgress = $state(0);

  private recSteps: Step[] = [];
  private recStart = 0;
  private recTimer: number | null = null;
  private replayTimers: number[] = [];

  get isAirborne() {
    return ['takingoff', 'hovering', 'flying'].includes(this.flying);
  }

  constructor() {
    this.conn.onEvent((e) => {
      switch (e.kind) {
        case 'battery': this.battery = e.percent; break;
        case 'flyingState': this.flying = e.state; break;
        case 'alert': this.alert = e.state; break;
        case 'altitude': this.altitude = e.meters; break;
        case 'pictureState': this.pictureReady = e.ready; break;
        case 'pictureEvent':
          this.lastPicture = e.taken ? 'ok' : e.error;
          if (e.taken && this.photoCount !== null) this.photoCount++;
          break;
        case 'photoCount': this.photoCount = e.count; break;
        case 'claw': this.claw = e.state; break;
        case 'gun': this.gun = e.state; break;
      }
    });
    this.conn.onDisconnect(() => {
      this.stopReplay();
      this.stopRecording(false);
      this.status = 'idle';
      this.flying = 'landed';
    });
  }

  async connect() {
    this.status = 'connecting';
    this.error = '';
    if (this.demo) {
      this.name = 'Mambo_DEMO';
      this.battery = 78;
      this.photoCount = 3;
      this.status = 'connected';
      return;
    }
    try {
      await this.conn.connect();
      this.name = this.conn.name;
      this.status = 'connected';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // annullato dall'utente: nessun errore da mostrare
      if (/cancel|chosen/i.test(msg)) {
        this.status = 'idle';
      } else {
        this.status = 'error';
        this.error = msg;
      }
    }
  }

  disconnect() {
    if (this.demo) {
      this.status = 'idle';
      return;
    }
    this.conn.disconnect();
  }

  /** Aggiorna gli stick dall'utente: interrompe un eventuale replay. */
  setSticks(partial: Partial<Pcmd>) {
    if (this.replaying) this.stopReplay();
    this.applySticks({ ...this.sticks, ...partial });
  }

  do(action: Action) {
    if (this.replaying) this.stopReplay();
    this.run(action);
    if (this.recording) this.recSteps.push({ t: performance.now() - this.recStart, type: 'action', a: action });
  }

  emergency() {
    this.stopReplay();
    this.applySticks({ roll: 0, pitch: 0, yaw: 0, gaz: 0 });
    void this.conn.emergency();
  }

  // ---------------- registrazione

  startRecording() {
    if (this.replaying) return;
    this.recSteps = [];
    this.recStart = performance.now();
    this.recording = true;
    let last = '';
    this.recTimer = window.setInterval(() => {
      const key = JSON.stringify(this.sticks);
      if (key !== last) {
        this.recSteps.push({ t: performance.now() - this.recStart, type: 'pcmd', v: { ...this.sticks } });
        last = key;
      }
    }, SAMPLE_MS);
  }

  stopRecording(save = true) {
    if (!this.recording) return;
    if (this.recTimer !== null) clearInterval(this.recTimer);
    this.recTimer = null;
    this.recording = false;
    const durationMs = performance.now() - this.recStart;
    if (!save || this.recSteps.length === 0) return;
    const steps = [...this.recSteps, { t: durationMs, type: 'pcmd' as const, v: { roll: 0, pitch: 0, yaw: 0, gaz: 0 } }];
    const rec: Recording = {
      name: `Percorso ${this.recordings.length + 1}`,
      createdAt: Date.now(),
      durationMs,
      steps,
    };
    this.recordings = [rec, ...this.recordings];
    saveRecordings(this.recordings);
  }

  replay(rec: Recording) {
    if (this.recording || this.replaying) return;
    this.replaying = rec.name;
    this.replayProgress = 0;
    const start = performance.now();
    for (const step of rec.steps) {
      this.replayTimers.push(
        window.setTimeout(() => {
          if (step.type === 'pcmd') this.applySticks(step.v);
          else this.run(step.a);
        }, step.t),
      );
    }
    const tick = window.setInterval(() => {
      this.replayProgress = Math.min(1, (performance.now() - start) / rec.durationMs);
    }, 100);
    this.replayTimers.push(tick);
    this.replayTimers.push(window.setTimeout(() => this.stopReplay(), rec.durationMs + 100));
  }

  stopReplay() {
    if (!this.replaying) return;
    for (const id of this.replayTimers) {
      clearTimeout(id);
      clearInterval(id);
    }
    this.replayTimers = [];
    this.replaying = null;
    this.applySticks({ roll: 0, pitch: 0, yaw: 0, gaz: 0 });
  }

  renameRecording(rec: Recording, name: string) {
    this.recordings = this.recordings.map((r) => (r === rec ? { ...r, name } : r));
    saveRecordings(this.recordings);
  }

  deleteRecording(rec: Recording) {
    this.recordings = this.recordings.filter((r) => r !== rec);
    saveRecordings(this.recordings);
  }

  // ---------------- interni

  private applySticks(v: Pcmd) {
    this.sticks = v;
    this.conn.pcmd = { ...v };
  }

  private run(action: Action) {
    if (this.demo) {
      if (action === 'takeOff') this.flying = 'hovering';
      if (action === 'land') this.flying = 'landed';
      if (action === 'takePicture') this.photoCount = (this.photoCount ?? 0) + 1;
      return;
    }
    const c = this.conn;
    if (action.startsWith('flip:')) return void c.flip(action.slice(5) as FlipDirection);
    switch (action) {
      case 'takeOff': return void c.takeOff();
      case 'land': return void c.land();
      case 'takePicture': return void c.takePicture();
      case 'openClaw': return void c.openClaw();
      case 'closeClaw': return void c.closeClaw();
      case 'fireGun': return void c.fireGun();
    }
  }
}

export const drone = new DroneStore();
