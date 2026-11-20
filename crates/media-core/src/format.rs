//! Magic-byte image format detection and header dimension parsing.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageFormat {
    Jpeg,
    Png,
    Webp,
    Avif,
    Gif,
    Bmp,
    Svg,
    Ico,
    Unknown,
}

impl ImageFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Jpeg => "jpeg",
            Self::Png => "png",
            Self::Webp => "webp",
            Self::Avif => "avif",
            Self::Gif => "gif",
            Self::Bmp => "bmp",
            Self::Svg => "svg",
            Self::Ico => "ico",
            Self::Unknown => "unknown",
        }
    }

    pub fn mime_type(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::Webp => "image/webp",
            Self::Avif => "image/avif",
            Self::Gif => "image/gif",
            Self::Bmp => "image/bmp",
            Self::Svg => "image/svg+xml",
            Self::Ico => "image/x-icon",
            Self::Unknown => "application/octet-stream",
        }
    }
}

pub fn detect_format(data: &[u8]) -> ImageFormat {
    if data.len() >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
        return ImageFormat::Jpeg;
    }
    if data.len() >= 8 && &data[..8] == b"\x89PNG\r\n\x1a\n" {
        return ImageFormat::Png;
    }
    if data.len() >= 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        return ImageFormat::Webp;
    }
    if is_avif(data) {
        return ImageFormat::Avif;
    }
    if data.len() >= 6 && (&data[..6] == b"GIF87a" || &data[..6] == b"GIF89a") {
        return ImageFormat::Gif;
    }
    if data.len() >= 2 && &data[..2] == b"BM" {
        return ImageFormat::Bmp;
    }
    if data.len() >= 6
        && data[0] == 0x00
        && data[1] == 0x00
        && data[2] == 0x01
        && data[3] == 0x00
        && u16::from_le_bytes([data[4], data[5]]) >= 1
    {
        return ImageFormat::Ico;
    }
    if is_svg(data) {
        return ImageFormat::Svg;
    }
    ImageFormat::Unknown
}

pub fn parse_dimensions(data: &[u8], format: ImageFormat) -> Option<(u32, u32)> {
    match format {
        ImageFormat::Png => parse_png_dimensions(data),
        ImageFormat::Jpeg => parse_jpeg_dimensions(data),
        ImageFormat::Webp => parse_webp_dimensions(data),
        ImageFormat::Avif => parse_avif_dimensions(data),
        ImageFormat::Gif => parse_gif_dimensions(data),
        ImageFormat::Bmp => parse_bmp_dimensions(data),
        ImageFormat::Ico => parse_ico_dimensions(data),
        ImageFormat::Svg => parse_svg_dimensions(data),
        ImageFormat::Unknown => None,
    }
}

fn parse_png_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if data.len() < 24 || &data[12..16] != b"IHDR" {
        return None;
    }
    let w = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
    let h = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);
    Some((w, h))
}

fn parse_jpeg_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if data.len() < 4 || data[0] != 0xFF || data[1] != 0xD8 {
        return None;
    }
    let mut i = 2usize;
    while i + 1 < data.len() {
        while i < data.len() && data[i] != 0xFF {
            i += 1;
        }
        while i < data.len() && data[i] == 0xFF {
            i += 1;
        }
        if i >= data.len() {
            break;
        }
        let marker = data[i];
        i += 1;

        if marker == 0xD9 || marker == 0xDA {
            break;
        }
        if (0xD0..=0xD7).contains(&marker) || marker == 0x01 {
            continue;
        }
        if i + 2 > data.len() {
            break;
        }
        let seg_len = u16::from_be_bytes([data[i], data[i + 1]]) as usize;
        if seg_len < 2 || i + seg_len > data.len() {
            break;
        }

        // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
        let is_sof = matches!(
            marker,
            0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF
        );
        if is_sof && seg_len >= 7 {
            let h = u16::from_be_bytes([data[i + 3], data[i + 4]]) as u32;
            let w = u16::from_be_bytes([data[i + 5], data[i + 6]]) as u32;
            return Some((w, h));
        }

        i += seg_len;
    }
    None
}

fn parse_webp_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if data.len() < 30 {
        return None;
    }
    let chunk = &data[12..16];
    match chunk {
        b"VP8X" => {
            // Canvas width minus 1 at bytes 24..27, height minus 1 at 27..30 (24-bit LE)
            let w = 1 + (data[24] as u32 | ((data[25] as u32) << 8) | ((data[26] as u32) << 16));
            let h = 1 + (data[27] as u32 | ((data[28] as u32) << 8) | ((data[29] as u32) << 16));
            Some((w, h))
        }
        b"VP8 " => {
            // Lossy VP8 bitstream header starts at byte 20
            if data.len() < 30 || data[23] != 0x9D || data[24] != 0x01 || data[25] != 0x2A {
                return None;
            }
            let w = (u16::from_le_bytes([data[26], data[27]]) & 0x3FFF) as u32;
            let h = (u16::from_le_bytes([data[28], data[29]]) & 0x3FFF) as u32;
            Some((w, h))
        }
        b"VP8L" => {
            if data.len() < 25 || data[20] != 0x2F {
                return None;
            }
            let bits = u32::from_le_bytes([data[21], data[22], data[23], data[24]]);
            let w = (bits & 0x3FFF) + 1;
            let h = ((bits >> 14) & 0x3FFF) + 1;
            Some((w, h))
        }
        _ => None,
    }
}

