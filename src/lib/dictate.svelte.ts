/**
 * Dictation store (Svelte 5 runes) — mirrors `prompts.svelte.ts`'s style: one
 * exported `$state` object + setter functions. Scope is deliberately narrow:
 * device, language, and model are the only controls (see
 * `src-tauri/src/dictate/` for the design rationale) — no waveform, no
 * transcript history.
 *
 * Push-to-talk, not a toggle: `startPushToTalk`/`stopPushToTalk` are driven
 * by the compose box holding Space (`ComposeBox.svelte`), not by clicking a
 * button — a click-to-toggle mic was tried and dropped as an extra step that
 * added nothing.
 *
 * The model is a Settings-only download (`downloadModel`) now, never an
 * implicit side effect of starting a session — `modelReady` is checked
 * before ever calling `startDictation`, so holding Space with no model on
 * disk shows an explanatory toast instead of a silent multi-minute stall.
 *
 * Interim text is store-only: it is shown in a dimmed strip near the mic
 * indicator, never written into the compose doc. Only a committed utterance
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
  dictateModelStatus,
  downloadDictateModel,
  onDictateModelProgress,
  MODEL_NOT_DOWNLOADED,
  type AudioDevice,
} from './api';
import { composeInsertText } from './prompts.svelte';
import { toasts } from './prompts/toasts.svelte';

export type DictateLanguage = 'auto' | 'en' | 'zh';

export const dictate = $state({
  dictating: false,
  /** True for the brief window between holding Space and the mic stream
   *  actually opening (engine load + device open) — no download happens
   *  here anymore, so this is short. */
  preparingModel: false,
  devices: [] as AudioDevice[],
  /** `null` = the system default input device. */
  selectedDevice: null as string | null,
  language: 'auto' as DictateLanguage,
  /** The utterance still being spoken, or '' between utterances. */
  interimText: '',
  /** Whether the SenseVoice model is on disk. Checked once at startup and
   *  kept current by `downloadModel` — Space refuses instantly when this is
   *  false rather than round-tripping to the backend to find out. */
  modelReady: false,
  modelDownloading: false,
  /** 0..1 while `modelDownloading`; meaningless otherwise. */
  modelProgress: 0,
});

let listenersReady: Promise<void> | null = null;

/** Wire the two transcript event listeners exactly once, lazily — no point
 *  subscribing before the mic has ever been used. */
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

/** Refresh whether the model is on disk. Call once at app startup so Space's
 *  first press already knows, without waiting on a round trip. */
export async function refreshModelStatus(): Promise<void> {
  try {
    dictate.modelReady = await dictateModelStatus();
  } catch {
    // Leave modelReady as-is; the next start attempt will surface a real error.
  }
}

/** Settings' Download button. Guards against a second concurrent download
 *  the same way the backend does, so a double-click can't race two fetches. */
export async function downloadModel(): Promise<void> {
  if (dictate.modelDownloading) return;
  dictate.modelDownloading = true;
  dictate.modelProgress = 0;
  const unlisten = await onDictateModelProgress((fraction) => {
    dictate.modelProgress = fraction;
  });
  try {
    await downloadDictateModel();
    dictate.modelReady = true;
  } catch (e) {
    toasts.push(`Model download failed: ${errText(e)}`);
  } finally {
    dictate.modelDownloading = false;
    unlisten();
  }
}

/** Hold-Space start. No-ops if already dictating (a key-repeat guard lives in
 *  `ComposeBox.svelte`, this is a second line of defense) or if the model
 *  isn't downloaded yet — that case shows an explanatory toast pointing at
 *  Settings instead of trying and failing inside the backend. */
export async function startPushToTalk(): Promise<void> {
  if (dictate.dictating || dictate.preparingModel) return;
  if (!dictate.modelReady) {
    toasts.push('Download the speech-to-text model in Settings before dictating.');
    return;
  }
  await ensureListeners();
  dictate.preparingModel = true;
  try {
    await startDictation(dictate.selectedDevice, dictate.language);
    dictate.dictating = true;
  } catch (e) {
    // Tauri rejects `Result::Err(String)` with the bare string, not an
    // `Error` instance — compare the stringified form either way.
    if (errText(e).includes(MODEL_NOT_DOWNLOADED)) {
      dictate.modelReady = false;
      toasts.push('Download the speech-to-text model in Settings before dictating.');
    } else {
      toasts.push(`Dictation failed to start: ${errText(e)}`);
    }
  } finally {
    dictate.preparingModel = false;
  }
}

/** Space-release stop. Safe to call when nothing is running (a release with
 *  no matching press, e.g. after a failed start) — `stopDictation` itself is
 *  a no-op on the backend in that case. */
export async function stopPushToTalk(): Promise<void> {
  if (!dictate.dictating) return;
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
