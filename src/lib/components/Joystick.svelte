<script lang="ts">
  /** Stick virtuale multi-touch. x/y in [-100, 100], y positivo = su. Torna al centro al rilascio. */
  let {
    x = 0,
    y = 0,
    label = '',
    hintX = '',
    hintY = '',
    onmove,
  }: {
    x?: number;
    y?: number;
    label?: string;
    hintX?: string;
    hintY?: string;
    onmove: (x: number, y: number) => void;
  } = $props();

  let pad = $state<HTMLDivElement>()!;
  let pointerId = $state<number | null>(null);

  function update(e: PointerEvent) {
    const r = pad.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = (e.clientX - (r.left + radius)) / radius;
    let dy = (e.clientY - (r.top + radius)) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    onmove(Math.round(dx * 100), Math.round(-dy * 100));
  }

  function down(e: PointerEvent) {
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    pad.setPointerCapture(e.pointerId);
    update(e);
  }
  function move(e: PointerEvent) {
    if (e.pointerId === pointerId) update(e);
  }
  function up(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    onmove(0, 0);
  }
</script>

<div class="wrap">
  <div
    class="pad"
    class:active={pointerId !== null}
    bind:this={pad}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    role="slider"
    aria-label={label}
    aria-valuenow={y}
    tabindex="-1"
  >
    <span class="axis h"></span>
    <span class="axis v"></span>
    {#if hintY}<span class="hint top">{hintY}</span>{/if}
    {#if hintX}<span class="hint side">{hintX}</span>{/if}
    <div class="knob" style:transform="translate({x * 0.8}%, {-y * 0.8}%) translate(-50%, -50%)"></div>
  </div>
  <span class="label">{label}</span>
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .pad {
    position: relative;
    width: min(40vmin, 190px);
    aspect-ratio: 1;
    border-radius: 50%;
    background: radial-gradient(circle, var(--pad-inner) 0%, var(--pad-outer) 70%);
    border: 1.5px solid var(--line);
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    transition: border-color 0.15s;
  }
  .pad.active {
    border-color: var(--accent);
  }
  .axis {
    position: absolute;
    background: var(--line);
    opacity: 0.6;
  }
  .axis.h {
    left: 12%;
    right: 12%;
    top: 50%;
    height: 1px;
  }
  .axis.v {
    top: 12%;
    bottom: 12%;
    left: 50%;
    width: 1px;
  }
  .hint {
    position: absolute;
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    pointer-events: none;
  }
  .hint.top {
    top: 6%;
    left: 50%;
    transform: translateX(-50%);
  }
  .hint.side {
    bottom: 6%;
    left: 50%;
    transform: translateX(-50%);
  }
  .knob {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 38%;
    aspect-ratio: 1;
    border-radius: 50%;
    background: var(--knob);
    box-shadow:
      0 4px 14px rgb(0 0 0 / 0.35),
      inset 0 1px 0 rgb(255 255 255 / 0.15);
    pointer-events: none;
  }
  .pad.active .knob {
    background: var(--accent);
  }
  .label {
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
</style>
