import { drone } from './drone.svelte';

/**
 * Supporto gamepad (Gamepad API) per qualsiasi controller Bluetooth/USB
 * riconosciuto dal browser come "standard gamepad".
 *
 * Mappatura (layout Xbox):
 *  stick sx: su/giù = quota, sx/dx = rotazione
 *  stick dx: su/giù = avanti/indietro, sx/dx = laterale
 *  A = decollo/atterraggio · B = atterraggio · X = foto · Y = cannone
 *  LB/RB = pinza apri/chiudi · croce = flip · Start/Menu = EMERGENZA
 */

const DEADZONE = 0.12;
const axis = (v: number) => (Math.abs(v) < DEADZONE ? 0 : Math.round(v * 100));

class GamepadInput {
  name = $state<string | null>(null);
  private prevButtons: boolean[] = [];
  private raf = 0;
  private wasActive = false;

  start() {
    if (typeof window === 'undefined' || !('getGamepads' in navigator)) return;
    window.addEventListener('gamepadconnected', (e) => {
      this.name = e.gamepad.id;
      this.loop();
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.name = null;
      cancelAnimationFrame(this.raf);
      drone.setSticks({ roll: 0, pitch: 0, yaw: 0, gaz: 0 });
    });
  }

  private loop = () => {
    const gp = navigator.getGamepads().find((g) => g?.connected);
    if (gp) this.read(gp);
    this.raf = requestAnimationFrame(this.loop);
  };

  private read(gp: Gamepad) {
    const v = {
      yaw: axis(gp.axes[0] ?? 0),
      gaz: -axis(gp.axes[1] ?? 0),
      roll: axis(gp.axes[2] ?? 0),
      pitch: -axis(gp.axes[3] ?? 0),
    };
    const active = Object.values(v).some((n) => n !== 0);
    // invia solo quando il gamepad è in uso (o appena rilasciato), così non
    // sovrascrive gli stick a schermo né interrompe un replay
    if (active || this.wasActive) drone.setSticks(v);
    this.wasActive = active;

    const pressed = gp.buttons.map((b) => b.pressed);
    const down = (i: number) => pressed[i] && !this.prevButtons[i];

    if (down(9)) drone.emergency();
    if (down(0)) drone.do(drone.isAirborne ? 'land' : 'takeOff');
    if (down(1)) drone.do('land');
    if (down(2)) drone.do('takePicture');
    if (down(3)) drone.do('fireGun');
    if (down(4)) drone.do('openClaw');
    if (down(5)) drone.do('closeClaw');
    if (down(12)) drone.do('flip:front');
    if (down(13)) drone.do('flip:back');
    if (down(14)) drone.do('flip:left');
    if (down(15)) drone.do('flip:right');

    this.prevButtons = pressed;
  }
}

export const gamepad = new GamepadInput();