fn parse_gif_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if data.len() < 10 {
        return None;
    }
    let w = u16::from_le_bytes([data[6], data[7]]) as u32;
    let h = u16::from_le_bytes([data[8], data[9]]) as u32;
    Some((w, h))
}

fn parse_bmp_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if data.len() < 26 {
        return None;
    }
    let w = i32::from_le_bytes([data[18], data[19], data[20], data[21]]).unsigned_abs();
    let h = i32::from_le_bytes([data[22], data[23], data[24], data[25]]).unsigned_abs();
    Some((w, h))
}

fn is_avif(data: &[u8]) -> bool {
    if data.len() < 12 || &data[4..8] != b"ftyp" {
        return false;
    }
    let box_len = u32::from_be_bytes([data[0], data[1], data[2], data[3]]) as usize;
    let end = box_len.min(data.len()).min(128);
    if end < 12 {
        return false;
    }
    if &data[8..12] == b"avif" || &data[8..12] == b"avis" {
        return true;
    }
    let mut i = 16usize;
    while i + 4 <= end {
        if &data[i..i + 4] == b"avif" || &data[i..i + 4] == b"avis" {
            return true;
        }
        i += 4;
    }
    false
}

fn parse_avif_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    // Scan first 64 KiB for ISOBMFF 'ispe' (Image Spatial Extents) fullbox.
    let limit = data.len().min(65_536);
    if limit < 20 {
        return None;
    }
    let mut i = 4usize;
    while i + 16 <= limit {
        if &data[i..i + 4] == b"ispe" {
            // ispe fullbox: version(1) + flags(3) + width(4 BE) + height(4 BE)
            let w = u32::from_be_bytes([data[i + 8], data[i + 9], data[i + 10], data[i + 11]]);
            let h = u32::from_be_bytes([data[i + 12], data[i + 13], data[i + 14], data[i + 15]]);
            if w > 0 && h > 0 && w <= 65_536 && h <= 65_536 {
                return Some((w, h));
            }
        }
        i += 1;
    }
    None
}

fn parse_ico_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if data.len() < 22 {
        return None;
    }
    let count = u16::from_le_bytes([data[4], data[5]]) as usize;
    let mut best: Option<(u32, u32)> = None;
    for idx in 0..count.min(64) {
        let off = 6 + idx * 16;
        if off + 16 > data.len() {
            break;
        }
        let w = if data[off] == 0 { 256 } else { data[off] as u32 };
        let h = if data[off + 1] == 0 { 256 } else { data[off + 1] as u32 };
        if best.is_none_or(|(bw, bh)| w * h > bw * bh) {
            best = Some((w, h));
        }
    }
    best
}

fn is_svg(data: &[u8]) -> bool {
    let head = &data[..data.len().min(512)];
    let Ok(text) = core::str::from_utf8(head) else {
        return false;
    };
    let trimmed = text.trim_start_matches('\u{feff}').trim_start();
    trimmed.starts_with("<svg") || (trimmed.starts_with("<?xml") && trimmed.contains("<svg"))
}

fn parse_svg_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    let head = &data[..data.len().min(2048)];
    let text = core::str::from_utf8(head).ok()?;
    let svg_start = text.find("<svg")?;
    let tag_end = text[svg_start..].find('>')? + svg_start;
    let tag = &text[svg_start..=tag_end];

    if let Some(vb) = extract_xml_attr(tag, "viewBox") {
        let nums: Vec<f32> = vb
            .split(|c: char| c.is_ascii_whitespace() || c == ',')
            .filter(|s| !s.is_empty())
            .filter_map(|s| s.parse::<f32>().ok())
            .collect();
        if nums.len() == 4 && nums[2] > 0.0 && nums[3] > 0.0 {
            return Some((nums[2].round() as u32, nums[3].round() as u32));
        }
    }

    let w = extract_xml_attr(tag, "width").and_then(parse_svg_len);
    let h = extract_xml_attr(tag, "height").and_then(parse_svg_len);
    match (w, h) {
        (Some(w), Some(h)) if w > 0 && h > 0 => Some((w, h)),
        _ => None,
    }
}

fn extract_xml_attr<'a>(tag: &'a str, attr: &str) -> Option<&'a str> {
    let pattern = format!("{attr}=");
    let pos = tag.find(&pattern)? + pattern.len();
    let rest = &tag[pos..];
    let quote = rest.as_bytes().first().copied()?;
    if quote != b'"' && quote != b'\'' {
        return None;
    }
    let inner = &rest[1..];
    let end = inner.find(quote as char)?;
    Some(&inner[..end])
}

fn parse_svg_len(raw: &str) -> Option<u32> {
    let cleaned = raw.trim().trim_end_matches("px");
    let v = cleaned.parse::<f32>().ok()?;
    if v > 0.0 && v <= 65_536.0 {
        Some(v.round() as u32)
    } else {
        None
    }
}
