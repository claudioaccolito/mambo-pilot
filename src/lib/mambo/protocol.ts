/**
 * Protocollo ARCommands dei Parrot Minidrones (Mambo, Swing, Rolling Spider) via BLE.
 * ID presi da minidrone.xml / common.xml dell'ARSDK Parrot (gli stessi usati da pyparrot).
 *
 * Pacchetto: [dataType u8][seq u8][project u8][class u8][cmd u16 LE][argomenti LE...]
 * Gli enum sono codificati come u32 LE, le stringhe terminate da \0.
 */

const uuid = (short: string) => `9a66${short}-0800-9191-11e4-012d1540cb8e`;

export const SERVICES = {
  send: uuid('fa00'),
  receive: uuid('fb00'),
  perfCounter: uuid('fc00'),
  ftp: uuid('fd21'),
  updateFtp: uuid('fd51'),
  updateRfcomm: uuid('fe00'),
};

export const CHARS = {
  // invio (servizio fa00)
  sendNoAck: uuid('fa0a'), // solo PCMD
  sendWithAck: uuid('fa0b'), // tutti gli altri comandi
  sendHighPriority: uuid('fa0c'), // emergenza
  ackCommand: uuid('fa1e'), // ack dei dati ricevuti su fb0e
  // ricezione (servizio fb00)
  ackDroneData: uuid('fb0e'), // dati che vanno confermati
  noAckDroneData: uuid('fb0f'), // batteria, stato, ecc.
  ackCommandSent: uuid('fb1b'),
  ackHighPriority: uuid('fb1c'),
};

/** Caratteristiche su cui il drone vuole le notifiche attive (handshake). */
export const HANDSHAKE: { service: string; chars: string[] }[] = [
  {
    service: SERVICES.receive,
    chars: [CHARS.ackDroneData, CHARS.noAckDroneData, CHARS.ackCommandSent, CHARS.ackHighPriority],
  },
  { service: SERVICES.ftp, chars: [uuid('fd22'), uuid('fd23'), uuid('fd24')] },
  { service: SERVICES.updateFtp, chars: [uuid('fd52'), uuid('fd53'), uuid('fd54')] },
];

export const DATA_TYPE = { ack: 1, dataNoAck: 2, lowLatency: 3, dataWithAck: 4 } as const;

export const PROJECT = { common: 0, minidrone: 2 } as const;

// [project, class, cmd]
export type CmdId = readonly [number, number, number];

export const CMD = {
  // minidrone.Piloting
  flatTrim: [2, 0, 0],
  takeOff: [2, 0, 1],
  pcmd: [2, 0, 2],
  landing: [2, 0, 3],
  emergency: [2, 0, 4],
  // minidrone.Animations
  flip: [2, 4, 0],
  // minidrone.MediaRecord
  pictureV2: [2, 6, 1],
  // minidrone.PilotingSettings / SpeedSettings
  maxAltitude: [2, 8, 0],
  maxTilt: [2, 8, 1],
  maxVerticalSpeed: [2, 1, 0],
  maxRotationSpeed: [2, 1, 1],
  // minidrone.UsbAccessory
  clawControl: [2, 16, 1],
  gunControl: [2, 16, 2],
  // common
  allSettings: [0, 2, 0],
  allStates: [0, 4, 0],
  currentDate: [0, 4, 1],
  currentTime: [0, 4, 2],
} as const satisfies Record<string, CmdId>;

export type FlipDirection = 'front' | 'back' | 'right' | 'left';
export const FLIP_DIRECTIONS: FlipDirection[] = ['front', 'back', 'right', 'left'];

export const FLYING_STATES = [
  'landed',
  'takingoff',
  'hovering',
  'flying',
  'landing',
  'emergency',
  'rolling',
  'init',
] as const;
export type FlyingState = (typeof FLYING_STATES)[number];

export const ALERT_STATES = ['none', 'user', 'cut_out', 'critical_battery', 'low_battery'] as const;
export type AlertState = (typeof ALERT_STATES)[number];

// --------------------------------------------------------------------------
// Encoding

export type Arg =
  | { t: 'u8' | 'i8'; v: number }
  | { t: 'u16' | 'i16'; v: number }
  | { t: 'u32' | 'i32' | 'enum'; v: number }
  | { t: 'float'; v: number }
  | { t: 'string'; v: string };

function argSize(a: Arg): number {
  switch (a.t) {
    case 'u8':
    case 'i8':
      return 1;
    case 'u16':
    case 'i16':
      return 2;
    case 'string':
      return new TextEncoder().encode(a.v).length + 1;
    default:
      return 4;
  }
}

