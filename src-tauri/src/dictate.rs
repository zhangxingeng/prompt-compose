//! Local speech-to-text dictation: click the mic, speak, the transcribed text
//! lands at the compose box's cursor. English or Mandarin, one model
//! (SenseVoice-Small via `sherpa-onnx`), no waveform, no transcript history —
//! the scope is deliberately narrow (device / language / model, nothing else).
//!
//! Modules:
//!   `model`  — the pinned SenseVoice artifact: download, verify, extract.
//!              User-triggered (first mic use), unlike `prompts/embed.rs`'s
//!              always-silent background download.
//!   `audio`  — `cpal` device enumeration and live capture, downmixed to mono
//!              and resampled to 16kHz via `sherpa_onnx::LinearResampler`.
//!   `engine` — wraps `sherpa_onnx::OfflineRecognizer`; the growing-buffer
//!              replay loop's decode step, plus the RMS silence detector.
//!   `state`  — managed state and the Tauri commands.

mod audio;
mod engine;
mod model;

// Public so lib.rs can register the commands by their real paths.
pub mod state;
