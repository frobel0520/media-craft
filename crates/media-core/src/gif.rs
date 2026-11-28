//! Lossless GIF container optimization. Video frames stay LZW-encoded.

const MAX_INPUT_BYTES: usize = 32 * 1024 * 1024;
const MAX_SUB_BLOCK_LEN: usize = 255;

struct Reader<'a> {
    remaining: &'a [u8],
}

impl<'a> Reader<'a> {
    fn take(&mut self, size: usize) -> Option<&'a [u8]> {
        let (data, rest) = self.remaining.split_at_checked(size)?;
        self.remaining = rest;
        Some(data)
    }

    fn byte(&mut self) -> Option<u8> {
        Some(self.take(1)?[0])
    }

    fn table(&mut self, packed: u8) -> Option<&'a [u8]> {
        let color_table_len = if packed & 0x80 != 0 {
            3usize << ((packed & 7) + 1)
        } else {
            0
        };
        self.take(color_table_len)
    }

    fn sub_blocks(&mut self) -> Option<&'a [u8]> {
        let start = self.remaining;
        loop {
            let size = self.byte()? as usize;
            if size == 0 {
                return start.get(..start.len() - self.remaining.len());
            }
            self.take(size)?;
        }
    }
}

fn repack_image_data(reader: &mut Reader<'_>, output: &mut Vec<u8>) -> Option<()> {
    let mut chunk = [0; MAX_SUB_BLOCK_LEN];
    let mut used = 0;
    let mut any_data = false;
    loop {
        let length = reader.byte()? as usize;
        if length == 0 {
            if !any_data {
                return None;
            }
            if used > 0 {
                output.push(used as u8);
                output.extend_from_slice(&chunk[..used]);
            }
            output.push(0);
            return Some(());
        }
        any_data = true;
        let mut bytes = reader.take(length)?;
        while !bytes.is_empty() {
            let count = bytes.len().min(MAX_SUB_BLOCK_LEN - used);
            chunk[used..used + count].copy_from_slice(&bytes[..count]);
            used += count;
            bytes = &bytes[count..];
            if used == MAX_SUB_BLOCK_LEN {
                output.push(MAX_SUB_BLOCK_LEN as u8);
                output.extend_from_slice(&chunk);
                used = 0;
            }
        }
    }
}

/// Removes comment extensions and compacts frame sub-block framing in a valid GIF.
pub fn optimize_gif(input: &[u8]) -> Option<Vec<u8>> {
    if input.len() > MAX_INPUT_BYTES {
        return None;
    }
    let mut reader = Reader { remaining: input };
    let header = reader.take(13)?;
    if !matches!(&header[..6], b"GIF87a" | b"GIF89a")
        || header[6..8] == [0, 0]
        || header[8..10] == [0, 0]
    {
        return None;
    }
    let mut output = Vec::with_capacity(input.len());
    output.extend_from_slice(header);
    output.extend_from_slice(reader.table(header[10])?);
    let mut any_frame = false;

    loop {
        match reader.byte()? {
            0x2c => {
                let descriptor = reader.take(9)?;
                let local_colors = reader.table(descriptor[8])?;
                let code_size = reader.byte()?;
                if !(2..=8).contains(&code_size) {
                    return None;
                }
                output.push(0x2c);
                output.extend_from_slice(descriptor);
                output.extend_from_slice(local_colors);
                output.push(code_size);
                repack_image_data(&mut reader, &mut output)?;
                any_frame = true;
            }
            0x21 => {
                let label = reader.byte()?;
                let payload = reader.sub_blocks()?;
                if label == 0xf9 && (payload.len() != 6 || payload[0] != 4) {
                    return None;
                }
                if label != 0xfe {
                    // Preserve animation controls, loop metadata and application framing exactly.
                    output.extend_from_slice(&[0x21, label]);
                    output.extend_from_slice(payload);
                }
            }
            0x3b if any_frame => {
                // The trailer ends the GIF stream. Extra bytes do not affect rendering.
                output.push(0x3b);
                return Some(output);
            }
            _ => return None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEADER: &[u8] = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff";
    const LOOP: &[u8] = b"\x21\xff\x0bNETSCAPE2.0\x03\x01\x02\x00\x00";
    const CONTROL: &[u8] = b"\x21\xf9\x04\x01\x08\x00\x00\x00";
    const FRAME: &[u8] = b"\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02";

    #[test]
    fn keeps_loop_control_and_compressed_bytes() {
        let input = [
            HEADER, LOOP, b"\x21\xfe\x03abc\x00", CONTROL, FRAME, b"\x01\x44\x01\x01\x00\x3b",
        ].concat();
        let expected = [HEADER, LOOP, CONTROL, FRAME, b"\x02\x44\x01\x00\x3b"].concat();
        assert_eq!(optimize_gif(&input).as_deref(), Some(expected.as_slice()));
    }

    #[test]
    fn keeps_a_compact_input_identical() {
        let input = [HEADER, FRAME, b"\x02\x44\x01\x00\x3b"].concat();
        assert_eq!(optimize_gif(&input).as_deref(), Some(input.as_slice()));
    }

    #[test]
    fn ignores_bytes_after_the_trailer() {
        let gif = [HEADER, FRAME, b"\x02\x44\x01\x00\x3b"].concat();
        let input = [gif.as_slice(), b"trailing bytes"].concat();
        assert_eq!(optimize_gif(&input).as_deref(), Some(gif.as_slice()));
    }

    #[test]
    fn rejects_truncated_stream_without_panicking() {
        let input = [HEADER, FRAME, b"\x02\x44\x01\x00\x3b"].concat();
        for end in 0..input.len() {
            assert_eq!(optimize_gif(&input[..end]), None);
        }
    }
}
