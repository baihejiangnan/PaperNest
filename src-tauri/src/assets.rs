//! Turn a local image referenced by a document into a `data:` URL.
//!
//! The WebView can load neither the editor's nor the print view's images by
//! filesystem path, so both routes (the `read_image_data_url` command and the
//! HTML export) resolve the path here, read the bytes and inline them.

use std::io::Read;
use std::path::{Path, PathBuf};

/// Largest image we will inline as a data URL.
pub const MAX_IMAGE_BYTES: usize = 24 * 1024 * 1024;

/// `true` for targets the WebView can already load — leave those untouched.
pub fn is_external(src: &str) -> bool {
    let s = src.trim();
    s.is_empty()
        || s.starts_with("//")
        || s.starts_with("data:")
        || s.starts_with("http://")
        || s.starts_with("https://")
        || s.starts_with("blob:")
}

/// Resolve `src` (a raw Markdown image target) against `doc_path`'s folder,
/// read the file and return it as `data:<mime>;base64,<…>`.
///
/// Only files with an image extension whose bytes also look like that kind of
/// image are accepted, so a document cannot inline (and leak into an export)
/// an arbitrary local file such as a key or a config file.
pub fn to_data_url(doc_path: Option<&str>, src: &str) -> Result<String, String> {
    let decoded = percent_decode(src.trim().trim_start_matches("./"));
    let target = PathBuf::from(&decoded);

    let resolved = if target.is_absolute() {
        target
    } else {
        let base = doc_path
            .map(Path::new)
            .and_then(Path::parent)
            .ok_or("relative image path, but this document has not been saved yet")?;
        base.join(target)
    };

    let Some(mime) = image_mime(&resolved) else {
        return Err(format!("{} is not a supported image type", resolved.display()));
    };
    let file = std::fs::File::open(&resolved)
        .map_err(|e| format!("cannot read image {}: {e}", resolved.display()))?;
    let size = file
        .metadata()
        .map_err(|e| format!("cannot read image {}: {e}", resolved.display()))?
        .len();
    if size > MAX_IMAGE_BYTES as u64 {
        return Err(format!(
            "image {} is too large ({} MiB)",
            resolved.display(),
            size / (1024 * 1024)
        ));
    }
    // The file may grow after the metadata check. Bound the read as well.
    let mut bytes = Vec::with_capacity(size as usize);
    file.take(MAX_IMAGE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("cannot read image {}: {e}", resolved.display()))?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(format!(
            "image {} is too large ({} MiB)",
            resolved.display(),
            bytes.len() / (1024 * 1024)
        ));
    }

    if !content_matches(mime, &bytes) {
        return Err(format!("{} is not a valid image file", resolved.display()));
    }

    Ok(format!("data:{mime};base64,{}", base64_encode(&bytes)))
}

fn image_mime(path: &Path) -> Option<&'static str> {
    let mime = match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("apng") => "image/apng",
        Some("jpg" | "jpeg" | "jfif") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        Some("avif") => "image/avif",
        Some("ico") => "image/x-icon",
        _ => return None,
    };
    Some(mime)
}

/// Check the file signature. Raster formats are often saved with the wrong
/// extension (a PNG named `.jpg`), so any raster signature is accepted for any
/// raster extension; SVG must be text that contains an `<svg` element.
fn content_matches(mime: &str, bytes: &[u8]) -> bool {
    if mime == "image/svg+xml" {
        let head = &bytes[..bytes.len().min(64 * 1024)];
        return String::from_utf8_lossy(head).to_ascii_lowercase().contains("<svg");
    }
    let starts = |sig: &[u8]| bytes.starts_with(sig);
    starts(b"\x89PNG\r\n\x1a\n")
        || starts(&[0xFF, 0xD8, 0xFF])
        || starts(b"GIF87a")
        || starts(b"GIF89a")
        || (starts(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"))
        || starts(b"BM")
        || starts(&[0, 0, 1, 0])
        || bytes.get(4..8) == Some(b"ftyp")
}

/// Minimal `%XX` decoder for Markdown image targets (spaces, parentheses, …).
pub(crate) fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Standard base64 (with padding). Kept local to avoid a dependency for the two
/// places we need it — see `assets/export/` for the pre-encoded font blobs.
pub fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{
        base64_encode, image_mime, is_external, percent_decode, to_data_url, MAX_IMAGE_BYTES,
    };
    use std::path::Path;

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn percent_decode_handles_spaces_and_literals() {
        assert_eq!(percent_decode("a%20b.png"), "a b.png");
        assert_eq!(percent_decode("plain.png"), "plain.png");
        assert_eq!(percent_decode("100%"), "100%");
    }

    #[test]
    fn mime_by_extension() {
        assert_eq!(image_mime(Path::new("x.PNG")), Some("image/png"));
        assert_eq!(image_mime(Path::new("x.jpeg")), Some("image/jpeg"));
        assert_eq!(image_mime(Path::new("x.svg")), Some("image/svg+xml"));
        assert_eq!(image_mime(Path::new("x.unknown")), None);
        assert_eq!(image_mime(Path::new("id_rsa")), None);
    }

    #[test]
    fn only_real_images_are_inlined() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("doc.md");
        let write = |name: &str, bytes: &[u8]| std::fs::write(dir.path().join(name), bytes).unwrap();
        write("secret.txt", b"password");
        write("fake.png", b"password");
        write("real.png", b"\x89PNG\r\n\x1a\nrest");
        write("misnamed.jpg", b"\x89PNG\r\n\x1a\nrest");
        write("icon.svg", b"<?xml version='1.0'?><svg xmlns='http://www.w3.org/2000/svg'/>");
        let read = |src: &str| to_data_url(doc.to_str(), src);

        assert!(read("secret.txt").unwrap_err().contains("not a supported image type"));
        assert!(read("fake.png").unwrap_err().contains("not a valid image"));
        assert!(read("real.png").unwrap().starts_with("data:image/png;base64,"));
        assert!(read("misnamed.jpg").unwrap().starts_with("data:image/jpeg;base64,"));
        assert!(read("icon.svg").unwrap().starts_with("data:image/svg+xml;base64,"));
    }

    #[test]
    fn external_targets_are_left_alone() {
        assert!(is_external("https://example.com/a.png"));
        assert!(is_external("data:image/png;base64,AAAA"));
        assert!(is_external(""));
        assert!(!is_external("pic.png"));
        assert!(!is_external("../assets/pic.png"));
    }

    #[test]
    fn oversized_image_is_rejected_before_encoding() {
        let path = std::env::temp_dir().join(format!(
            "papernest-image-limit-{}-{}.png",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_IMAGE_BYTES as u64 + 1).unwrap();
        drop(file);
        let result = to_data_url(None, path.to_str().unwrap());
        std::fs::remove_file(path).unwrap();
        assert!(result.unwrap_err().contains("too large"));
    }
}
