//! Pure Rust, zero-dependency image encoders (BMP & PNG-in-ICO).

const MAX_DIMENSION: u32 = 16_384;

/// Encodes an RGBA8888 pixel buffer into a standard 24-bit Windows BMP (BITMAPINFOHEADER).
/// Semi-transparent pixels are alpha-composited over a clean white background.
pub fn encode_bmp_rgba(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, &'static str> {
    if width == 0 || height == 0 || width > MAX_DIMENSION || height > MAX_DIMENSION {
        return Err("invalid BMP dimensions");
    }
    let pixel_count = (width as usize)
        .checked_mul(height as usize)
        .ok_or("BMP dimension overflow")?;
    let expected_len = pixel_count.checked_mul(4).ok_or("BMP buffer overflow")?;
    if rgba.len() != expected_len {
        return Err("RGBA buffer length mismatch");
    }

    let row_bytes = (width as usize)
        .checked_mul(3)
        .ok_or("BMP row overflow")?;
    let padding = (4 - (row_bytes % 4)) % 4;
    let stride = row_bytes + padding;
    let image_size = stride
        .checked_mul(height as usize)
        .ok_or("BMP image size overflow")?;
    let file_size = 54usize
        .checked_add(image_size)
        .ok_or("BMP file size overflow")?;
    let file_size_u32 = u32::try_from(file_size).map_err(|_| "BMP exceeds 4GiB")?;
    let image_size_u32 = u32::try_from(image_size).map_err(|_| "BMP image exceeds 4GiB")?;

    let mut out = Vec::with_capacity(file_size);
    // BITMAPFILEHEADER (14 bytes)
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&file_size_u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // reserved
    out.extend_from_slice(&54u32.to_le_bytes()); // pixel data offset

    // BITMAPINFOHEADER (40 bytes)
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&(width as i32).to_le_bytes());
    out.extend_from_slice(&(height as i32).to_le_bytes()); // bottom-up DIB
    out.extend_from_slice(&1u16.to_le_bytes()); // planes
    out.extend_from_slice(&24u16.to_le_bytes()); // 24-bit BGR
    out.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB (uncompressed)
    out.extend_from_slice(&image_size_u32.to_le_bytes());
    out.extend_from_slice(&2835i32.to_le_bytes()); // ~72 DPI X
    out.extend_from_slice(&2835i32.to_le_bytes()); // ~72 DPI Y
    out.extend_from_slice(&0u32.to_le_bytes()); // colors used
    out.extend_from_slice(&0u32.to_le_bytes()); // important colors

    // Pixel data (bottom-up rows, BGR order)
    let w = width as usize;
    let h = height as usize;
    for y in (0..h).rev() {
        let row_start = y * w * 4;
        for x in 0..w {
            let idx = row_start + x * 4;
            let r = rgba[idx] as u16;
            let g = rgba[idx + 1] as u16;
            let b = rgba[idx + 2] as u16;
            let a = rgba[idx + 3] as u16;
            // Composite over white (255, 255, 255)
            let inv_a = 255 - a;
            let out_r = ((r * a + 255 * inv_a) / 255) as u8;
            let out_g = ((g * a + 255 * inv_a) / 255) as u8;
            let out_b = ((b * a + 255 * inv_a) / 255) as u8;
            out.push(out_b);
            out.push(out_g);
            out.push(out_r);
        }
        out.resize(out.len() + padding, 0);
    }

    Ok(out)
}

/// Wraps a PNG payload (up to 256x256) into a standard single-entry Windows `.ico` container.
pub fn encode_ico_from_png(png_bytes: &[u8], width: u32, height: u32) -> Result<Vec<u8>, &'static str> {
    if png_bytes.len() < 8 || &png_bytes[..8] != b"\x89PNG\r\n\x1a\n" {
        return Err("ICO payload must be valid PNG");
    }
    if width == 0 || height == 0 || width > 256 || height > 256 {
        return Err("ICO dimensions must be between 1x1 and 256x256");
    }
    let payload_len = u32::try_from(png_bytes.len()).map_err(|_| "ICO payload too large")?;
    let w_byte = if width == 256 { 0u8 } else { width as u8 };
    let h_byte = if height == 256 { 0u8 } else { height as u8 };

    let mut out = Vec::with_capacity(22 + png_bytes.len());
    // ICONDIR (6 bytes)
    out.extend_from_slice(&0u16.to_le_bytes()); // reserved
    out.extend_from_slice(&1u16.to_le_bytes()); // type = 1 (ICO)
    out.extend_from_slice(&1u16.to_le_bytes()); // count = 1

    // ICONDIRENTRY (16 bytes)
    out.push(w_byte);
    out.push(h_byte);
    out.push(0); // palette count
    out.push(0); // reserved
    out.extend_from_slice(&1u16.to_le_bytes()); // color planes
    out.extend_from_slice(&32u16.to_le_bytes()); // bits per pixel
    out.extend_from_slice(&payload_len.to_le_bytes()); // image byte size
    out.extend_from_slice(&22u32.to_le_bytes()); // offset (6 + 16)

    out.extend_from_slice(png_bytes);
    Ok(out)
}

