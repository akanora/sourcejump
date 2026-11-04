//! Reads the header of a shavit replay file, so an upload can be checked against the run it belongs to.
//!
//! Only format 12 (`12:{SHAVITREPLAYFORMAT}{FINAL}`, shavit's current one) is accepted. After the header come
//! `pre_frames + run_frames + post_frames` frames of `FRAME_SIZE` bytes each, and nothing else.

/// Bytes per tick in format 12: position (3 floats), angles (2 floats), buttons, flags, move type, mouse
/// movement and the movement keys, 4 bytes each.
pub const FRAME_SIZE: usize = 40;

const FIRST_LINE: &[u8] = b"12:{SHAVITREPLAYFORMAT}{FINAL}\n";
/// SourceMod's `PLATFORM_MAX_PATH`, which bounds the map name shavit writes.
const MAX_MAP_LEN: usize = 256;

#[derive(Debug, Clone, PartialEq)]
pub struct ReplayHeader {
    pub map: String,
    /// shavit's style number on the recording server. SourceJump knows styles by their settings, not their
    /// number, so this is kept for reference only.
    pub style: u8,
    pub track: u8,
    /// Ticks recorded before the start zone was left.
    pub pre_frames: u32,
    /// Ticks of the run itself.
    pub run_frames: u32,
    /// Ticks recorded after the finish.
    pub post_frames: u32,
    /// Seconds.
    pub time: f32,
    /// The player's Steam account ID: their SteamID64 minus 76561197960265728.
    pub account_id: u32,
    pub tickrate: f32,
    /// The header's length in bytes; the frames start here.
    pub len: usize,
}

impl ReplayHeader {
    pub fn frame_count(&self) -> usize {
        [self.pre_frames, self.run_frames, self.post_frames]
            .into_iter()
            .map(|count| count as usize)
            .sum()
    }
}

/// Reads the header and checks that the file holds exactly the frames it announces.
pub fn parse(file: &[u8]) -> Result<ReplayHeader, String> {
    let rest = file
        .strip_prefix(FIRST_LINE)
        .ok_or("not a shavit replay in format 12")?;
    let map_len = rest
        .iter()
        .take(MAX_MAP_LEN + 1)
        .position(|&byte| byte == 0)
        .ok_or("the map name is missing or too long")?;
    let map = std::str::from_utf8(&rest[..map_len])
        .map_err(|_| "the map name isn't text")?
        .to_owned();

    let mut fields = Fields {
        bytes: &rest[map_len + 1..],
    };
    let style = fields.u8()?;
    let track = fields.u8()?;
    let pre_frames = fields.count()?;
    let run_frames = fields.count()?;
    let time = fields.f32()?;
    let account_id = fields.u32()?;
    let post_frames = fields.count()?;
    let tickrate = fields.f32()?;
    // Two zone offsets and the time the file was written, which the checks don't use.
    fields.skip(12)?;

    let header = ReplayHeader {
        map,
        style,
        track,
        pre_frames,
        run_frames,
        post_frames,
        time,
        account_id,
        tickrate,
        len: file.len() - fields.bytes.len(),
    };
    let expected = header.frame_count().checked_mul(FRAME_SIZE);
    if expected != Some(fields.bytes.len()) {
        return Err(format!(
            "the header announces {} frames but the file holds {} bytes of frames",
            header.frame_count(),
            fields.bytes.len()
        ));
    }
    Ok(header)
}

/// Little-endian fields read off the front of the header.
struct Fields<'a> {
    bytes: &'a [u8],
}

impl Fields<'_> {
    fn take<const N: usize>(&mut self) -> Result<[u8; N], String> {
        let (field, rest) = self
            .bytes
            .split_first_chunk::<N>()
            .ok_or("the header is cut short")?;
        self.bytes = rest;
        Ok(*field)
    }

    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take::<1>()?[0])
    }

    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take()?))
    }

    fn f32(&mut self) -> Result<f32, String> {
        Ok(f32::from_le_bytes(self.take()?))
    }

    /// shavit writes frame counts as signed integers; a negative one means a broken file.
    fn count(&mut self) -> Result<u32, String> {
        u32::try_from(i32::from_le_bytes(self.take()?))
            .map_err(|_| "a frame count is negative".to_owned())
    }

    fn skip(&mut self, len: usize) -> Result<(), String> {
        self.bytes = self.bytes.get(len..).ok_or("the header is cut short")?;
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::{FRAME_SIZE, parse};

    pub(crate) const MAZE: &[u8] = include_bytes!("fixtures/bhop_maze.replay");
    pub(crate) const LUCENT: &[u8] = include_bytes!("fixtures/bhop_lucenttop6.replay");
    pub(crate) const DONTFAIL: &[u8] = include_bytes!("fixtures/bhop_dontfail_extend.replay");

    #[test]
    fn reads_real_replays() {
        let header = parse(MAZE).unwrap();

        assert_eq!(header.map, "bhop_maze");
        assert_eq!((header.style, header.track), (0, 0));
        assert!((header.tickrate - 100.0).abs() < f32::EPSILON);
        assert!(header.time > 0.0);
        assert_eq!(
            header.len + header.frame_count() * FRAME_SIZE,
            MAZE.len(),
            "the frames fill the rest of the file"
        );
        assert_eq!(parse(DONTFAIL).unwrap().style, 7);
        assert_eq!(parse(LUCENT).unwrap().map, "bhop_lucenttop6");
    }

    #[test]
    fn refuses_other_formats_and_broken_files() {
        let mut other_version = MAZE.to_vec();
        other_version[1] = b'1';
        let cut_short = &MAZE[..MAZE.len() - 1];
        let header_only = &MAZE[..60];

        for (file, expected) in [
            (&other_version[..], "format 12"),
            (cut_short, "frames"),
            (header_only, "cut short"),
            (b"hello".as_slice(), "format 12"),
        ] {
            let error = parse(file).unwrap_err();
            assert!(
                error.contains(expected),
                "{error:?} should mention {expected:?}"
            );
        }
    }
}
