//! A replay's route seen from above: where the player went from leaving the start zone to the finish, as a few
//! hundred points. The run page draws it before anyone chooses to load the viewer, so it must be small
//! (about 2 KB) and is worked out once, when the replay is stored.

use super::header::{FRAME_SIZE, ReplayHeader};

/// Enough for the shape of a long run at the size the run page draws it.
pub const POINTS: usize = 200;

/// Points evenly spaced in time over the run's own frames (the pre-start and post-finish ticks left out),
/// first and last frame included. x and y in Source units, rounded: the height isn't drawn.
pub fn route(file: &[u8], header: &ReplayHeader) -> Vec<[i32; 2]> {
    let run_frames = header.run_frames as usize;
    let first = header.pre_frames as usize;
    let count = run_frames.min(POINTS);
    (0..count)
        .map(|i| {
            // Spread over the whole run: point 0 is the first frame, the last point the last frame.
            let frame = first
                + if count == 1 {
                    0
                } else {
                    i * (run_frames - 1) / (count - 1)
                };
            let at = header.len + frame * FRAME_SIZE;
            let coordinate = |offset: usize| {
                let bytes = file[at + offset..at + offset + 4]
                    .try_into()
                    .expect("four bytes");
                // Positions in a checked replay are map coordinates, far inside i32.
                #[expect(clippy::cast_possible_truncation, reason = "rounded map coordinates")]
                let rounded = f32::from_le_bytes(bytes).round() as i32;
                rounded
            };
            [coordinate(0), coordinate(4)]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{POINTS, route};
    use crate::replays::header::{parse, tests::MAZE};

    #[test]
    fn spans_the_run_from_start_to_finish_in_a_few_hundred_points() {
        let header = parse(MAZE).unwrap();
        let points = route(MAZE, &header);

        assert_eq!(points.len(), POINTS);
        let frame = |index: usize| {
            let at = header.len + index * 40;
            [0, 4].map(|offset| {
                f32::from_le_bytes(MAZE[at + offset..at + offset + 4].try_into().unwrap()).round()
            })
        };
        let first = frame(header.pre_frames as usize);
        let last = frame((header.pre_frames + header.run_frames - 1) as usize);
        assert_eq!(points[0].map(f64::from), first.map(f64::from));
        assert_eq!(points[POINTS - 1].map(f64::from), last.map(f64::from));
        assert!(
            serde_json::to_string(&points).unwrap().len() < 4000,
            "small enough to send with the run"
        );
    }
}
