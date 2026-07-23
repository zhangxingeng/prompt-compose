//! The pinned Whisper large-v3-turbo ONNX artifact: download, verify, extract.
//!
//! Unlike `prompts/embed.rs`'s always-silent background download, fetching
//! this model is an explicit Settings action (see `dictate::state`'s
//! `download_dictate_model`) — the user clicks Download and watches a
//! progress bar, rather than it happening implicitly the first time they try
//! to dictate.
//!
//! Security posture, same discipline as `embed.rs`: the archive is a single
//! GitHub release asset at a pinned tag, verified against a hardcoded sha256
//! BEFORE anything is extracted from it. A checksum mismatch discards the
//! bytes and errors; nothing is loaded that was not verified first.
//!
//! Model choice: replaced SenseVoice-Small after a real-voice comparison
//! (English technical jargon came out as unreadable caps-soup — "GET UP" for
//! GitHub, "CORNATTIE ENGINES" for Kubernetes) against Whisper large-v3-turbo,
//! which transcribed the same clips correctly in both English and Mandarin.
//! SenseVoice's fast, cheap decode was originally chosen to drive a live
//! "redecode the whole buffer every 800ms" partial-text loop — but that loop
//! is gone now too (`dictate::state` no longer emits partials at all: it was
//! an unbounded-cost hack, quadratic in utterance length, not a genuine
//! streaming architecture, and no accurate genuine-streaming bilingual model
//! exists yet). Dictation is one-shot now: decode once, when Space is
//! released.

use std::path::{Path, PathBuf};

use bzip2::read::BzDecoder;

use crate::net::{download_verified_with_progress, write_atomic};

/// Pinned release tag: `sherpa-onnx-whisper-turbo` (large-v3-turbo, int8).
/// Contains `turbo-encoder.int8.onnx` (~675MB), `turbo-decoder.int8.onnx`
/// (~361MB), and `turbo-tokens.txt` — a `test_wavs/` directory also exists in
/// the archive but is never extracted.
const ARCHIVE_URL: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-turbo.tar.bz2";
const ARCHIVE_SHA256: &str = "b11acbbcd660b44a8e0df33724feb5aaa709cf65668f2823d59f656312544f22";
const ARCHIVE_PREFIX: &str = "sherpa-onnx-whisper-turbo";

/// The three members this app actually needs out of the archive.
const ENCODER_FILE: &str = "turbo-encoder.int8.onnx";
const DECODER_FILE: &str = "turbo-decoder.int8.onnx";
const TOKENS_FILE: &str = "turbo-tokens.txt";

fn model_dir(root: &Path) -> PathBuf {
    root.join("models").join("sherpa-onnx-whisper-turbo")
}

pub fn encoder_path(root: &Path) -> PathBuf {
    model_dir(root).join(ENCODER_FILE)
}

pub fn decoder_path(root: &Path) -> PathBuf {
    model_dir(root).join(DECODER_FILE)
}

pub fn tokens_path(root: &Path) -> PathBuf {
    model_dir(root).join(TOKENS_FILE)
}

/// Are all three artifacts already on disk? Presence-only, like `embed.rs`'s
/// `artifacts_present` — content was checksummed at download time, and
/// re-hashing a ~1GB model on every check would make the UI crawl.
pub fn artifacts_present(root: &Path) -> bool {
    encoder_path(root).is_file() && decoder_path(root).is_file() && tokens_path(root).is_file()
}

/// Extract exactly one member from a verified `.tar.bz2` archive.
fn extract_member(archive: &[u8], member: &str) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut tar = tar::Archive::new(BzDecoder::new(archive));
    for entry in tar.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?;
        if path.to_string_lossy() == member && entry.header().entry_type().is_file() {
            let mut out = Vec::new();
            entry.read_to_end(&mut out).map_err(|e| e.to_string())?;
            return Ok(out);
        }
    }
    Err(format!("{member} not found in archive"))
}

