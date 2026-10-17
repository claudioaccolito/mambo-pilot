<script lang="ts">
  import { onMount } from 'svelte';
  import { drone } from './lib/drone.svelte';
  import { gamepad } from './lib/gamepad.svelte';
  import { flypad, FLYPAD_HELP } from './lib/flypad.svelte';
  import Joystick from './lib/components/Joystick.svelte';
  import Recorder from './lib/components/Recorder.svelte';

  let sheet = $state<null | 'paths' | 'settings'>(null);
  let tilt = $state(15);
  let vSpeed = $state(1);
  let rotSpeed = $state(180);

  onMount(() => gamepad.start());

  const STATE_LABEL: Record<string, string> = {
    landed: 'A terra',
    takingoff: 'Decollo',
    hovering: 'In hover',
    flying: 'In volo',
    landing: 'Atterraggio',
    emergency: 'Emergenza',
    rolling: 'Su ruote',
    init: 'Avvio',
  };
  const ALERT_LABEL: Record<string, string> = {
    low_battery: 'Batteria bassa',
    critical_battery: 'Batteria critica: atterra',
    cut_out: 'Motori bloccati',
    user: 'Emergenza utente',
  };

  const connected = $derived(drone.status === 'connected');
  const batteryLevel = $derived(
    drone.battery === null ? 'unknown' : drone.battery <= 15 ? 'critical' : drone.battery <= 35 ? 'low' : 'ok',
  );
</script>

