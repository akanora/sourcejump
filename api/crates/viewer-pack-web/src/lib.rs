//! The map packer (`viewer-pack`, from the `sourcejump-packer` repo) as a WebAssembly module for the browser, with a plain byte interface so the
//! page needs no generated glue (`web/src/features/staff/maps/viewerPack.worker.ts` drives it):
//!
//! 1. `alloc(len)` returns where to write the map's bytes into the module's memory;
//! 2. `pack(ptr, len)` packs them, calling the imported `env.progress(stage, done, total)` as it goes, and
//!    returns 1 on success or 0 on failure;
//! 3. `output_ptr()`/`output_len()` then give the packed file, and `text_ptr()`/`text_len()` its hash, or why
//!    it failed; `source_bytes()` and `stripped_bytes()` its sizes.
//!
//! Only built for `wasm32`; elsewhere this crate is empty.
#![cfg(target_arch = "wasm32")]

use std::cell::RefCell;

use viewer_pack::Stage;

#[link(wasm_import_module = "env")]
unsafe extern "C" {
    /// `stage`: 0 unpacking, 1 stripping, 2 compressing (with `done` of `total` bytes).
    safe fn progress(stage: u32, done: u32, total: u32);
}

#[derive(Default)]
struct Output {
    file: Vec<u8>,
    text: String,
    source_bytes: usize,
    stripped_bytes: usize,
}

thread_local! {
    static OUTPUT: RefCell<Output> = RefCell::default();
}

/// Room for `len` bytes of input, handed to `pack`, which frees it.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()).cast()
}

/// Packs the map written at `ptr`.
///
/// # Safety
/// `ptr` and `len` must come from one call to `alloc`, and `pack` is called once for it.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pack(ptr: *mut u8, len: usize) -> u32 {
    // SAFETY: the caller passes back what `alloc(len)` returned: a boxed slice of `len` bytes, not yet freed.
    let input = unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) };
    // The previous result goes first, so a large map doesn't hold two outputs at once.
    OUTPUT.with_borrow_mut(|output| *output = Output::default());
    let packed = viewer_pack::pack(&input, |stage| match stage {
        Stage::Unpacking => progress(0, 0, 0),
        Stage::Stripping => progress(1, 0, 0),
        Stage::Compressing { done, total } => progress(2, to_u32(done), to_u32(total)),
    });
    drop(input);
    OUTPUT.with_borrow_mut(|output| match packed {
        Ok(packed) => {
            *output = Output {
                file: packed.file,
                text: packed.hash,
                source_bytes: packed.source_bytes,
                stripped_bytes: packed.stripped_bytes,
            };
            1
        }
        Err(reason) => {
            output.text = reason;
            0
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn output_ptr() -> *const u8 {
    OUTPUT.with_borrow(|output| output.file.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn output_len() -> usize {
    OUTPUT.with_borrow(|output| output.file.len())
}

#[unsafe(no_mangle)]
pub extern "C" fn text_ptr() -> *const u8 {
    OUTPUT.with_borrow(|output| output.text.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn text_len() -> usize {
    OUTPUT.with_borrow(|output| output.text.len())
}

#[unsafe(no_mangle)]
pub extern "C" fn source_bytes() -> usize {
    OUTPUT.with_borrow(|output| output.source_bytes)
}

#[unsafe(no_mangle)]
pub extern "C" fn stripped_bytes() -> usize {
    OUTPUT.with_borrow(|output| output.stripped_bytes)
}

/// Sizes are capped at 512 MB, so they fit.
fn to_u32(len: usize) -> u32 {
    u32::try_from(len).unwrap_or(u32::MAX)
}