export function buildPacket(dataType: number, seq: number, cmd: CmdId, args: Arg[] = []): Uint8Array {
  const size = 6 + args.reduce((s, a) => s + argSize(a), 0);
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  dv.setUint8(0, dataType);
  dv.setUint8(1, seq & 0xff);
  dv.setUint8(2, cmd[0]);
  dv.setUint8(3, cmd[1]);
  dv.setUint16(4, cmd[2], true);
  let o = 6;
  for (const a of args) {
    switch (a.t) {
      case 'u8': dv.setUint8(o, a.v); o += 1; break;
      case 'i8': dv.setInt8(o, a.v); o += 1; break;
      case 'u16': dv.setUint16(o, a.v, true); o += 2; break;
      case 'i16': dv.setInt16(o, a.v, true); o += 2; break;
      case 'u32':
      case 'enum': dv.setUint32(o, a.v, true); o += 4; break;
      case 'i32': dv.setInt32(o, a.v, true); o += 4; break;
      case 'float': dv.setFloat32(o, a.v, true); o += 4; break;
      case 'string': {
        const enc = new TextEncoder().encode(a.v);
        bytes.set(enc, o);
        o += enc.length;
        dv.setUint8(o, 0);
        o += 1;
        break;
      }
    }
  }
  return bytes;
}

const clamp100 = (n: number) => Math.max(-100, Math.min(100, Math.round(n)));

/** PCMD: roll/pitch/yaw/gaz in [-100, 100]. flag=1 se roll/pitch vanno applicati. */
export function buildPcmd(seq: number, roll: number, pitch: number, yaw: number, gaz: number): Uint8Array {
  const r = clamp100(roll);
  const p = clamp100(pitch);
  return buildPacket(DATA_TYPE.dataNoAck, seq, CMD.pcmd, [
    { t: 'u8', v: r !== 0 || p !== 0 ? 1 : 0 },
    { t: 'i8', v: r },
    { t: 'i8', v: p },
    { t: 'i8', v: clamp100(yaw) },
    { t: 'i8', v: clamp100(gaz) },
    { t: 'u32', v: 0 },
  ]);
}

export function buildAck(seq: number, packetSeq: number): Uint8Array {
  return new Uint8Array([DATA_TYPE.ack, seq & 0xff, packetSeq & 0xff]);
}

// --------------------------------------------------------------------------
// Decoding

export type DroneEvent =
  | { kind: 'battery'; percent: number }
  | { kind: 'flyingState'; state: FlyingState }
  | { kind: 'alert'; state: AlertState }
  | { kind: 'altitude'; meters: number }
  | { kind: 'pictureState'; ready: boolean; error: string }
  | { kind: 'pictureEvent'; taken: boolean; error: string }
  | { kind: 'claw'; id: number; state: string }
  | { kind: 'gun'; id: number; state: string }
  | { kind: 'photoCount'; count: number }
  | { kind: 'unknown'; cmd: CmdId };

const PIC_STATE_ERR = ['ok', 'unknown', 'camera_ko', 'memoryFull', 'lowBattery'];
const PIC_EVENT_ERR = ['ok', 'unknown', 'busy', 'notAvailable', 'memoryFull', 'lowBattery'];
const CLAW_STATES = ['OPENED', 'OPENING', 'CLOSED', 'CLOSING'];
const GUN_STATES = ['READY', 'BUSY'];

/**
 * Decodifica un pacchetto ricevuto. `data` include i 2 byte di header (tipo, seq).
 */
export function parsePacket(data: DataView): { type: number; seq: number; event: DroneEvent | null } {
  const type = data.getUint8(0);
  const seq = data.getUint8(1);
  if (data.byteLength < 6 || type === DATA_TYPE.ack) return { type, seq, event: null };

  const project = data.getUint8(2);
  const cls = data.getUint8(3);
  const cmd = data.getUint16(4, true);
  const p = 6; // inizio argomenti
  const has = (n: number) => data.byteLength >= p + n;

  let event: DroneEvent | null = { kind: 'unknown', cmd: [project, cls, cmd] };

  if (project === PROJECT.common && cls === 5) {
    if (cmd === 1 && has(1)) event = { kind: 'battery', percent: data.getUint8(p) };
    else if (cmd === 12 && has(3)) event = { kind: 'photoCount', count: data.getUint16(p + 1, true) };
  } else if (project === PROJECT.minidrone) {
    if (cls === 3 && cmd === 1 && has(4)) {
      event = { kind: 'flyingState', state: FLYING_STATES[data.getUint32(p, true)] ?? 'init' };
    } else if (cls === 3 && cmd === 2 && has(4)) {
      event = { kind: 'alert', state: ALERT_STATES[data.getUint32(p, true)] ?? 'none' };
    } else if (cls === 18 && cmd === 2 && has(4)) {
      event = { kind: 'altitude', meters: data.getFloat32(p, true) };
    } else if (cls === 7 && cmd === 1 && has(8)) {
      event = {
        kind: 'pictureState',
        ready: data.getUint32(p, true) === 0,
        error: PIC_STATE_ERR[data.getUint32(p + 4, true)] ?? 'unknown',
      };
    } else if (cls === 2 && cmd === 0 && has(8)) {
      event = {
        kind: 'pictureEvent',
        taken: data.getUint32(p, true) === 0,
        error: PIC_EVENT_ERR[data.getUint32(p + 4, true)] ?? 'unknown',
      };
    } else if (cls === 15 && cmd === 1 && has(5)) {
      event = { kind: 'claw', id: data.getUint8(p), state: CLAW_STATES[data.getUint32(p + 1, true)] ?? '?' };
    } else if (cls === 15 && cmd === 2 && has(5)) {
      event = { kind: 'gun', id: data.getUint8(p), state: GUN_STATES[data.getUint32(p + 1, true)] ?? '?' };
    }
  }
  return { type, seq, event };
}
