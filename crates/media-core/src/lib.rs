#![forbid(unsafe_code)]

pub mod crc32;
pub mod exif;
pub mod format;
pub mod json;
pub mod strip;
pub mod zip;

use exif::{MetadataReport, inspect_metadata};
use format::{ImageFormat, detect_format, parse_dimensions};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InspectReport {
    pub format: ImageFormat,
    pub byte_length: usize,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub metadata: MetadataReport,
}

pub fn inspect_image(data: &[u8]) -> InspectReport {
    let format = detect_format(data);
    let dims = parse_dimensions(data, format);
    let metadata = inspect_metadata(data, format);
    InspectReport {
        format,
        byte_length: data.len(),
        width: dims.map(|(w, _)| w),
        height: dims.map(|(_, h)| h),
        metadata,
    }
}

pub fn inspect_image_json(data: &[u8]) -> String {
    let report = inspect_image(data);
    json::serialize_inspect_report(&report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crc32::crc32;
    use crate::strip::strip_metadata;
    use crate::zip::{ZipEntry, build_zip};

    fn make_png_chunk(chunk_type: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        out.extend_from_slice(chunk_type);
        out.extend_from_slice(payload);
        let mut crc_input = Vec::with_capacity(4 + payload.len());
        crc_input.extend_from_slice(chunk_type);
        crc_input.extend_from_slice(payload);
        out.extend_from_slice(&crc32(&crc_input).to_be_bytes());
        out
    }

    fn build_synthetic_png_with_text() -> Vec<u8> {
        let mut png = Vec::new();
        png.extend_from_slice(b"\x89PNG\r\n\x1a\n");
        // IHDR: 640x480
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&640u32.to_be_bytes());
        ihdr.extend_from_slice(&480u32.to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        png.extend_from_slice(&make_png_chunk(b"IHDR", &ihdr));
        png.extend_from_slice(&make_png_chunk(b"tEXt", b"Software\0SyntheticEditor"));
        png.extend_from_slice(&make_png_chunk(b"IDAT", b"\x78\x9c\x63\x00\x00\x00\x02\x00\x01"));
        png.extend_from_slice(&make_png_chunk(b"IEND", b""));
        png
    }

    fn build_synthetic_jpeg_with_exif_and_gps() -> Vec<u8> {
        // Minimal little-endian TIFF with IFD0 (Make="Acme", GPSInfoIFDPointer=0x36)
        let mut tiff = Vec::new();
        tiff.extend_from_slice(b"II"); // Little endian
        tiff.extend_from_slice(&42u16.to_le_bytes());
        tiff.extend_from_slice(&8u32.to_le_bytes()); // IFD0 offset = 8
        // IFD0: 2 entries
        tiff.extend_from_slice(&2u16.to_le_bytes());
        // Entry 1: Make (0x010F), ASCII (2), count 5, offset 38 (8 + 2 + 24 + 4 = 38)
        tiff.extend_from_slice(&0x010Fu16.to_le_bytes());
        tiff.extend_from_slice(&2u16.to_le_bytes());
        tiff.extend_from_slice(&5u32.to_le_bytes());
        tiff.extend_from_slice(&38u32.to_le_bytes());
        // Entry 2: GPSInfoIFDPointer (0x8825), LONG (4), count 1, value 44
        tiff.extend_from_slice(&0x8825u16.to_le_bytes());
        tiff.extend_from_slice(&4u16.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&44u32.to_le_bytes());
        // Next IFD offset = 0
        tiff.extend_from_slice(&0u32.to_le_bytes());
        // Offset 38: "Acme\0" (5 bytes) + 1 pad
        tiff.extend_from_slice(b"Acme\0\0");
        // Offset 44: dummy GPS IFD
        tiff.extend_from_slice(&0u16.to_le_bytes());

        let mut app1 = Vec::new();
        app1.extend_from_slice(b"Exif\0\0");
        app1.extend_from_slice(&tiff);

        let mut jpeg = Vec::new();
        jpeg.extend_from_slice(&[0xFF, 0xD8]); // SOI
        // APP1 segment
        jpeg.extend_from_slice(&[0xFF, 0xE1]);
        jpeg.extend_from_slice(&((app1.len() + 2) as u16).to_be_bytes());
        jpeg.extend_from_slice(&app1);
        // COM segment
        let comment = b"secret-note";
        jpeg.extend_from_slice(&[0xFF, 0xFE]);
        jpeg.extend_from_slice(&((comment.len() + 2) as u16).to_be_bytes());
        jpeg.extend_from_slice(comment);
        // SOF0: 1200x800
        let sof0 = [8u8, 0x03, 0x20, 0x04, 0xB0, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0];
        jpeg.extend_from_slice(&[0xFF, 0xC0]);
        jpeg.extend_from_slice(&((sof0.len() + 2) as u16).to_be_bytes());
        jpeg.extend_from_slice(&sof0);
        // SOS + dummy entropy data + EOI
        jpeg.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0xAA, 0xBB, 0xFF, 0xD9]);
        jpeg
    }

    fn build_synthetic_webp_with_exif() -> Vec<u8> {
        let mut body = Vec::new();
        // VP8X (10 bytes): flags = 0x08 (EXIF), width = 320 (319), height = 240 (239)
        body.extend_from_slice(b"VP8X");
        body.extend_from_slice(&10u32.to_le_bytes());
        body.extend_from_slice(&[0x08, 0, 0, 0]);
        body.extend_from_slice(&[0x3F, 0x01, 0x00]); // 319 + 1 = 320
        body.extend_from_slice(&[0xEF, 0x00, 0x00]); // 239 + 1 = 240
        // Dummy VP8L chunk
        body.extend_from_slice(b"VP8L");
        body.extend_from_slice(&4u32.to_le_bytes());
        body.extend_from_slice(&[0x2F, 0, 0, 0]);
        // EXIF chunk
        body.extend_from_slice(b"EXIF");
        body.extend_from_slice(&6u32.to_le_bytes());
        body.extend_from_slice(b"Exif\0\0");

        let mut webp = Vec::new();
        webp.extend_from_slice(b"RIFF");
        webp.extend_from_slice(&((4 + body.len()) as u32).to_le_bytes());
        webp.extend_from_slice(b"WEBP");
        webp.extend_from_slice(&body);
        webp
    }

    #[test]
    fn inspects_and_strips_jpeg_exif_gps_and_comment() {
        let jpeg = build_synthetic_jpeg_with_exif_and_gps();
        let before = inspect_image(&jpeg);
        assert_eq!(before.format, ImageFormat::Jpeg);
        assert_eq!(before.width, Some(1200));
        assert_eq!(before.height, Some(800));
        assert!(before.metadata.has_exif);
        assert!(before.metadata.has_gps);
        assert!(before.metadata.has_comments);
        assert_eq!(before.metadata.camera_make.as_deref(), Some("Acme"));

        let stripped = strip_metadata(&jpeg).expect("strip jpeg");
        assert!(stripped.bytes_removed > 50);

        let after = inspect_image(&stripped.bytes);
        assert_eq!(after.format, ImageFormat::Jpeg);
        assert_eq!(after.width, Some(1200));
        assert_eq!(after.height, Some(800));
        assert!(!after.metadata.has_exif);
        assert!(!after.metadata.has_gps);
        assert!(!after.metadata.has_comments);
        assert!(!after.metadata.has_privacy_risk());
    }

    #[test]
    fn inspects_and_strips_png_text_chunks() {
        let png = build_synthetic_png_with_text();
        let before = inspect_image(&png);
        assert_eq!(before.format, ImageFormat::Png);
        assert_eq!(before.width, Some(640));
        assert_eq!(before.height, Some(480));
        assert!(before.metadata.has_comments);

        let stripped = strip_metadata(&png).expect("strip png");
        assert!(stripped.bytes_removed > 20);

        let after = inspect_image(&stripped.bytes);
        assert_eq!(after.format, ImageFormat::Png);
        assert_eq!(after.width, Some(640));
        assert_eq!(after.height, Some(480));
        assert!(!after.metadata.has_privacy_risk());
    }

    #[test]
    fn inspects_and_strips_webp_exif_and_clears_vp8x_flag() {
        let webp = build_synthetic_webp_with_exif();
        let before = inspect_image(&webp);
        assert_eq!(before.format, ImageFormat::Webp);
        assert_eq!(before.width, Some(320));
        assert_eq!(before.height, Some(240));
        assert!(before.metadata.has_exif);

        let stripped = strip_metadata(&webp).expect("strip webp");
        assert_eq!(stripped.bytes_removed, 14);
        // VP8X flag byte at index 20 should have EXIF bit (0x08) cleared
        assert_eq!(stripped.bytes[20] & 0x08, 0);

        let after = inspect_image(&stripped.bytes);
        assert_eq!(after.width, Some(320));
        assert_eq!(after.height, Some(240));
        assert!(!after.metadata.has_exif);
    }

    #[test]
    fn builds_valid_zip_archive_with_sanitized_paths() {
        let zip = build_zip(&[
            ZipEntry { name: "../unsafe/a.webp", data: b"hello" },
            ZipEntry { name: "b.png", data: b"world!" },
        ]);
        // Starts with Local File Header PK\x03\x04 and ends with EOCD PK\x05\x06
        assert_eq!(&zip[0..4], b"PK\x03\x04");
        assert_eq!(&zip[zip.len() - 22..zip.len() - 18], b"PK\x05\x06");
        assert!(!zip.windows(3).any(|w| w == b"../"));
    }

    #[test]
    fn serializes_valid_inspect_json() {
        let jpeg = build_synthetic_jpeg_with_exif_and_gps();
        let json = inspect_image_json(&jpeg);
        assert!(json.contains("\"format\":\"jpeg\""));
        assert!(json.contains("\"hasGps\":true"));
        assert!(json.contains("\"cameraMake\":\"Acme\""));
    }
}
