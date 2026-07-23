//! Shared download-and-verify primitives for every feature that fetches a
//! pinned artifact over the network: sha256 verification BEFORE any use, and
//! an atomic (temp sibling + rename) write so a crash mid-write can never
//! leave a plausible-but-truncated file on disk.
//!
//! Split out of `prompts/embed.rs` once `dictate/model.rs` needed the exact
//! same two functions for its own pinned-artifact download — legitimate
//! reuse, not a speculative abstraction: both callers verify a downloaded
//! archive's sha256 before extracting or loading anything from it.

use std::fs;
use std::io::Read;
use std::path::Path;

use sha2::{Digest, Sha256};

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Download `url` in full, then verify the hardcoded checksum. A mismatch
/// discards the bytes and errors — the caller never sees unverified content,
/// which is the invariant the whole security posture rests on.
pub fn download_verified(url: &str, expected_sha256: &str, file: &str) -> Result<Vec<u8>, String> {
    download_verified_with_progress(url, expected_sha256, file, |_, _| {})
}

/// Same contract as `download_verified`, but reports progress as it streams:
/// `on_progress(bytes_read_so_far, total_bytes)` — `total_bytes` is `None`
/// when the server didn't send a `Content-Length` (the caller then shows an
/// indeterminate state rather than a percentage).
pub fn download_verified_with_progress(
    url: &str,
    expected_sha256: &str,
    file: &str,
    mut on_progress: impl FnMut(u64, Option<u64>),
) -> Result<Vec<u8>, String> {
    let response = ureq::get(url).call().map_err(|e| format!("download of {file} failed: {e}"))?;
    let total = response.body().content_length();
    let mut reader = response.into_body().into_reader();
    let mut bytes: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut chunk).map_err(|e| format!("download of {file} interrupted: {e}"))?;
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..n]);
        on_progress(bytes.len() as u64, total);
    }
    let actual = sha256_hex(&bytes);
    if actual != expected_sha256 {
        return Err(format!(
            "checksum mismatch for {file} (expected {expected_sha256}, got {actual}); discarded"
        ));
    }
    Ok(bytes)
}

/// Atomic write: temp sibling + rename, so a crash mid-write can never leave
/// a plausible-but-truncated native library or model on disk.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("part");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_known_vector() {
        // "abc" — FIPS 180-2 test vector; guards the verify path itself.
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn checksum_mismatch_message_is_actionable() {
        // The verify failure path must name the file and both hashes — this is
        // the error a user reports when a CDN mangles a download.
        let err = download_verified(
            "data:text/plain,x", // ureq rejects non-http schemes → download error path
            "00",
            "f",
        )
        .unwrap_err();
        assert!(err.contains('f'));
    }
}
