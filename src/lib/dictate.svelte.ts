/**
 * Dictation store (Svelte 5 runes) — mirrors `prompts.svelte.ts`'s style: one
 * exported `$state` object + setter functions. Scope is deliberately narrow:
 * device, language, and model are the only controls (see
 * `src-tauri/src/dictate/` for the design rationale) — no waveform, no
 * transcript history.
 *
 * Interim text is store-only: it is shown in a dimmed strip near the mic
 * button, never written into the compose doc. Only a committed utterance
 * (`dictate:final`) ever touches the box, through the same untinted-insert
 * path `composeInsertText` gives it — repainting the box on every ~1s partial
 * would fight `ComposeBox.svelte`'s "only external inserts repaint" invariant
 * and yank the user's caret out from under them.
 */
import {
  listAudioDevices,
  startDictation,
  stopDictation,
  onDictatePartial,
  onDictateFinal,
  type AudioDevice,
} from './api';
import { composeInsertText } from './prompts.svelte';
import { toasts } from './prompts/toasts.svelte';

export type DictateLanguage = 'auto' | 'en' | 'zh';

export const dictate = $state({
  dictating: false,
  /** True while the model downloads on first use — the only reason a click
   *  on the mic might otherwise look like it did nothing for a while. */
  preparingModel: false,
  devices: [] as AudioDevice[],
  /** `null` = the system default input device. */
  selectedDevice: null as string | null,
  language: 'auto' as DictateLanguage,
  /** The utterance still being spoken, or '' between utterances. */
  interimText: '',
});

let listenersReady: Promise<void> | null = null;

/** Wire the two event listeners exactly once, lazily — no point subscribing
 *  before the mic has ever been used. */
function ensureListeners(): Promise<void> {
  if (!listenersReady) {
    listenersReady = (async () => {
      await onDictatePartial((text) => {
        dictate.interimText = text;
      });
      await onDictateFinal((text) => {
        dictate.interimText = '';
        composeInsertText(text);
      });
    })();
  }
  return listenersReady;
}

/** Populate the device picker. Call when the popover first opens — no point
 *  enumerating devices before the user has ever looked. */
export async function loadDevices(): Promise<void> {
  try {
    dictate.devices = await listAudioDevices();
  } catch (e) {
    toasts.push(`Couldn't list microphones: ${errText(e)}`);
  }
}

/** The mic button's one action: start if idle, stop if running. */
export async function toggleDictation(): Promise<void> {
  if (dictate.dictating) {
    await stopDictate();
  } else {
    await startDictate();
  }
}

async function startDictate(): Promise<void> {
  await ensureListeners();
  dictate.preparingModel = true;
  try {
    await startDictation(dictate.selectedDevice, dictate.language);
    dictate.dictating = true;
  } catch (e) {
    toasts.push(`Dictation failed to start: ${errText(e)}`);
  } finally {
    dictate.preparingModel = false;
  }
}

async function stopDictate(): Promise<void> {
  // Reflect "off" immediately — the final commit (if any) still arrives via
  // `dictate:final` once the backend flushes it.
  dictate.dictating = false;
  dictate.interimText = '';
  try {
    await stopDictation();
  } catch (e) {
    toasts.push(`Couldn't stop dictation cleanly: ${errText(e)}`);
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
