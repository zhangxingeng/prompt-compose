//! Tauri commands for dictation — `list_audio_devices` / `start_dictation` /
//! `stop_dictation`, all async, `Result<T, String>`, snake_case, the same
//! conventions as `prompts::state`.
//!
//! Unlike the Prompt Library's semantic match (`prompts/embed.rs`), which
//! downloads and degrades silently because it is never a prerequisite for
//! anything, dictation is an explicit user action: the user clicked the mic
//! and is waiting on it. So every failure here — no mic permission, no input
//! devices, a failed model download — is a returned `Err` the frontend turns
//! into a toast, never a silent degradation.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::audio::AudioDevice;
use super::{audio, engine, model};

pub struct DictateState {
    inner: Arc<DictateInner>,
}

struct DictateInner {
    /// Set for the lifetime of one capture+decode session — guards against a
    /// second `start_dictation` racing the first.
    running: AtomicBool,
    /// Polled by the session loop every `COMMIT_INTERVAL_MS`; set by
    /// `stop_dictation` to end the session after one final flush.
    stop_requested: AtomicBool,
    /// Set for the lifetime of one `download_dictate_model` call — guards
    /// against a second click racing the first, same discipline as `running`.
    downloading: AtomicBool,
}

impl DictateState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(DictateInner {
                running: AtomicBool::new(false),
                stop_requested: AtomicBool::new(false),
                downloading: AtomicBool::new(false),
            }),
        }
    }
}

impl Default for DictateState {
    fn default() -> Self {
        Self::new()
    }
}

fn root() -> Result<PathBuf, String> {
    crate::datadir::data_root()
}

#[derive(Serialize, Clone)]
struct TextPayload {
    text: String,
}

#[derive(Serialize, Clone)]
struct ProgressPayload {
    fraction: f32,
}

/// The exact error `start_dictation` returns when the model hasn't been
/// downloaded yet. The frontend matches on this string to show its "download
/// the model in Settings first" message instead of a generic failure toast —
/// keep the two in sync (`src/lib/dictate.svelte.ts`).
pub const MODEL_NOT_DOWNLOADED: &str = "MODEL_NOT_DOWNLOADED";

#[tauri::command]
pub async fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    tauri::async_runtime::spawn_blocking(audio::list_input_devices).await.map_err(|e| e.to_string())?
}

/// Is the SenseVoice model already on disk? Settings uses this to decide
/// whether to show "Download" or "Ready", and the compose box uses it (via
/// the frontend's cached copy) to decide whether Space is allowed to start a
/// session at all.
#[tauri::command]
pub async fn dictate_model_status() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| Ok(model::artifacts_present(&root()?)))
        .await
        .map_err(|e| e.to_string())?
}

