<script lang="ts">
  import { drone, type Recording } from '../drone.svelte';

  const fmt = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

  function rename(rec: Recording) {
    const name = prompt('Nome del percorso', rec.name);
    if (name?.trim()) drone.renameRecording(rec, name.trim());
  }
</script>

<section class="panel">
  <header>
    <h2>Percorsi</h2>
    {#if drone.recording}
      <button class="rec on" onclick={() => drone.stopRecording()}>■ Stop</button>
    {:else}
      <button class="rec" disabled={!!drone.replaying} onclick={() => drone.startRecording()}>● Registra</button>
    {/if}
  </header>

  <p class="note">
    Registra i comandi che dai (stick e tasti) e li rigioca con gli stessi tempi. Senza GPS il drone accumula deriva:
    usalo al chiuso, in uno spazio libero, partendo sempre dallo stesso punto e orientamento. Toccare uno stick
    interrompe il replay.
  </p>

  {#if drone.recordings.length === 0}
    <p class="empty">Nessun percorso salvato.</p>
  {:else}
    <ul>
      {#each drone.recordings as rec (rec.createdAt)}
        <li>
          <button class="name" onclick={() => rename(rec)} title="Rinomina">{rec.name}</button>
          <span class="dur">{fmt(rec.durationMs)}</span>
          {#if drone.replaying === rec.name}
            <button class="play on" onclick={() => drone.stopReplay()}>
              ■ {Math.round(drone.replayProgress * 100)}%
            </button>
          {:else}
            <button
              class="play"
              disabled={drone.status !== 'connected' || drone.recording || !!drone.replaying}
              onclick={() => drone.replay(rec)}>▶</button
            >
          {/if}
          <button class="del" aria-label="Elimina" onclick={() => confirm(`Eliminare "${rec.name}"?`) && drone.deleteRecording(rec)}
            >✕</button
          >
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-right: 36px; /* spazio per la X di chiusura */
  }
  h2 {
    margin: 0;
    font-size: 16px;
  }
  .note {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.5;
  }
  .empty {
    color: var(--muted);
    font-size: 13px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--surface-2);
  }
  .name {
    flex: 1;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    font: inherit;
    padding: 0;
  }
  .dur {
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .rec.on,
  .play.on {
    background: var(--danger);
    border-color: var(--danger);
    color: white;
  }
  .play {
    min-width: 52px;
  }
  .del {
    background: none;
    border: none;
    color: var(--muted);
  }
</style>
