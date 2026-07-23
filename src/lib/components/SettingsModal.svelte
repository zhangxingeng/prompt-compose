<script lang="ts">
  /**
   * App settings. Currently one section: the dictation model. Downloading it
   * is an explicit action here, never an implicit side effect of holding
   * Space to dictate (`src/lib/dictate.svelte.ts`) — so a first-time user
   * sees exactly why nothing happens until they click Download, instead of a
   * silent multi-minute stall the first time they try to speak.
   */
  import { dictate, downloadModel, refreshModelStatus } from '$lib/dictate.svelte';
  import { focusTrap } from '$lib/attachments/focusTrap';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  // Freshen the status every time Settings opens — cheap, and catches a
  // model directory removed by hand since the last check.
  void refreshModelStatus();
</script>

<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  aria-labelledby="settings-modal-title"
  onkeydown={handleKeydown}
  onclick={(e) => e.target === e.currentTarget && onClose()}
  tabindex="-1"
>
  <div class="modal settings-modal" tabindex="-1" {@attach focusTrap}>
    <h3 id="settings-modal-title">Settings</h3>

    <section class="settings-modal__section">
      <span class="settings-modal__section-title">Speech-to-text model</span>
      <div class="settings-modal__model-row">
        <div class="settings-modal__model-info">
          <span class="settings-modal__model-name">Whisper Large-v3 Turbo</span>
          <span class="settings-modal__model-size">~540MB, downloaded once, runs fully offline</span>
        </div>
        {#if dictate.modelReady && !dictate.modelDownloading}
          <span class="settings-modal__status settings-modal__status--ready">✓ Ready</span>
        {:else if !dictate.modelDownloading}
          <button type="button" class="btn btn--primary btn--sm" onclick={() => downloadModel()}>
            Download
          </button>
        {/if}
      </div>

      {#if dictate.modelDownloading}
        <div class="settings-modal__progress" role="progressbar" aria-valuenow={Math.round(dictate.modelProgress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div class="settings-modal__progress-fill" style="width: {Math.round(dictate.modelProgress * 100)}%"></div>
        </div>
        <span class="settings-modal__status">Downloading… {Math.round(dictate.modelProgress * 100)}%</span>
      {:else if !dictate.modelReady}
        <p class="settings-modal__hint">
          Dictation (hold Space in the compose box) won't work until this finishes downloading.
        </p>
      {/if}
    </section>

    <div class="modal__actions">
      <button type="button" class="btn btn--ghost btn--sm" onclick={onClose}>Close</button>
    </div>
  </div>
</div>

<style>
  .settings-modal {
    max-width: 420px;
  }
  .settings-modal__section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .settings-modal__section-title {
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-faint);
  }
  .settings-modal__model-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .settings-modal__model-info {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .settings-modal__model-name {
    font-size: 0.85rem;
    color: var(--text);
  }
  .settings-modal__model-size {
    font-size: 0.72rem;
    color: var(--text-faint);
  }
  .settings-modal__status {
    font-size: 0.75rem;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .settings-modal__status--ready {
    color: var(--accent-snippet);
  }
  .settings-modal__progress {
    height: 0.4rem;
    border-radius: 0.2rem;
    background: var(--bg-subtle);
    overflow: hidden;
  }
  .settings-modal__progress-fill {
    height: 100%;
    background: var(--accent-snippet);
    transition: width 0.2s ease;
  }
  .settings-modal__hint {
    font-size: 0.75rem;
    color: var(--text-faint);
    margin: 0;
  }
</style>
