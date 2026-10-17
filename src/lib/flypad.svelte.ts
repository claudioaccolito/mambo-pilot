import { drone } from './drone.svelte';
import { connectWithRetry } from './mambo/connection';
import type { FlipDirection } from './mambo/protocol';

/**
 * Parrot FlyPad letto via Web Bluetooth.
 *
 * Mappatura ricavata con il FlyPad Lab (fw 02.09 / sw 02.11), caratteristica 9e35fa01:
 *   [0]  costante 0x64
 *   [1]  tasti: 0x01 centrale · 0x02 "1" · 0x04 "2" · 0x08 B · 0x10 A · 0x20 R1 · 0x40 R2 · 0x80 L1
 *   [2]  tasti: 0x01 L2 · 0x02 click stick sx · 0x04 click stick dx
 *   [3]  stick dx X (0x00 sinistra · 0x80 centro · 0xff destra)
 *   [4]  stick dx Y (0x00 su · 0xff giù)
 *   [5]  stick sx X
 *   [6]  stick sx Y (0x00 su · 0xff giù)
 */

const SVC = '9e35fa00-4344-44d4-a2e2-0c7f6046878b';
const INPUT = '9e35fa01-4344-44d4-a2e2-0c7f6046878b';

const DEADZONE = 0.08;
const SLOW_FACTOR = 0.45;

export const BTN = {
  center: [1, 0x01],
  one: [1, 0x02],
  two: [1, 0x04],
  b: [1, 0x08],
  a: [1, 0x10],
  r1: [1, 0x20],
  r2: [1, 0x40],
  l1: [1, 0x80],
  l2: [2, 0x01],
  lsClick: [2, 0x02],
  rsClick: [2, 0x04],
} as const;
type Button = keyof typeof BTN;

/** Mappatura dei tasti mostrata nelle impostazioni. */
export const FLYPAD_HELP: [string, string][] = [
  ['Tasto centrale', 'Decolla / atterra'],
  ['A', 'Foto'],
  ['B', 'Flip nella direzione dello stick destro (avanti se è al centro)'],
  ['1', 'Cannone'],
  ['2', 'Pinza: apri / chiudi'],
  ['L2 tenuto', 'Modalità lenta, per manovre di precisione'],
  ['R1', 'Registra percorso / stop'],
  ['R2', 'Rigioca l\'ultimo percorso / stop'],
  ['L1 + R1 insieme', 'STOP MOTORI'],
];

function axis(raw: number): number {
  const v = (raw - 128) / 127;
  if (Math.abs(v) < DEADZONE) return 0;
  return Math.round(Math.max(-1, Math.min(1, v)) * 100);
}

class FlyPadInput {
  status = $state<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  error = $state('');
  name = $state('');
  battery = $state<number | null>(null);
  slow = $state(false);

  private device: BluetoothDevice | null = null;
  private prev = new Uint8Array(7);
  private wasActive = false;

  async connect() {
    this.status = 'connecting';
    this.error = '';
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'FLYPAD' }, { namePrefix: 'FlyPad' }],
        optionalServices: [SVC, 'battery_service'],
      });
      this.device = device;
      device.addEventListener('gattserverdisconnected', this.onDisconnect);
      const gatt = await connectWithRetry(device);

      const input = await (await gatt.getPrimaryService(SVC)).getCharacteristic(INPUT);
      input.addEventListener('characteristicvaluechanged', (e) =>
        this.onInput((e.target as BluetoothRemoteGATTCharacteristic).value!),
      );
      await input.startNotifications();

      try {
        const bat = await (await gatt.getPrimaryService('battery_service')).getCharacteristic('battery_level');
        this.battery = (await bat.readValue()).getUint8(0);
        bat.addEventListener('characteristicvaluechanged', (e) => {
          this.battery = (e.target as BluetoothRemoteGATTCharacteristic).value!.getUint8(0);
        });
        await bat.startNotifications().catch(() => {});
      } catch {
        /* batteria non disponibile */
      }

      this.name = device.name ?? 'FlyPad';
      this.status = 'connected';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/cancel|chosen/i.test(msg)) this.status = 'idle';
      else {
        this.status = 'error';
        this.error = msg;
      }
    }
  }

  disconnect() {
    this.device?.gatt?.disconnect();
  }

  private onDisconnect = () => {
    this.status = 'idle';
    this.slow = false;
    // sicurezza: se il FlyPad si scollega in volo, il drone resta in hover
    if (this.wasActive) drone.setSticks({ roll: 0, pitch: 0, yaw: 0, gaz: 0 });
    this.wasActive = false;
  };

  private onInput(dv: DataView) {
    if (dv.byteLength < 7) return;
    const cur = new Uint8Array(dv.buffer, dv.byteOffset, 7).slice();
    const held = (b: Button) => (cur[BTN[b][0]] & BTN[b][1]) !== 0;
    const pressed = (b: Button) => held(b) && (this.prev[BTN[b][0]] & BTN[b][1]) === 0;

    // ---- stick
    this.slow = held('l2');
    const k = this.slow ? SLOW_FACTOR : 1;
    const v = {
      roll: Math.round(axis(cur[3]) * k),
      pitch: Math.round(-axis(cur[4]) * k),
      yaw: Math.round(axis(cur[5]) * k),
      gaz: Math.round(-axis(cur[6]) * k),
    };
    const active = v.roll !== 0 || v.pitch !== 0 || v.yaw !== 0 || v.gaz !== 0;
    // come per il gamepad: scrive solo quando lo usi (o appena lo rilasci),
    // così non annulla gli stick a schermo né interrompe un replay a stick fermi
    if (active || this.wasActive) drone.setSticks(v);
    this.wasActive = active;

    // ---- tasti
    if (held('l1') && held('r1') && (pressed('l1') || pressed('r1'))) {
      drone.emergency();
    } else {
      if (pressed('center')) drone.do(drone.isAirborne ? 'land' : 'takeOff');
      if (pressed('a')) drone.do('takePicture');
      if (pressed('b')) drone.do(`flip:${flipDirection(cur)}`);
      if (pressed('one')) drone.do('fireGun');
      if (pressed('two')) drone.do(drone.claw === 'OPENED' || drone.claw === 'OPENING' ? 'closeClaw' : 'openClaw');
      if (pressed('r1') && !held('l1')) {
        if (drone.recording) drone.stopRecording();
        else drone.startRecording();
      }
      if (pressed('r2')) {
        if (drone.replaying) drone.stopReplay();
        else if (drone.recordings[0]) drone.replay(drone.recordings[0]);
      }
    }

    this.prev = cur;
  }
}

function flipDirection(cur: Uint8Array): FlipDirection {
  const x = axis(cur[3]);
  const y = -axis(cur[4]);
  if (Math.max(Math.abs(x), Math.abs(y)) < 40) return 'front';
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'front' : 'back';
}

export const flypad = new FlyPadInput();

// modalità demo: espone il FlyPad per i test dal browser
if (drone.demo && typeof window !== 'undefined') Object.assign(window, { __flypad: flypad, __drone: drone });
