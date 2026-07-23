//! Wraps `sherpa_onnx::OfflineRecognizer` loaded with the downloaded
//! SenseVoice model, plus the two pure pieces of decision logic the growing-
//! buffer loop needs: when a stretch of trailing audio counts as silence, and
//! how loud the buffer as a whole is.
//!
//! SenseVoice is not a streaming architecture (confirmed during design), so
//! there is no persistent decoder state to carry between calls: each `decode`
//! call creates a fresh `OfflineStream`, feeds it the buffer collected so
//! far, and reads back whatever text comes out. At 169x realtime this
//! "replay the growing buffer" loop is what makes interim results feel live
//! without a true causal-streaming model.

use std::path::Path;

use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig, OfflineSenseVoiceModelConfig};

/// How often the growing buffer is re-decoded for an interim result.
pub const COMMIT_INTERVAL_MS: u64 = 800;
/// How long a trailing stretch must sit below the RMS threshold before the
/// current buffer is finalized as committed text. Plain amplitude check — no
/// VAD model for v1 (see module docs on the design's scope cuts).
pub const SILENCE_HOLD_MS: u64 = 600;
/// Below this RMS, audio counts as silence. Normalized f32 PCM (±1.0 full
/// scale); ordinary room noise under a live mic sits well above this, quiet
/// mic hiss well below it.
pub const SILENCE_RMS_THRESHOLD: f32 = 0.01;

/// `OfflineRecognizer` is already `Send + Sync` (the sherpa-onnx crate treats
/// the underlying C library as thread-safe for single-object use), so `Engine`
/// inherits both automatically — no unsafe impl needed here.
pub struct Engine {
    recognizer: OfflineRecognizer,
}

impl Engine {
    /// Load the recognizer from the on-disk model + tokens file.
    /// `language` is passed straight through as SenseVoice's language hint:
    /// `"auto"`, `"en"`, or `"zh"`.
    pub fn load(model_path: &Path, tokens_path: &Path, language: &str) -> Result<Self, String> {
        let mut config = OfflineRecognizerConfig::default();
        config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
            model: Some(model_path.to_string_lossy().into_owned()),
            language: Some(language.to_string()),
            use_itn: true,
        };
        config.model_config.tokens = Some(tokens_path.to_string_lossy().into_owned());
        config.model_config.provider = Some("cpu".to_string());
        config.model_config.num_threads = 2;

        let recognizer = OfflineRecognizer::create(&config)
            .ok_or("failed to create the SenseVoice recognizer — check the model files")?;
        Ok(Self { recognizer })
    }

    /// Decode everything in `samples` (16kHz mono f32) as one utterance and
    /// return the transcribed text.
    pub fn decode(&self, samples: &[f32]) -> Result<String, String> {
        let stream = self.recognizer.create_stream();
        stream.accept_waveform(16_000, samples);
        self.recognizer.decode(&stream);
        Ok(stream.get_result().map(|r| r.text).unwrap_or_default())
    }
}

/// Root-mean-square amplitude of `samples` — 0.0 for an empty slice rather
/// than NaN, so a caller never has to special-case "no audio yet".
pub fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}

/// Has the tail of `samples` (16kHz mono f32) been quiet for at least
/// `hold_ms`? `false` while the buffer is still shorter than the hold window
/// — a fresh utterance is never mistaken for trailing silence.
pub fn is_trailing_silence(samples: &[f32], hold_ms: u64, threshold: f32) -> bool {
    let hold_samples = (16_000 * hold_ms / 1000) as usize;
    if hold_samples == 0 || samples.len() < hold_samples {
        return false;
    }
    rms(&samples[samples.len() - hold_samples..]) < threshold
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rms_of_silence_is_zero() {
        assert_eq!(rms(&[0.0; 100]), 0.0);
    }

    #[test]
    fn rms_of_empty_is_zero_not_nan() {
        assert_eq!(rms(&[]), 0.0);
    }

    #[test]
    fn rms_of_full_scale_square_wave_is_one() {
        let samples: Vec<f32> = (0..100).map(|i| if i % 2 == 0 { 1.0 } else { -1.0 }).collect();
        assert!((rms(&samples) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn a_short_buffer_is_never_trailing_silence() {
        // Under the hold window entirely — must not fire on the very first
        // callback of a fresh utterance just because it happens to be quiet.
        let samples = vec![0.0; 100]; // far fewer than 600ms @ 16kHz
        assert!(!is_trailing_silence(&samples, SILENCE_HOLD_MS, SILENCE_RMS_THRESHOLD));
    }

    #[test]
    fn quiet_tail_at_least_hold_ms_long_is_trailing_silence() {
        let hold_samples = (16_000 * SILENCE_HOLD_MS / 1000) as usize;
        let mut samples = vec![0.5; 1000]; // loud speech before the tail
        samples.extend(vec![0.0; hold_samples]); // then true silence
        assert!(is_trailing_silence(&samples, SILENCE_HOLD_MS, SILENCE_RMS_THRESHOLD));
    }

    #[test]
    fn loud_tail_is_not_trailing_silence() {
        let hold_samples = (16_000 * SILENCE_HOLD_MS / 1000) as usize;
        let samples = vec![0.5; hold_samples + 1000]; // loud throughout
        assert!(!is_trailing_silence(&samples, SILENCE_HOLD_MS, SILENCE_RMS_THRESHOLD));
    }

    #[test]
    fn a_tail_exactly_at_the_hold_boundary_counts() {
        let hold_samples = (16_000 * SILENCE_HOLD_MS / 1000) as usize;
        let samples = vec![0.0; hold_samples]; // exactly the hold window, all quiet
        assert!(is_trailing_silence(&samples, SILENCE_HOLD_MS, SILENCE_RMS_THRESHOLD));
    }
}
