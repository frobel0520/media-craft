//! Zero-dependency ZIP archive writer (Store method + IEEE 802.3 CRC-32).
//! Images (WebP/JPEG/PNG) are already compressed, so Store mode provides instant packaging
//! with zero CPU overhead and universal compatibility across macOS, Windows, and Linux.

use crate::crc32::crc32;

#[derive(Debug, Clone)]
pub struct ZipEntry<'a> {
    pub name: &'a str,
    pub data: &'a [u8],
}

pub fn build_zip(entries: &[ZipEntry<'_>]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut central_dir = Vec::new();
    let mut file_count: u16 = 0;

    for entry in entries {
        let name_bytes = sanitize_zip_name(entry.name);
        let crc = crc32(entry.data);
        let size = entry.data.len() as u32;
        let name_len = name_bytes.len() as u16;
        let local_offset = out.len() as u32;

        // Local file header (30 bytes + name)
        out.extend_from_slice(&0x0403_4B50u32.to_le_bytes()); // signature
        out.extend_from_slice(&20u16.to_le_bytes());          // version needed (2.0)
        out.extend_from_slice(&0x0800u16.to_le_bytes());      // UTF-8 filename flag
        out.extend_from_slice(&0u16.to_le_bytes());           // compression: 0 (store)
        out.extend_from_slice(&0u16.to_le_bytes());           // mod time
        out.extend_from_slice(&0x5421u16.to_le_bytes());      // mod date (fixed deterministic)
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&size.to_le_bytes());           // compressed size
        out.extend_from_slice(&size.to_le_bytes());           // uncompressed size
        out.extend_from_slice(&name_len.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());           // extra field length
        out.extend_from_slice(&name_bytes);
        out.extend_from_slice(entry.data);

        // Central directory header (46 bytes + name)
        central_dir.extend_from_slice(&0x0201_4B50u32.to_le_bytes());
        central_dir.extend_from_slice(&20u16.to_le_bytes());          // version made by
        central_dir.extend_from_slice(&20u16.to_le_bytes());          // version needed
        central_dir.extend_from_slice(&0x0800u16.to_le_bytes());      // UTF-8 flag
        central_dir.extend_from_slice(&0u16.to_le_bytes());           // store
        central_dir.extend_from_slice(&0u16.to_le_bytes());           // mod time
        central_dir.extend_from_slice(&0x5421u16.to_le_bytes());      // mod date
        central_dir.extend_from_slice(&crc.to_le_bytes());
        central_dir.extend_from_slice(&size.to_le_bytes());
        central_dir.extend_from_slice(&size.to_le_bytes());
        central_dir.extend_from_slice(&name_len.to_le_bytes());
        central_dir.extend_from_slice(&0u16.to_le_bytes());           // extra len
        central_dir.extend_from_slice(&0u16.to_le_bytes());           // comment len
        central_dir.extend_from_slice(&0u16.to_le_bytes());           // disk number
        central_dir.extend_from_slice(&0u16.to_le_bytes());           // internal attrs
        central_dir.extend_from_slice(&0u32.to_le_bytes());           // external attrs
        central_dir.extend_from_slice(&local_offset.to_le_bytes());
        central_dir.extend_from_slice(&name_bytes);

        file_count = file_count.saturating_add(1);
    }

    let cd_offset = out.len() as u32;
    let cd_size = central_dir.len() as u32;
    out.extend_from_slice(&central_dir);

    // End of Central Directory (22 bytes)
    out.extend_from_slice(&0x0605_4B50u32.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());           // disk number
    out.extend_from_slice(&0u16.to_le_bytes());           // start disk
    out.extend_from_slice(&file_count.to_le_bytes());
    out.extend_from_slice(&file_count.to_le_bytes());
    out.extend_from_slice(&cd_size.to_le_bytes());
    out.extend_from_slice(&cd_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());           // comment length

    out
}

fn sanitize_zip_name(name: &str) -> Vec<u8> {
    let cleaned = name
        .replace('\\', "/")
        .trim_start_matches('/')
        .replace("../", "")
        .replace("..", "_");
    if cleaned.is_empty() {
        b"file.bin".to_vec()
    } else {
        cleaned.into_bytes()
    }
}
