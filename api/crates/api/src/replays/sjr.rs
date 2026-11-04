//! SJR, the form SourceJump stores replays in: the shavit file rearranged so gzip compresses it well, and
//! rebuilt byte for byte on download. The web viewer reads SJR directly.
//!
//! A tick changes little from the one before, but a shavit file interleaves ten different fields per tick,
//! which hides that from a compressor. SJR stores each field as its own column, replaces each value with its
//! difference from the one before (positions and angles twice over, since they move smoothly), and splits
//! each column into byte planes. On 28 real replays that is 20–22% of the raw size, against 43% for zstd -19
//! on the raw file. gzip is used because browsers decode it natively (`DecompressionStream`); zstd would save
//! another 7% but needs a decoder shipped to the browser.
//!
//! Layout, little endian:
//! ```text
//!   0  "SJR" and format version 1
//!   4  u32 header length H: the shavit header, kept as it is
//!   8  u32 frame count N
//!  12  u8 words per frame W (10 in shavit format 12)
//!  13  W bytes: how many times each word's column was delta-coded (0, 1 or 2)
//!      then one gzip member holding H header bytes, followed by each word's column in turn: N values
//!      (u32, wrapping differences), stored as four planes of N bytes, lowest byte first.
//! ```

use std::io::{Read, Write};

use flate2::{Compression, read::GzDecoder, write::GzEncoder};

use super::{
    MAX_REPLAY_BYTES,
    header::{FRAME_SIZE, ReplayHeader},
};

const MAGIC: &[u8; 4] = b"SJR\x01";
const WORDS: usize = FRAME_SIZE / 4;
/// Position (3) and angles (2) change smoothly, so a second difference leaves the least. Buttons, flags and
/// the rest change in steps, where one difference is best. Measured on the sample replays.
const DELTA_ORDERS: [u8; WORDS] = [2, 2, 2, 2, 2, 1, 1, 1, 1, 1];

pub fn encode(file: &[u8], header: &ReplayHeader) -> Vec<u8> {
    let frames = header.frame_count();
    let mut payload = Vec::with_capacity(file.len());
    payload.extend_from_slice(&file[..header.len]);
    let frame_bytes = &file[header.len..];
    for (word, &order) in DELTA_ORDERS.iter().enumerate() {
        let mut column: Vec<u32> = (0..frames)
            .map(|frame| {
                let at = frame * FRAME_SIZE + word * 4;
                u32::from_le_bytes(frame_bytes[at..at + 4].try_into().expect("four bytes"))
            })
            .collect();
        for _ in 0..order {
            for i in (1..column.len()).rev() {
                column[i] = column[i].wrapping_sub(column[i - 1]);
            }
        }
        for plane in 0..4 {
            payload.extend(column.iter().map(|value| value.to_le_bytes()[plane]));
        }
    }

    let mut out = Vec::with_capacity(file.len() / 4);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(
        &u32::try_from(header.len)
            .expect("headers are short")
            .to_le_bytes(),
    );
    out.extend_from_slice(
        &u32::try_from(frames)
            .expect("checked by the size cap")
            .to_le_bytes(),
    );
    out.push(u8::try_from(WORDS).expect("ten words"));
    out.extend_from_slice(&DELTA_ORDERS);
    let mut gzip = GzEncoder::new(out, Compression::best());
    gzip.write_all(&payload).expect("writing to memory");
    gzip.finish().expect("writing to memory")
}

/// Rebuilds the shavit file. SJR files are SourceJump's own, so an error here means a damaged object.
pub fn decode(sjr: &[u8]) -> Result<Vec<u8>, String> {
    let rest = sjr.strip_prefix(MAGIC).ok_or("not an SJR file")?;
    let (header_len, rest) = split_u32(rest)?;
    let (frames, rest) = split_u32(rest)?;
    let (&words, rest) = rest.split_first().ok_or("cut short")?;
    if usize::from(words) != WORDS {
        return Err(format!(
            "{words} words per frame; only {WORDS} is supported"
        ));
    }
    let (orders, compressed) = rest.split_at_checked(WORDS).ok_or("cut short")?;
    if orders.iter().any(|&order| order > 2) {
        return Err("a column was delta-coded more than twice".to_owned());
    }

    // Bounded before anything is allocated, so a damaged count can't ask for terabytes.
    let expected = frames
        .checked_mul(FRAME_SIZE)
        .and_then(|frame_bytes| frame_bytes.checked_add(header_len))
        .filter(|&len| len <= MAX_REPLAY_BYTES)
        .ok_or("the sizes it gives are larger than any accepted replay")?;
    let mut payload = Vec::with_capacity(expected);
    // Reading one byte past the expected length shows a file that holds more than it says, without
    // inflating all of it.
    GzDecoder::new(compressed)
        .take(expected as u64 + 1)
        .read_to_end(&mut payload)
        .map_err(|error| format!("the compressed data is damaged: {error}"))?;
    if payload.len() != expected {
        return Err("the compressed data doesn't match the frame count".to_owned());
    }

    let (header, columns) = payload.split_at(header_len);
    let mut file = vec![0; expected];
    file[..header_len].copy_from_slice(header);
    for (word, &order) in orders.iter().enumerate() {
        let planes = &columns[word * 4 * frames..(word + 1) * 4 * frames];
        let mut column: Vec<u32> = (0..frames)
            .map(|i| u32::from_le_bytes([0, 1, 2, 3].map(|plane| planes[plane * frames + i])))
            .collect();
        for _ in 0..order {
            for i in 1..column.len() {
                column[i] = column[i].wrapping_add(column[i - 1]);
            }
        }
        for (frame, value) in column.iter().enumerate() {
            let at = header_len + frame * FRAME_SIZE + word * 4;
            file[at..at + 4].copy_from_slice(&value.to_le_bytes());
        }
    }
    Ok(file)
}

fn split_u32(bytes: &[u8]) -> Result<(usize, &[u8]), String> {
    let (value, rest) = bytes.split_first_chunk::<4>().ok_or("cut short")?;
    Ok((u32::from_le_bytes(*value) as usize, rest))
}

#[cfg(test)]
mod tests {
    use super::{decode, encode};
    use crate::replays::header::{
        parse,
        tests::{DONTFAIL, LUCENT, MAZE},
    };

    #[test]
    fn rebuilds_real_replays_byte_for_byte_from_a_fraction_of_the_size() {
        for file in [MAZE, LUCENT, DONTFAIL] {
            let sjr = encode(file, &parse(file).unwrap());

            assert_eq!(decode(&sjr).unwrap(), file);
            assert!(
                sjr.len() * 3 < file.len(),
                "{} of {} bytes",
                sjr.len(),
                file.len()
            );
        }
    }

    #[test]
    fn a_damaged_file_is_an_error_not_a_panic() {
        let sjr = encode(MAZE, &parse(MAZE).unwrap());
        let mut wrong_count = sjr.clone();
        wrong_count[8] ^= 1;

        assert!(decode(&sjr[..sjr.len() / 2]).is_err());
        assert!(decode(&wrong_count).is_err());
        assert!(decode(b"SJR\x01").is_err());
        assert!(decode(MAZE).is_err());
    }
}