/// Encodes interleaved little-endian 16-bit PCM audio samples into a standard RIFF/WAVE file.
pub fn encode_wav_pcm16(
    pcm_i16_le: &[u8],
    sample_rate: u32,
    channels: u16,
) -> Result<Vec<u8>, &'static str> {
    if sample_rate == 0 || sample_rate > 384_000 {
        return Err("invalid WAV sample rate");
    }
    if channels == 0 || channels > 8 {
        return Err("invalid WAV channel count");
    }
    let block_align = channels.checked_mul(2).ok_or("WAV block align overflow")?;
    if pcm_i16_le.is_empty() || !pcm_i16_le.len().is_multiple_of(block_align as usize) {
        return Err("PCM buffer length must be a non-empty multiple of block align");
    }
    let byte_rate = sample_rate
        .checked_mul(block_align as u32)
        .ok_or("WAV byte rate overflow")?;
    let data_len = u32::try_from(pcm_i16_le.len()).map_err(|_| "WAV data exceeds 4GiB")?;
    let riff_size = data_len
        .checked_add(36)
        .ok_or("WAV RIFF size overflow")?;

    let mut out = Vec::with_capacity(44 + pcm_i16_le.len());
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&riff_size.to_le_bytes());
    out.extend_from_slice(b"WAVE");
    // fmt chunk
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // PCM chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // AudioFormat = 1 (PCM)
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes()); // BitsPerSample
    // data chunk
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    out.extend_from_slice(pcm_i16_le);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::format::{ImageFormat, detect_format, parse_dimensions};

    #[test]
    fn encodes_valid_bmp_and_roundtrips_dimensions() {
        // 3x2 image (row bytes = 9 -> padded to 12)
        let rgba = [255u8, 0, 0, 255].repeat(6);
        let bmp = encode_bmp_rgba(&rgba, 3, 2).expect("bmp encode");
        assert_eq!(detect_format(&bmp), ImageFormat::Bmp);
        assert_eq!(parse_dimensions(&bmp, ImageFormat::Bmp), Some((3, 2)));
        assert_eq!(bmp.len(), 54 + 12 * 2);
    }

    #[test]
    fn encodes_valid_ico_from_png_and_detects_dimensions() {
        let mut fake_png = b"\x89PNG\r\n\x1a\n".to_vec();
        fake_png.extend_from_slice(&[0u8; 16]);
        let ico = encode_ico_from_png(&fake_png, 256, 256).expect("ico encode");
        assert_eq!(detect_format(&ico), ImageFormat::Ico);
        assert_eq!(parse_dimensions(&ico, ImageFormat::Ico), Some((256, 256)));
    }

    #[test]
    fn detects_svg_and_avif_headers() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48"></svg>"#;
        assert_eq!(detect_format(svg), ImageFormat::Svg);
        assert_eq!(parse_dimensions(svg, ImageFormat::Svg), Some((64, 48)));

        let mut avif = Vec::new();
        avif.extend_from_slice(&20u32.to_be_bytes());
        avif.extend_from_slice(b"ftypavif");
        avif.extend_from_slice(&0u32.to_be_bytes());
        avif.extend_from_slice(b"mif1");
        avif.extend_from_slice(&20u32.to_be_bytes());
        avif.extend_from_slice(b"ispe");
        avif.extend_from_slice(&0u32.to_be_bytes());
        avif.extend_from_slice(&800u32.to_be_bytes());
        avif.extend_from_slice(&600u32.to_be_bytes());
        assert_eq!(detect_format(&avif), ImageFormat::Avif);
        assert_eq!(parse_dimensions(&avif, ImageFormat::Avif), Some((800, 600)));
    }

    #[test]
    fn encodes_valid_wav_pcm16_header() {
        let pcm = [0u8, 0, 127, 0].repeat(4); // 4 stereo frames = 16 bytes
        let wav = encode_wav_pcm16(&pcm, 48_000, 2).expect("wav encode");
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[36..40], b"data");
        assert_eq!(wav.len(), 44 + pcm.len());
    }
}
