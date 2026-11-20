//! Privacy metadata & EXIF/TIFF IFD inspector for JPEG, PNG, and WebP.

use crate::format::ImageFormat;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MetadataReport {
    pub has_exif: bool,
    pub has_gps: bool,
    pub has_xmp: bool,
    pub has_icc: bool,
    pub has_comments: bool,
    pub metadata_bytes: usize,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub software: Option<String>,
    pub date_time: Option<String>,
    pub tags_found: Vec<String>,
}

impl MetadataReport {
    pub fn has_privacy_risk(&self) -> bool {
        self.has_exif || self.has_gps || self.has_xmp || self.has_comments || !self.tags_found.is_empty()
    }

    fn push_tag(&mut self, tag: &str) {
        if !self.tags_found.iter().any(|existing| existing == tag) {
            self.tags_found.push(tag.to_string());
        }
    }
}

pub fn inspect_metadata(data: &[u8], format: ImageFormat) -> MetadataReport {
    match format {
        ImageFormat::Jpeg => inspect_jpeg(data),
        ImageFormat::Png => inspect_png(data),
        ImageFormat::Webp => inspect_webp(data),
        _ => MetadataReport::default(),
    }
}

fn inspect_jpeg(data: &[u8]) -> MetadataReport {
    let mut report = MetadataReport::default();
    if data.len() < 4 || data[0] != 0xFF || data[1] != 0xD8 {
        return report;
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
        let payload = &data[i + 2..i + seg_len];

        match marker {
            0xE1 => {
                // APP1: EXIF or XMP
                report.metadata_bytes = report.metadata_bytes.saturating_add(seg_len + 2);
                if payload.starts_with(b"Exif\0\0") {
                    report.has_exif = true;
                    report.push_tag("EXIF");
                    parse_tiff_exif(&payload[6..], &mut report);
                } else if payload.starts_with(b"http://ns.adobe.com/xap/1.0/\0") {
                    report.has_xmp = true;
                    report.push_tag("XMP");
                } else {
                    report.push_tag("APP1");
                }
            }
            0xE2 => {
                if payload.starts_with(b"ICC_PROFILE\0") {
                    report.has_icc = true;
                    report.metadata_bytes = report.metadata_bytes.saturating_add(seg_len + 2);
                    report.push_tag("ICC");
                }
            }
            0xED => {
                report.metadata_bytes = report.metadata_bytes.saturating_add(seg_len + 2);
                report.push_tag("IPTC");
            }
            0xE3..=0xEC | 0xEE..=0xEF => {
                report.metadata_bytes = report.metadata_bytes.saturating_add(seg_len + 2);
                report.push_tag("APP");
            }
            0xFE => {
                report.has_comments = true;
                report.metadata_bytes = report.metadata_bytes.saturating_add(seg_len + 2);
                report.push_tag("COMMENT");
            }
            _ => {}
        }

        i += seg_len;
    }

    report
}

fn inspect_png(data: &[u8]) -> MetadataReport {
    let mut report = MetadataReport::default();
    if data.len() < 8 || &data[..8] != b"\x89PNG\r\n\x1a\n" {
        return report;
    }

    let mut i = 8usize;
    while i + 12 <= data.len() {
        let len = u32::from_be_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]) as usize;
        let chunk_type = &data[i + 4..i + 8];
        let Some(next) = i.checked_add(12).and_then(|v| v.checked_add(len)) else {
            break;
        };
        if next > data.len() {
            break;
        }
        let payload = &data[i + 8..i + 8 + len];

        match chunk_type {
            b"eXIf" => {
                report.has_exif = true;
                report.metadata_bytes = report.metadata_bytes.saturating_add(len + 12);
                report.push_tag("eXIf");
                parse_tiff_exif(payload, &mut report);
            }
            b"tEXt" | b"zTXt" | b"iTXt" => {
                report.has_comments = true;
                report.metadata_bytes = report.metadata_bytes.saturating_add(len + 12);
                if chunk_type == b"iTXt" && payload.starts_with(b"XML:com.adobe.xmp\0") {
                    report.has_xmp = true;
                    report.push_tag("XMP");
                } else {
                    let label = core::str::from_utf8(chunk_type).unwrap_or("TEXT");
                    report.push_tag(label);
                }
            }
            b"tIME" => {
                report.metadata_bytes = report.metadata_bytes.saturating_add(len + 12);
                report.push_tag("tIME");
            }
            b"iCCP" => {
                report.has_icc = true;
                report.metadata_bytes = report.metadata_bytes.saturating_add(len + 12);
                report.push_tag("iCCP");
            }
            b"IEND" => break,
            _ => {}
        }

        i = next;
    }

    report
}

fn inspect_webp(data: &[u8]) -> MetadataReport {
    let mut report = MetadataReport::default();
    if data.len() < 12 || &data[..4] != b"RIFF" || &data[8..12] != b"WEBP" {
        return report;
    }

    let mut i = 12usize;
    while i + 8 <= data.len() {
        let fourcc = &data[i..i + 4];
        let size = u32::from_le_bytes([data[i + 4], data[i + 5], data[i + 6], data[i + 7]]) as usize;
        let padded = size.saturating_add(size & 1);
        let Some(data_end) = i.checked_add(8).and_then(|v| v.checked_add(size)) else {
            break;
        };
        if data_end > data.len() {
            break;
        }
        let payload = &data[i + 8..data_end];

        match fourcc {
            b"EXIF" => {
                report.has_exif = true;
                report.metadata_bytes = report.metadata_bytes.saturating_add(padded + 8);
                report.push_tag("EXIF");
                let tiff_slice = if payload.starts_with(b"Exif\0\0") {
                    &payload[6..]
                } else {
                    payload
                };
                parse_tiff_exif(tiff_slice, &mut report);
            }
            b"XMP " => {
                report.has_xmp = true;
                report.metadata_bytes = report.metadata_bytes.saturating_add(padded + 8);
                report.push_tag("XMP");
            }
            b"ICCP" => {
                report.has_icc = true;
                report.metadata_bytes = report.metadata_bytes.saturating_add(padded + 8);
                report.push_tag("ICCP");
            }
            _ => {}
        }

        match i.checked_add(8).and_then(|v| v.checked_add(padded)) {
            Some(next) if next <= data.len() => i = next,
            _ => break,
        }
    }

    report
}

