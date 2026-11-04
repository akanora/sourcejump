// The replay HUD's speed colour, which follows the speed's change the way the in-game speedometer does.
import type { PlaybackState } from "./viewer/playback";

// The in-game speedometer resamples this often and colours the speed by its change since: green gaining, red
// losing, accent holding. Frame to frame, rounding alone would flip the colour back and forth.
const SPEED_SAMPLE_TICKS = 10;

export type SpeedBand = "gaining" | "losing" | "holding";

/** The speed's colour, decided once per sample (which it moves on); null between samples. */
export function speedBand(
  sample: { tick: number; speed: number },
  state: PlaybackState,
): SpeedBand | null {
  const elapsed = state.tick - sample.tick;
  if (elapsed >= 0 && elapsed < SPEED_SAMPLE_TICKS) return null;
  const speed = Number.isNaN(state.speed) ? sample.speed : state.speed;
  // A seek lands somewhere unrelated (NaN on the first frame), so there's no change to report.
  const seeked = !(elapsed >= 0 && elapsed <= SPEED_SAMPLE_TICKS * 4);
  const change = seeked ? 0 : Math.floor(speed - sample.speed);
  sample.tick = state.tick;
  sample.speed = speed;
  return change > 0 ? "gaining" : change < 0 ? "losing" : "holding";
}
