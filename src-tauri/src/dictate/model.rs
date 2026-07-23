//! The pinned SenseVoice ONNX artifact: download, verify, extract.
//!
//! Unlike `prompts/embed.rs`'s always-silent background download, fetching
//! this model is **user-triggered** — the first time the mic button is used —
//! because the user just took an explicit action (clicking the mic) and would
//! otherwise wonder why nothing happens for ~226MB worth of download time. The
//! frontend surfaces a "preparing…" state while `download_artifacts` runs.
//!
//! Security posture, same discipline as `embed.rs`: the archive is a single
//! GitHub release asset at a pinned tag, verified against a hardcoded sha256
//! BEFORE anything is extracted from it. A checksum mismatch discards the
//! bytes and errors; nothing is loaded that was not verified first.

use std::path::{Path, PathBuf};

use bzip2::read::BzDecoder;

use crate::net::{download_verified_with_progress, write_atomic};

/// Pinned release tag: `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09`.
/// Contains `model.int8.onnx` (~226MB) and `tokens.txt` (~308KB) — a few
/// other files (README, test_wavs/) exist in the archive but are never
/// extracted.
const ARCHIVE_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2";
const ARCHIVE_SHA256: &str = "7305f7905bfcf77fa0b39388a313f3da35c68d971661a65475b56fb2162c8e63";
const ARCHIVE_PREFIX: &str = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09";

/// The two members this app actually needs out of the archive.
const MODEL_FILE: &str = "model.int8.onnx";
const TOKENS_FILE: &str = "tokens.txt";

fn model_dir(root: &Path) -> PathBuf {
    root.join("models").join("sherpa-onnx-sense-voice-small")
}

pub fn model_path(root: &Path) -> PathBuf {
    model_dir(root).join(MODEL_FILE)
}

pub fn tokens_path(root: &Path) -> PathBuf {
    model_dir(root).join(TOKENS_FILE)
}

/// Are both artifacts already on disk? Presence-only, like `embed.rs`'s
/// `artifacts_present` — content was checksummed at download time, and
/// re-hashing a 226MB model on every check would make the UI crawl.
pub fn artifacts_present(root: &Path) -> bool {
    model_path(root).is_file() && tokens_path(root).is_file()
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

/// Download + verify + extract the model and tokens file, skipping the work
/// entirely if both are already on disk — so a retry after a failed or
/// interrupted first attempt doesn't re-fetch 158MB for nothing. Blocking.
///
/// This is now a Settings-only, explicitly user-triggered action (never an
/// implicit side effect of trying to dictate — see `dictate::state`), so
/// `on_progress(fraction)` reports 0.0–1.0 for a progress bar; when the
/// server didn't send a `Content-Length` it is called once at the end with
/// `1.0` rather than left silent throughout.
pub fn download_artifacts(root: &Path, mut on_progress: impl FnMut(f32)) -> Result<(), String> {
    if artifacts_present(root) {
        on_progress(1.0);
        return Ok(());
    }
    let archive = download_verified_with_progress(
        ARCHIVE_URL,
        ARCHIVE_SHA256,
        "sherpa-onnx-sense-voice-small.tar.bz2",
        |downloaded, total| {
            if let Some(total) = total.filter(|t| *t > 0) {
                on_progress(downloaded as f32 / total as f32);
            }
        },
    )?;

    let model_member = format!("{ARCHIVE_PREFIX}/{MODEL_FILE}");
    let tokens_member = format!("{ARCHIVE_PREFIX}/{TOKENS_FILE}");
    let model_bytes = extract_member(&archive, &model_member)?;
    let tokens_bytes = extract_member(&archive, &tokens_member)?;

    write_atomic(&model_path(root), &model_bytes)?;
    write_atomic(&tokens_path(root), &tokens_bytes)?;
    on_progress(1.0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn artifacts_present_is_false_until_both_files_exist() {
        let root = std::env::temp_dir()
            .join(format!("prompt-compose-dictate-model-test-{}", uuid::Uuid::new_v4()));
        assert!(!artifacts_present(&root));

        std::fs::create_dir_all(model_dir(&root)).unwrap();
        std::fs::write(model_path(&root), b"fake model").unwrap();
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
            .append_data(&mut header, format!("{ARCHIVE_PREFIX}/{MODEL_FILE}"), payload.as_slice())
            .unwrap();
        let archive = builder.into_inner().unwrap().finish().unwrap();

        assert_eq!(
            extract_member(&archive, &format!("{ARCHIVE_PREFIX}/{MODEL_FILE}")).unwrap(),
            payload
        );
        assert!(extract_member(&archive, &format!("{ARCHIVE_PREFIX}/{TOKENS_FILE}")).is_err());
    }

    /// The real pinned archive: download, verify, extract both members.
    /// Network and ~158MB, so it is opt-in for the *test runner*
    /// (`cargo test --lib -- --ignored`), not for the user — same discipline
    /// as `embed.rs`'s `full_semantic_path_downloads_loads_and_embeds`.
    #[test]
    #[ignore = "network + ~158MB download; run explicitly with -- --ignored"]
    fn full_download_path_fetches_verifies_and_extracts() {
        let root = std::env::temp_dir()
            .join(format!("prompt-compose-dictate-model-e2e-{}", uuid::Uuid::new_v4()));
        download_artifacts(&root, |_| {}).expect("download + verify + extract");
        assert!(artifacts_present(&root));
        assert!(std::fs::metadata(model_path(&root)).unwrap().len() > 100_000_000);
        assert!(std::fs::metadata(tokens_path(&root)).unwrap().len() > 100_000);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
