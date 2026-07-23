<script lang="ts">
  /**
   * The mic button's popover: device, language, and model — the only controls
   * dictation has, deliberately (see `src-tauri/src/dictate/` module docs).
   * No waveform, no transcript history, no settings sprawl.
   *
   * Positioned relative to `ComposeBox.svelte`'s `.compose__stack` (already
   * `position: relative`), anchored under the mic button — same backdrop +
   * focus-trap + Escape convention as `ProjectContextMenu.svelte`.
   */
  import { onMount } from 'svelte';
  import { dictate, loadDevices } from '$lib/dictate.svelte';
  import { focusTrap } from '$lib/attachments/focusTrap';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  onMount(() => {
    if (dictate.devices.length === 0) void loadDevices();
  });

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }
</script>

<div class="dict-pop__backdrop" onclick={onClose} aria-hidden="true"></div>

<div class="dict-pop" role="dialog" aria-label="Dictation settings" tabindex="-1" onkeydown={handleKeydown} {@attach focusTrap}>
  <label class="dict-pop__label" for="dict-pop-device">Microphone</label>
  <select id="dict-pop-device" class="dict-pop__select" bind:value={dictate.selectedDevice}>
    <option value={null}>System default</option>
    {#each dictate.devices as device (device.id)}
      <option value={device.id}>{device.name}</option>
    {/each}
  </select>

  <label class="dict-pop__label" for="dict-pop-lang">Language</label>
  <select id="dict-pop-lang" class="dict-pop__select" bind:value={dictate.language}>
    <option value="auto">Auto</option>
    <option value="en">English</option>
    <option value="zh">Mandarin</option>
  </select>

  <label class="dict-pop__label" for="dict-pop-model">Model</label>
  <select id="dict-pop-model" class="dict-pop__select" disabled>
    <option>Whisper Large-v3 Turbo</option>
  </select>
</div>

<style>
  .dict-pop__backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: transparent;
  }
  .dict-pop {
    position: absolute;
    top: 2.4rem;
    right: 0.6rem;
    z-index: 41;
    width: 13rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.6rem 0.65rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.18);
    font-size: 0.76rem;
  }
  .dict-pop__label {
    font-size: 0.66rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--text-faint);
    margin-top: 0.15rem;
  }
  .dict-pop__select {
    font-family: inherit;
    font-size: 0.78rem;
    padding: 0.3rem 0.45rem;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    background: var(--bg);
    color: var(--text);
  }
  .dict-pop__select:focus-visible {
    outline: none;
    border-color: color-mix(in srgb, var(--accent-snippet) 55%, var(--border));
  }
  .dict-pop__select:disabled {
    opacity: 0.7;
    cursor: default;
  }
</style>