/// Download + verify + extract the encoder, decoder, and tokens file,
/// skipping the work entirely if all three are already on disk — so a retry
/// after a failed or interrupted first attempt doesn't re-fetch ~540MB for
/// nothing. Blocking; the caller runs it on a background thread while
/// Settings shows a progress bar.
///
/// `on_progress(fraction)` reports 0.0–1.0; when the server didn't send a
/// `Content-Length` it is called once at the end with `1.0` rather than left
/// silent throughout.
pub fn download_artifacts(root: &Path, mut on_progress: impl FnMut(f32)) -> Result<(), String> {
    if artifacts_present(root) {
        on_progress(1.0);
        return Ok(());
    }
    let archive = download_verified_with_progress(
        ARCHIVE_URL,
        ARCHIVE_SHA256,
        "sherpa-onnx-whisper-turbo.tar.bz2",
        |downloaded, total| {
            if let Some(total) = total.filter(|t| *t > 0) {
                on_progress(downloaded as f32 / total as f32);
            }
        },
    )?;

    let encoder_member = format!("{ARCHIVE_PREFIX}/{ENCODER_FILE}");
    let decoder_member = format!("{ARCHIVE_PREFIX}/{DECODER_FILE}");
    let tokens_member = format!("{ARCHIVE_PREFIX}/{TOKENS_FILE}");
    let encoder_bytes = extract_member(&archive, &encoder_member)?;
    let decoder_bytes = extract_member(&archive, &decoder_member)?;
    let tokens_bytes = extract_member(&archive, &tokens_member)?;

    write_atomic(&encoder_path(root), &encoder_bytes)?;
    write_atomic(&decoder_path(root), &decoder_bytes)?;
    write_atomic(&tokens_path(root), &tokens_bytes)?;
    on_progress(1.0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn artifacts_present_is_false_until_all_three_files_exist() {
        let root = std::env::temp_dir()
            .join(format!("prompt-compose-dictate-model-test-{}", uuid::Uuid::new_v4()));
        assert!(!artifacts_present(&root));

        std::fs::create_dir_all(model_dir(&root)).unwrap();
        std::fs::write(encoder_path(&root), b"fake encoder").unwrap();
        assert!(!artifacts_present(&root), "decoder and tokens still missing");

        std::fs::write(decoder_path(&root), b"fake decoder").unwrap();
        assert!(!artifacts_present(&root), "tokens.txt still missing");

        std::fs::write(tokens_path(&root), b"fake tokens").unwrap();
        assert!(artifacts_present(&root));

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn extract_member_finds_exact_path_only() {
        let mut builder =
            tar::Builder::new(bzip2::write::BzEncoder::new(Vec::new(), bzip2::Compression::fast()));
        let payload = b"onnx-bytes-stand-in";
        let mut header = tar::Header::new_gnu();
        header.set_size(payload.len() as u64);
        header.set_cksum();
        builder
            .append_data(&mut header, format!("{ARCHIVE_PREFIX}/{ENCODER_FILE}"), payload.as_slice())
            .unwrap();
        let archive = builder.into_inner().unwrap().finish().unwrap();

        assert_eq!(
            extract_member(&archive, &format!("{ARCHIVE_PREFIX}/{ENCODER_FILE}")).unwrap(),
            payload
        );
        assert!(extract_member(&archive, &format!("{ARCHIVE_PREFIX}/{DECODER_FILE}")).is_err());
    }

    /// The real pinned archive: download, verify, extract all three members.
    /// Network and ~540MB, so it is opt-in for the *test runner*
    /// (`cargo test --lib -- --ignored`), not for the user — same discipline
    /// as `embed.rs`'s `full_semantic_path_downloads_loads_and_embeds`.
    #[test]
    #[ignore = "network + ~540MB download; run explicitly with -- --ignored"]
    fn full_download_path_fetches_verifies_and_extracts() {
        let root = std::env::temp_dir()
            .join(format!("prompt-compose-dictate-model-e2e-{}", uuid::Uuid::new_v4()));
        download_artifacts(&root, |_| {}).expect("download + verify + extract");
        assert!(artifacts_present(&root));
        assert!(std::fs::metadata(encoder_path(&root)).unwrap().len() > 500_000_000);
        assert!(std::fs::metadata(decoder_path(&root)).unwrap().len() > 200_000_000);
        assert!(std::fs::metadata(tokens_path(&root)).unwrap().len() > 100_000);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