/// Download the SenseVoice model, reporting progress via `dictate:model-progress`
/// (`{ fraction: 0.0..=1.0 }`). Explicitly user-triggered from Settings — unlike
/// the old behavior, `start_dictation` never downloads on its own anymore, so a
/// click on the mic never looks like it's doing nothing while ~226MB fetches
/// silently in the background.
#[tauri::command]
pub async fn download_dictate_model(
    app: AppHandle,
    state: tauri::State<'_, DictateState>,
) -> Result<(), String> {
    let inner = state.inner.clone();
    if inner.downloading.swap(true, Ordering::SeqCst) {
        return Err("the model is already downloading".to_string());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let root = root()?;
        model::download_artifacts(&root, |fraction| {
            let _ = app.emit("dictate:model-progress", ProgressPayload { fraction });
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    inner.downloading.store(false, Ordering::SeqCst);
    result
}

/// Start one capture+decode session. Requires the model to already be on
/// disk — downloading it is Settings' job now, not this command's, since the
/// user just took an explicit action (held Space) and would otherwise wonder
/// why nothing happens for as long as a ~226MB download takes. Blocks only
/// long enough to load the recognizer and open the input device — everything
/// that can fail synchronously — then hands the running session off to a
/// dedicated background thread and returns. `stop_dictation` ends it.
///
/// `Engine` and `audio::Capture` are both `Send` (the sherpa-onnx recognizer
/// and cpal's `Stream` are each `Send + Sync` on every backend), so setup can
/// run on one blocking-pool thread and, once it succeeds, hand both off to a
/// second thread that owns the indefinite decode loop — no channel needed to
/// bridge them.
#[tauri::command]
pub async fn start_dictation(
    app: AppHandle,
    state: tauri::State<'_, DictateState>,
    device_id: Option<String>,
    language: String,
) -> Result<(), String> {
    let inner = state.inner.clone();
    if inner.running.swap(true, Ordering::SeqCst) {
        return Err("dictation is already running".to_string());
    }
    inner.stop_requested.store(false, Ordering::SeqCst);

    let setup: Result<(engine::Engine, audio::Capture), String> =
        tauri::async_runtime::spawn_blocking(move || {
            let root = root()?;
            if !model::artifacts_present(&root) {
                return Err(MODEL_NOT_DOWNLOADED.to_string());
            }
            let engine =
                engine::Engine::load(&model::model_path(&root), &model::tokens_path(&root), &language)?;
            let capture = audio::start_capture(device_id.as_deref())?;
            Ok((engine, capture))
        })
        .await
        .map_err(|e| e.to_string())?;

    match setup {
        Ok((engine, capture)) => {
            let session_inner = inner.clone();
            // Fire-and-forget: this JoinHandle is intentionally dropped
            // unawaited. The session runs until `stop_dictation` sets
            // `stop_requested`; awaiting it here would block the command
            // until the user stops dictating.
            tauri::async_runtime::spawn_blocking(move || run_session(app, session_inner, engine, capture));
            Ok(())
        }
        Err(e) => {
            inner.running.store(false, Ordering::SeqCst);
            Err(e)
        }
    }
}

/// Signal the running session to stop. It flushes whatever is left in the
/// buffer as one final commit (`dictate:final`) before tearing the capture
/// stream down — a mid-utterance stop must not silently drop the words
/// already spoken.
#[tauri::command]
pub async fn stop_dictation(state: tauri::State<'_, DictateState>) -> Result<(), String> {
    state.inner.stop_requested.store(true, Ordering::SeqCst);
    Ok(())
}

/// The growing-buffer loop: every `COMMIT_INTERVAL_MS`, re-decode everything
/// captured so far. A trailing stretch of silence finalizes the current
/// buffer as committed text (`dictate:final`) and resets for the next
/// utterance; otherwise the decode is an interim result (`dictate:partial`).
/// Runs until `stop_requested`, then does one last decode of whatever remains
/// so a stop mid-utterance never drops the words already spoken.
fn run_session(app: AppHandle, inner: Arc<DictateInner>, engine: engine::Engine, capture: audio::Capture) {
    let mut last_partial = String::new();

    loop {
        std::thread::sleep(Duration::from_millis(engine::COMMIT_INTERVAL_MS));
        if inner.stop_requested.load(Ordering::SeqCst) {
            break;
        }
        let Some(snapshot) = snapshot_buffer(&capture.buffer) else { continue };
        if snapshot.is_empty() {
            continue;
        }

        if engine::is_trailing_silence(&snapshot, engine::SILENCE_HOLD_MS, engine::SILENCE_RMS_THRESHOLD) {
            emit_final(&app, &engine, &snapshot);
            clear_buffer(&capture.buffer);
            last_partial.clear();
        } else {
            emit_partial_if_changed(&app, &engine, &snapshot, &mut last_partial);
        }
    }

    if let Some(remaining) = snapshot_buffer(&capture.buffer) {
        if !remaining.is_empty() {
            emit_final(&app, &engine, &remaining);
        }
    }
    capture.stop();
    inner.running.store(false, Ordering::SeqCst);
}

fn snapshot_buffer(buffer: &audio::SampleBuffer) -> Option<Vec<f32>> {
    buffer.lock().ok().map(|buf| buf.clone())
}

fn clear_buffer(buffer: &Mutex<Vec<f32>>) {
    if let Ok(mut buf) = buffer.lock() {
        buf.clear();
    }
}

fn emit_final(app: &AppHandle, engine: &engine::Engine, samples: &[f32]) {
    match engine.decode(samples) {
        Ok(text) if !text.trim().is_empty() => {
            let _ = app.emit("dictate:final", TextPayload { text });
        }
        Ok(_) => {}
        Err(e) => eprintln!("[dictate] decode failed: {e}"),
    }
}

fn emit_partial_if_changed(app: &AppHandle, engine: &engine::Engine, samples: &[f32], last: &mut String) {
    match engine.decode(samples) {
        Ok(text) if !text.trim().is_empty() && text != *last => {
            *last = text.clone();
            let _ = app.emit("dictate:partial", TextPayload { text });
        }
        Ok(_) => {}
        Err(e) => eprintln!("[dictate] decode failed: {e}"),
    }
}
