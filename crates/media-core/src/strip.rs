//! Lossless binary metadata stripping for JPEG, PNG, and WebP.

use crate::format::{ImageFormat, detect_format};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StripResult {
    pub bytes: Vec<u8>,
    pub bytes_removed: usize,
    pub format: ImageFormat,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StripError {
    EmptyInput,
    UnsupportedFormat,
    MalformedFile(&'static str),
}

/// Losslessly strips EXIF, GPS, XMP, IPTC, comments, and ancillary text chunks from
/// JPEG, PNG, or WebP without re-encoding image pixel data.
pub fn strip_metadata(data: &[u8]) -> Result<StripResult, StripError> {
    if data.is_empty() {
        return Err(StripError::EmptyInput);
    }
    let format = detect_format(data);
    let cleaned = match format {
        ImageFormat::Jpeg => strip_jpeg(data)?,
        ImageFormat::Png => strip_png(data)?,
        ImageFormat::Webp => strip_webp(data)?,
        _ => return Err(StripError::UnsupportedFormat),
    };
    let bytes_removed = data.len().saturating_sub(cleaned.len());
    Ok(StripResult {
        bytes: cleaned,
        bytes_removed,
        format,
    })
}

fn strip_jpeg(data: &[u8]) -> Result<Vec<u8>, StripError> {
    if data.len() < 4 || data[0] != 0xFF || data[1] != 0xD8 {
        return Err(StripError::MalformedFile("Invalid JPEG SOI header"));
    }

    let mut out = Vec::with_capacity(data.len());
    out.extend_from_slice(&[0xFF, 0xD8]);

    let mut i = 2usize;
    while i < data.len() {
        if data[i] != 0xFF {
            return Err(StripError::MalformedFile("Expected JPEG marker prefix"));
        }
        while i < data.len() && data[i] == 0xFF {
            i += 1;
        }
        if i >= data.len() {
            break;
        }
        let marker = data[i];
        i += 1;

        // End of Image
        if marker == 0xD9 {
            out.extend_from_slice(&[0xFF, 0xD9]);
            break;
        }

        // Start of Scan: copy the rest of the entropy-coded image stream verbatim.
        if marker == 0xDA {
            out.extend_from_slice(&[0xFF, 0xDA]);
            out.extend_from_slice(&data[i..]);
            break;
        }

        // Standalone markers (RST0..RST7, TEM)
        if (0xD0..=0xD7).contains(&marker) || marker == 0x01 {
            out.extend_from_slice(&[0xFF, marker]);
            continue;
        }

        if i + 2 > data.len() {
            return Err(StripError::MalformedFile("Truncated JPEG segment length"));
        }
        let seg_len = u16::from_be_bytes([data[i], data[i + 1]]) as usize;
        if seg_len < 2 || i + seg_len > data.len() {
            return Err(StripError::MalformedFile("Invalid JPEG segment length"));
        }

        // Drop APP1..APP15 (0xE1..=0xEF: EXIF, XMP, ICC, IPTC, Adobe) and COM (0xFE).
        // Keep APP0 (JFIF) and all decoding/frame/Huffman/quantization tables.
        let drop_segment = matches!(marker, 0xE1..=0xEF | 0xFE);
        if !drop_segment {
            out.extend_from_slice(&[0xFF, marker]);
            out.extend_from_slice(&data[i..i + seg_len]);
        }

        i += seg_len;
    }

    Ok(out)
}

fn strip_png(data: &[u8]) -> Result<Vec<u8>, StripError> {
    if data.len() < 8 || &data[..8] != b"\x89PNG\r\n\x1a\n" {
        return Err(StripError::MalformedFile("Invalid PNG signature"));
    }

    let mut out = Vec::with_capacity(data.len());
    out.extend_from_slice(&data[..8]);

    let mut i = 8usize;
    let mut saw_iend = false;
    while i + 12 <= data.len() {
        let len = u32::from_be_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]) as usize;
        let chunk_type = &data[i + 4..i + 8];
        let Some(next) = i.checked_add(12).and_then(|v| v.checked_add(len)) else {
            return Err(StripError::MalformedFile("PNG chunk length overflow"));
        };
        if next > data.len() {
            return Err(StripError::MalformedFile("Truncated PNG chunk"));
        }

        // Keep critical chunks (uppercase first byte: IHDR, PLTE, IDAT, IEND) and
        // visual/animation ancillary chunks (tRNS, sRGB, gAMA, cHRM, acTL, fcTL, fdAT).
        // Strip privacy/metadata ancillary chunks (eXIf, tEXt, zTXt, iTXt, tIME, pHYs, iCCP, etc.).
        let is_critical = (chunk_type[0] & 0x20) == 0;
        let keep_ancillary = matches!(
            chunk_type,
            b"tRNS" | b"sRGB" | b"gAMA" | b"cHRM" | b"acTL" | b"fcTL" | b"fdAT"
        );

        if is_critical || keep_ancillary {
            out.extend_from_slice(&data[i..next]);
        }

        i = next;
        if chunk_type == b"IEND" {
            saw_iend = true;
            break;
        }
    }

    if !saw_iend {
        return Err(StripError::MalformedFile("Missing PNG IEND chunk"));
    }

    Ok(out)
}

fn strip_webp(data: &[u8]) -> Result<Vec<u8>, StripError> {
    if data.len() < 12 || &data[..4] != b"RIFF" || &data[8..12] != b"WEBP" {
        return Err(StripError::MalformedFile("Invalid WebP RIFF header"));
    }

    let mut body = Vec::with_capacity(data.len());
    let mut i = 12usize;
    let mut vp8x_flags_pos: Option<usize> = None;

    while i + 8 <= data.len() {
        let fourcc = &data[i..i + 4];
        let size = u32::from_le_bytes([data[i + 4], data[i + 5], data[i + 6], data[i + 7]]) as usize;
        let padded = size.saturating_add(size & 1);
        let Some(next) = i.checked_add(8).and_then(|v| v.checked_add(padded)) else {
            return Err(StripError::MalformedFile("WebP chunk length overflow"));
        };
        let Some(data_end) = i.checked_add(8).and_then(|v| v.checked_add(size)) else {
            return Err(StripError::MalformedFile("WebP chunk data overflow"));
        };
        if data_end > data.len() {
            return Err(StripError::MalformedFile("Truncated WebP chunk"));
        }

        let drop_chunk = matches!(fourcc, b"EXIF" | b"XMP " | b"ICCP");
        if !drop_chunk {
            if fourcc == b"VP8X" && size >= 1 {
                vp8x_flags_pos = Some(body.len() + 8);
            }
            let copy_end = next.min(data.len());
            body.extend_from_slice(&data[i..copy_end]);
            if copy_end < next {
                // Ensure even-byte RIFF padding if final chunk was odd-sized without trailing pad.
                body.push(0);
            }
        }

        i = next;
    }

    // Clear ICC (bit 5 = 0x20), EXIF (bit 3 = 0x08), and XMP (bit 2 = 0x04) flags in VP8X.
    if let Some(pos) = vp8x_flags_pos
        && let Some(flags) = body.get_mut(pos)
    {
        *flags &= !(0x20 | 0x08 | 0x04);
    }

    let riff_size = (4usize.saturating_add(body.len())) as u32;
    let mut out = Vec::with_capacity(12 + body.len());
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&riff_size.to_le_bytes());
    out.extend_from_slice(b"WEBP");
    out.extend_from_slice(&body);
    Ok(out)
}