<main class:disconnected={!connected}>
  <!-- barra superiore -->
  <header class="topbar">
    <div class="brand">
      <span class="dot" class:on={connected}></span>
      <span>{connected ? drone.name || 'Mambo' : 'Mambo Pilot'}</span>
    </div>

    {#if connected}
      <div class="telemetry">
        <span class="chip state">{STATE_LABEL[drone.flying] ?? drone.flying}</span>
        {#if drone.altitude !== null}
          <span class="chip">↕ {drone.altitude.toFixed(1)} m</span>
        {/if}
        {#if drone.photoCount !== null}
          <span class="chip">📷 {drone.photoCount}</span>
        {/if}
        <span class="battery {batteryLevel}" title="Batteria">
          <span class="cell"><span class="fill" style:width="{drone.battery ?? 0}%"></span></span>
          {drone.battery ?? '–'}%
        </span>
      </div>
    {/if}

    <div class="top-actions">
      {#if flypad.status === 'connected'}
        <span class="chip flypad" class:slow={flypad.slow} title={flypad.name}>
          FlyPad{flypad.battery !== null ? ` ${flypad.battery}%` : ''}{flypad.slow ? ' · lento' : ''}
        </span>
      {/if}
      {#if gamepad.name}<span class="chip" title={gamepad.name}>🎮</span>{/if}
      <button class="ghost" onclick={() => (sheet = 'paths')}>Percorsi</button>
      <button
        class="ghost"
        onclick={() => {
          drone.refreshDiag();
          sheet = 'settings';
        }}
        aria-label="Impostazioni">⚙</button
      >
    </div>
  </header>

  {#if connected && drone.sendError}
    <button class="alert send-err" onclick={() => (drone.sendError = '')}>
      Il drone non riceve i comandi: {drone.sendError} (tocca per chiudere)
    </button>
  {/if}

  {#if drone.alert !== 'none' && ALERT_LABEL[drone.alert]}
    <div class="alert">{ALERT_LABEL[drone.alert]}</div>
  {/if}

  {#if !connected}
    <!-- schermata di connessione -->
    <section class="connect">
      {#if !drone.supported}
        <h1>Browser non supportato</h1>
        <p>
          Serve Web Bluetooth: apri questa pagina con <strong>Chrome su Android</strong> (o Chrome/Edge su PC), via HTTPS.
          Safari e iOS non lo supportano.
        </p>
      {:else}
        <h1>Collega il Mambo</h1>
        <ol>
          <li>
            <strong>Con il FlyPad</strong> (facoltativo): tieni il drone spento, accendi il FlyPad e collegalo per primo,
            così non si aggancia direttamente al drone.
          </li>
          <li>Accendi il drone e appoggialo su una superficie piana.</li>
          <li>Premi "Cerca drone" e scegli il Mambo dalla lista.</li>
        </ol>
        <div class="connect-actions">
          {#if flypad.status === 'connected'}
            <span class="chip ok">✓ {flypad.name} collegato</span>
          {:else}
            <button disabled={flypad.status === 'connecting'} onclick={() => flypad.connect()}>
              {flypad.status === 'connecting' ? 'Connessione…' : '1 · Collega FlyPad'}
            </button>
          {/if}
          <button class="primary big" disabled={drone.status === 'connecting'} onclick={() => drone.connect()}>
            {drone.status === 'connecting' ? 'Connessione…' : 'Cerca drone'}
          </button>
        </div>
        {#if flypad.status === 'error'}
          <p class="err">FlyPad: {flypad.error}</p>
        {/if}
        {#if drone.status === 'error'}
          <p class="err">
            Errore: {drone.error}{flypad.status !== 'connected' ? ' · Se il FlyPad è acceso, spegnilo: occupa il drone.' : ''}
          </p>
        {/if}
      {/if}
    </section>
  {:else}
    <!-- cockpit -->
    <section class="cockpit">
      <Joystick
        label="Quota · Rotazione"
        hintY="su"
        x={drone.sticks.yaw}
        y={drone.sticks.gaz}
        onmove={(x, y) => drone.setSticks({ yaw: x, gaz: y })}
      />

      <div class="center">
        {#if drone.isAirborne}
          <button class="primary big" onclick={() => drone.do('land')}>Atterra</button>
        {:else}
          <button class="primary big" onclick={() => drone.do('takeOff')}>Decolla</button>
        {/if}

        <div class="row">
          <button onclick={() => drone.do('takePicture')} disabled={!drone.pictureReady}>📷 Foto</button>
          <button onclick={() => drone.do('fireGun')}>💥 Spara</button>
        </div>
        <div class="row">
          <button onclick={() => drone.do('openClaw')}>Pinza apri</button>
          <button onclick={() => drone.do('closeClaw')}>chiudi</button>
        </div>

        <div class="flips" aria-label="Flip">
          <span class="flips-label">Flip</span>
          <button onclick={() => drone.do('flip:front')} disabled={!drone.isAirborne}>▲</button>
          <button onclick={() => drone.do('flip:left')} disabled={!drone.isAirborne}>◀</button>
          <button onclick={() => drone.do('flip:right')} disabled={!drone.isAirborne}>▶</button>
          <button onclick={() => drone.do('flip:back')} disabled={!drone.isAirborne}>▼</button>
        </div>

        {#if drone.lastPicture && drone.lastPicture !== 'ok'}
          <p class="err small">Foto non riuscita: {drone.lastPicture}</p>
        {/if}
        {#if drone.recording}
          <p class="rec-badge">● Registrazione in corso</p>
        {/if}
        {#if drone.replaying}
          <p class="rec-badge replay">▶ {drone.replaying} · {Math.round(drone.replayProgress * 100)}%</p>
        {/if}
      </div>

      <Joystick
        label="Avanti · Laterale"
        hintY="avanti"
        x={drone.sticks.roll}
        y={drone.sticks.pitch}
        onmove={(x, y) => drone.setSticks({ roll: x, pitch: y })}
      />
    </section>

    <button class="emergency" onclick={() => drone.emergency()}>STOP MOTORI</button>
  {/if}
</main>

{#if sheet}
  <div class="backdrop" onclick={() => (sheet = null)} role="presentation"></div>
  <aside class="sheet">
    <button class="close" onclick={() => (sheet = null)} aria-label="Chiudi">✕</button>
    {#if sheet === 'paths'}
      <Recorder />
    {:else}
      <section class="panel">
        <h2>Impostazioni di volo</h2>
        <label>
          <span>Inclinazione massima <b>{tilt}°</b></span>
          <input type="range" min="5" max="25" bind:value={tilt} onchange={() => drone.conn.setMaxTilt(tilt)} />
          <small>Più alta = più veloce in orizzontale.</small>
        </label>
        <label>
          <span>Velocità verticale <b>{vSpeed.toFixed(1)} m/s</b></span>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            bind:value={vSpeed}
            onchange={() => drone.conn.setMaxVerticalSpeed(vSpeed)}
          />
        </label>
        <label>
          <span>Velocità di rotazione <b>{rotSpeed}°/s</b></span>
          <input
            type="range"
            min="50"
            max="360"
            step="10"
            bind:value={rotSpeed}
            onchange={() => drone.conn.setMaxRotationSpeed(rotSpeed)}
          />
        </label>
        <button disabled={!connected || drone.isAirborne} onclick={() => drone.conn.flatTrim()}>
          Calibra (flat trim) a terra
        </button>
        {#if connected}
          <button class="ghost" onclick={() => drone.disconnect()}>Disconnetti</button>
        {/if}
        {#if connected}
          <h2>Diagnostica</h2>
          <p class="note diag">
            Comandi inviati: {drone.diag.ok} ok · {drone.diag.failed} falliti<br />
            Dati ricevuti: {drone.diag.rx}{drone.diag.lastRx ? ` · ultimo ${drone.diag.lastRx}` : ''}<br />
            {#if drone.diag.notifyFailed.length}Notifiche non attive: {drone.diag.notifyFailed.join(', ')}<br />{/if}
            {#each Object.entries(drone.diag.props) as [k, v] (k)}{k}: {v}<br />{/each}
            {#if drone.diag.lastError}Ultimo errore: {drone.diag.lastError}{/if}
          </p>
        {/if}
        <h2>FlyPad</h2>
        {#if flypad.status === 'connected'}
          <button class="ghost" onclick={() => flypad.disconnect()}>Scollega FlyPad</button>
        {:else}
          <button disabled={flypad.status === 'connecting'} onclick={() => flypad.connect()}>Collega FlyPad</button>
        {/if}
        <p class="note">Stick come sul drone: sinistro quota e rotazione, destro avanti/indietro e laterale.</p>
        <dl class="keymap">
          {#each FLYPAD_HELP as [key, action] (key)}
            <dt>{key}</dt>
            <dd>{action}</dd>
          {/each}
        </dl>
        <p class="note">
          Gamepad: stick come a schermo · A decolla/atterra · X foto · Y spara · LB/RB pinza · croce flip · Start =
          stop motori.
        </p>
      </section>
    {/if}
  </aside>
{/if}

<style>
  main {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    padding: max(10px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
      max(10px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
    gap: 10px;
    box-sizing: border-box;
  }

  .topbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
  }
  .dot.on {
    background: var(--ok);
    box-shadow: 0 0 8px var(--ok);
  }
  .telemetry {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }
  .top-actions {
    margin-left: auto;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .chip {
    font-size: 12px;
    padding: 4px 9px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .send-err {
    border: none;
    font-size: 12px;
    font-weight: 500;
    text-align: center;
  }
  .diag {
    font-family: ui-monospace, monospace;
    user-select: text;
    -webkit-user-select: text;
  }
  .chip.ok {
    color: var(--ok);
  }
  .chip.flypad.slow {
    color: var(--warn);
  }
  .connect-actions {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
  }
  .keymap {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 12px;
    margin: 0;
    font-size: 13px;
  }
  .keymap dt {
    font-weight: 600;
    white-space: nowrap;
  }
  .keymap dd {
    margin: 0;
    color: var(--muted);
  }
  .chip.state {
    color: var(--accent);
  }

  .battery {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .cell {
    width: 26px;
    height: 12px;
    border: 1.5px solid currentColor;
    border-radius: 3px;
    padding: 1px;
    position: relative;
  }
  .cell::after {
    content: '';
    position: absolute;
    right: -4px;
    top: 3px;
    width: 2px;
    height: 5px;
    background: currentColor;
    border-radius: 0 1px 1px 0;
  }
  .fill {
    display: block;
    height: 100%;
    background: currentColor;
    border-radius: 1px;
    transition: width 0.4s;
  }
  .battery.ok {
    color: var(--ok);
  }
  .battery.low {
    color: var(--warn);
  }
  .battery.critical {
    color: var(--danger);
  }

  .alert {
    align-self: center;
    background: var(--danger);
    color: white;
    padding: 6px 14px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 600;
  }

  .connect {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    max-width: 440px;
    margin: 0 auto;
    gap: 6px;
  }
  .connect h1 {
    font-size: 24px;
    margin: 0 0 6px;
  }
  .connect ol {
    text-align: left;
    color: var(--muted);
    line-height: 1.6;
    padding-left: 20px;
    margin: 0 0 14px;
  }

  .cockpit {
    flex: 1;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    min-height: 0;
  }
  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .flips {
    display: grid;
    grid-template-areas: '. f .' 'l x r' '. b .';
    grid-template-columns: repeat(3, 40px);
    gap: 4px;
    margin-top: 2px;
  }
  .flips button {
    padding: 6px 0;
  }
  .flips button:nth-of-type(1) {
    grid-area: f;
  }
  .flips button:nth-of-type(2) {
    grid-area: l;
  }
  .flips button:nth-of-type(3) {
    grid-area: r;
  }
  .flips button:nth-of-type(4) {
    grid-area: b;
  }
  .flips-label {
    grid-area: x;
    align-self: center;
    text-align: center;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .rec-badge {
    margin: 0;
    font-size: 12px;
    color: var(--danger);
    font-weight: 600;
  }
  .rec-badge.replay {
    color: var(--accent);
  }

  .emergency {
    align-self: center;
    background: var(--danger);
    border-color: var(--danger);
    color: white;
    font-weight: 700;
    letter-spacing: 0.1em;
    padding: 10px 28px;
  }

  /* ritratto: stick sotto, comandi sopra */
  @media (orientation: portrait) {
    .cockpit {
      grid-template-columns: 1fr 1fr;
      grid-template-rows: 1fr auto;
      justify-items: center;
    }
    .center {
      grid-column: 1 / -1;
      grid-row: 1;
    }
  }

  .err {
    color: var(--danger);
    font-size: 13px;
  }
  .err.small {
    margin: 0;
    font-size: 12px;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.45);
    z-index: 10;
  }
  .sheet {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(380px, 100vw);
    background: var(--surface);
    border-left: 1px solid var(--line);
    z-index: 11;
    padding: max(16px, env(safe-area-inset-top)) 16px 16px;
    overflow-y: auto;
    box-sizing: border-box;
  }
  .close {
    position: absolute;
    top: 12px;
    right: 12px;
    background: none;
    border: none;
    color: var(--muted);
    font-size: 16px;
  }
  .sheet :global(.panel) {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-top: 4px;
  }
  .sheet h2 {
    margin: 0;
    font-size: 16px;
  }
  .sheet label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
  }
  .sheet small,
  .note {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.5;
  }
  input[type='range'] {
    accent-color: var(--accent);
    width: 100%;
  }
</style>