/// Minimal TIFF/EXIF IFD parser (supports both Little-Endian `II` and Big-Endian `MM`).
fn parse_tiff_exif(tiff: &[u8], report: &mut MetadataReport) {
    if tiff.len() < 8 {
        return;
    }
    let little_endian = match &tiff[0..2] {
        b"II" => true,
        b"MM" => false,
        _ => return,
    };
    let magic = read_u16(tiff, 2, little_endian);
    if magic != Some(42) {
        return;
    }
    let Some(ifd0_offset) = read_u32(tiff, 4, little_endian).map(|v| v as usize) else {
        return;
    };

    let mut exif_ifd_offset: Option<usize> = None;
    parse_ifd(tiff, ifd0_offset, little_endian, report, &mut exif_ifd_offset);

    if let Some(exif_off) = exif_ifd_offset {
        let mut ignored = None;
        parse_ifd(tiff, exif_off, little_endian, report, &mut ignored);
    }
}

fn parse_ifd(
    tiff: &[u8],
    offset: usize,
    le: bool,
    report: &mut MetadataReport,
    exif_ifd_out: &mut Option<usize>,
) {
    let Some(count) = read_u16(tiff, offset, le).map(|v| v as usize) else {
        return;
    };
    // Guard against malformed huge entry counts.
    let bounded = count.min(128);
    for idx in 0..bounded {
        let entry_off = match offset.checked_add(2).and_then(|v| v.checked_add(idx * 12)) {
            Some(v) if v + 12 <= tiff.len() => v,
            _ => break,
        };
        let Some(tag) = read_u16(tiff, entry_off, le) else {
            continue;
        };
        let Some(field_type) = read_u16(tiff, entry_off + 2, le) else {
            continue;
        };
        let Some(val_count) = read_u32(tiff, entry_off + 4, le).map(|v| v as usize) else {
            continue;
        };

        match tag {
            // Make
            0x010F if field_type == 2 => {
                if let Some(s) = read_ascii(tiff, entry_off + 8, val_count, le) {
                    report.camera_make = Some(s);
                    report.push_tag("Camera");
                }
            }
            // Model
            0x0110 if field_type == 2 => {
                if let Some(s) = read_ascii(tiff, entry_off + 8, val_count, le) {
                    report.camera_model = Some(s);
                    report.push_tag("Camera");
                }
            }
            // Software
            0x0131 if field_type == 2 => {
                if let Some(s) = read_ascii(tiff, entry_off + 8, val_count, le) {
                    report.software = Some(s);
                    report.push_tag("Software");
                }
            }
            // DateTime / DateTimeOriginal
            0x0132 | 0x9003 if field_type == 2 => {
                if report.date_time.is_none() || tag == 0x9003 {
                    if let Some(s) = read_ascii(tiff, entry_off + 8, val_count, le) {
                        report.date_time = Some(s);
                        report.push_tag("DateTime");
                    }
                }
            }
            // ExifIFDPointer
            0x8769 => {
                if let Some(ptr) = read_u32(tiff, entry_off + 8, le).map(|v| v as usize) {
                    if ptr < tiff.len() && ptr != offset {
                        *exif_ifd_out = Some(ptr);
                    }
                }
            }
            // GPSInfoIFDPointer
            0x8825 => {
                if let Some(ptr) = read_u32(tiff, entry_off + 8, le).map(|v| v as usize) {
                    if ptr > 0 && ptr < tiff.len() {
                        report.has_gps = true;
                        report.push_tag("GPS");
                    }
                }
            }
            _ => {}
        }
    }
}

fn read_u16(buf: &[u8], off: usize, le: bool) -> Option<u16> {
    let slice = buf.get(off..off + 2)?;
    Some(if le {
        u16::from_le_bytes([slice[0], slice[1]])
    } else {
        u16::from_be_bytes([slice[0], slice[1]])
    })
}

fn read_u32(buf: &[u8], off: usize, le: bool) -> Option<u32> {
    let slice = buf.get(off..off + 4)?;
    Some(if le {
        u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]])
    } else {
        u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]])
    })
}

fn read_ascii(tiff: &[u8], val_field_off: usize, count: usize, le: bool) -> Option<String> {
    if count == 0 || count > 256 {
        return None;
    }
    let bytes = if count <= 4 {
        tiff.get(val_field_off..val_field_off + count)?
    } else {
        let ptr = read_u32(tiff, val_field_off, le)? as usize;
        tiff.get(ptr..ptr.checked_add(count)?)?
    };
    let trimmed = bytes
        .iter()
        .copied()
        .take_while(|&b| b != 0)
        .collect::<Vec<u8>>();
    let s = String::from_utf8_lossy(&trimmed).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}
