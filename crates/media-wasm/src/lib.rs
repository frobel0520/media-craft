//! Minimal, zero-dependency WebAssembly ABI for media-core.
//!
//! All calls run single-threaded inside a dedicated Web Worker; output buffers are stored
//! in a worker-local static buffer and read via `last_output_ptr()` / `last_output_len()`.

use std::cell::RefCell;

use media_core::strip::strip_metadata;
use media_core::zip::{ZipEntry, build_zip};

const MAX_INPUT_BYTES: usize = 100 * 1024 * 1024; // 100 MiB safety guard

thread_local! {
    static OUTPUT_BUF: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static ZIP_ENTRIES: RefCell<Vec<(String, Vec<u8>)>> = const { RefCell::new(Vec::new()) };
}

fn set_output(bytes: Vec<u8>) -> usize {
    let len = bytes.len();
    OUTPUT_BUF.with(|cell| {
        *cell.borrow_mut() = bytes;
    });
    len
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    if len == 0 || len > MAX_INPUT_BYTES {
        return core::ptr::null_mut();
    }
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    core::mem::forget(buf);
    ptr
}

/// Frees a buffer previously allocated by [`alloc`].
///
/// # Safety
/// `ptr` must have been returned by `alloc(len)` and must not be freed more than once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    unsafe {
        let _ = Vec::from_raw_parts(ptr, 0, len);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn last_output_ptr() -> *const u8 {
    OUTPUT_BUF.with(|cell| cell.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn last_output_len() -> usize {
    OUTPUT_BUF.with(|cell| cell.borrow().len())
}

/// Inspects an image buffer and writes a UTF-8 JSON report into the output buffer.
/// Returns the byte length of the JSON report (0 on invalid pointer).
///
/// # Safety
/// `ptr` must point to a valid, readable byte slice of length `len` in WASM linear memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn inspect_image_wasm(ptr: *const u8, len: usize) -> usize {
    if ptr.is_null() || len == 0 || len > MAX_INPUT_BYTES {
        return 0;
    }
    let input = unsafe { core::slice::from_raw_parts(ptr, len) };
    let json = media_core::inspect_image_json(input);
    set_output(json.into_bytes())
}

/// Losslessly strips metadata (EXIF/GPS/XMP/IPTC/tEXt) from JPEG/PNG/WebP.
/// Returns output byte length, or 0 on unsupported/malformed input.
///
/// # Safety
/// `ptr` must point to a valid, readable byte slice of length `len` in WASM linear memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn strip_metadata_wasm(ptr: *const u8, len: usize) -> usize {
    if ptr.is_null() || len == 0 || len > MAX_INPUT_BYTES {
        return 0;
    }
    let input = unsafe { core::slice::from_raw_parts(ptr, len) };
    match strip_metadata(input) {
        Ok(res) => set_output(res.bytes),
        Err(_) => {
            set_output(Vec::new());
            0
        }
    }
}

/// Resets the in-memory ZIP batch builder.
#[unsafe(no_mangle)]
pub extern "C" fn zip_begin() {
    ZIP_ENTRIES.with(|cell| cell.borrow_mut().clear());
}

/// Adds a file entry (UTF-8 name + raw bytes) to the ZIP batch builder.
/// Returns 1 on success, 0 on invalid arguments.
///
/// # Safety
/// `name_ptr` and `data_ptr` must point to valid, readable byte slices of lengths `name_len` and `data_len`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zip_add_file(
    name_ptr: *const u8,
    name_len: usize,
    data_ptr: *const u8,
    data_len: usize,
) -> u32 {
    if name_ptr.is_null() || name_len == 0 || name_len > 512 || data_ptr.is_null() || data_len > MAX_INPUT_BYTES {
        return 0;
    }
    let name_bytes = unsafe { core::slice::from_raw_parts(name_ptr, name_len) };
    let data_bytes = unsafe { core::slice::from_raw_parts(data_ptr, data_len) };
    let name = String::from_utf8_lossy(name_bytes).into_owned();
    ZIP_ENTRIES.with(|cell| {
        cell.borrow_mut().push((name, data_bytes.to_vec()));
    });
    1
}

/// Finalizes the ZIP archive into the output buffer and clears staged entries.
/// Returns ZIP byte length.
#[unsafe(no_mangle)]
pub extern "C" fn zip_finish() -> usize {
    let zip_bytes = ZIP_ENTRIES.with(|cell| {
        let entries_owned = cell.borrow();
        let refs: Vec<ZipEntry<'_>> = entries_owned
            .iter()
            .map(|(name, data)| ZipEntry {
                name: name.as_str(),
                data: data.as_slice(),
            })
            .collect();
        build_zip(&refs)
    });
    ZIP_ENTRIES.with(|cell| cell.borrow_mut().clear());
    set_output(zip_bytes)
}
