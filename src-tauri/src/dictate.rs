//! Local speech-to-text dictation: hold Space in the compose box, speak,
//! release — the transcribed text lands at the cursor. English or Mandarin,
//! one model (Whisper large-v3-turbo via `sherpa-onnx`), no waveform, no
//! transcript history — the scope is deliberately narrow (device / language /
//! model, nothing else). One-shot, not streaming: the whole utterance is
//! decoded exactly once, on release.
//!
//! Modules:
//!   `model`  — the pinned Whisper artifact: download, verify, extract.
//!              Explicitly triggered from Settings, unlike `prompts/embed.rs`'s
//!              always-silent background download.
//!   `audio`  — `cpal` device enumeration and live capture, downmixed to mono
//!              and resampled to 16kHz via `sherpa_onnx::LinearResampler`.
//!   `engine` — wraps `sherpa_onnx::OfflineRecognizer`; chunks audio over 30s
//!              into sequential windows since sherpa-onnx's Whisper decoder
//!              silently truncates a single call at 30 seconds.
//!   `state`  — managed state and the Tauri commands.

mod audio;
mod engine;
mod model;

// Public so lib.rs can register the commands by their real paths.
pub mod state;
