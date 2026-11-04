// The playhead: where the player is and looks at any fractional tick (from daf's replay viewer).
// Every index into the per-tick arrays is in range by construction; the `!`s say so to the strict index check.
import {
  clamp,
  deltaAngle,
  hermiteValueClamped,
  hermiteValueMonotone,
  lerp,
} from "./interpolation";
import {
  EYE_HEIGHT_DUCKED,
  EYE_HEIGHT_STANDING,
  FL_DUCKING,
  FL_ONGROUND,
  MovementAnalysis,
} from "./movement";

export {
  FL_DUCKING,
  FL_ONGROUND,
  IN_BACK,
  IN_DUCK,
  IN_FORWARD,
  IN_JUMP,
  IN_LEFT,
  IN_MOVELEFT,
  IN_MOVERIGHT,
  IN_RIGHT,
} from "./movement";

/**
 * faithful - linear position, shortest-path angles, tick-authentic state.
 * smooth   - clamped Catmull-Rom, still tick-authentic state, never crosses a
 *            teleport and never overshoots the recorded route.
 * exact    - no interpolation at all; shows exactly the recorded tick.
 */
export type InterpolationMode = "faithful" | "smooth" | "exact";

// How long playback holds at each end before looping, in ticks.
const PAUSE_TICKS = 100;

// Clamped-Hermite slack, as a fraction of the segment length. 0.15 keeps the
// curve visibly smoother than linear while bounding any excursion past the
// recorded points to 15% of one tick of travel.
const SMOOTH_SLACK = 0.15;

export interface PlaybackState {
  /** Integer tick currently displayed, clamped to the replay. */
  tick: number;
  /** Fractional tick position, clamped to the replay. */
  exactTick: number;
  position: Float32Array; // [x, y, z]
  angles: Float32Array; // [pitch, yaw]
  buttons: number;
  flags: number;
  eyeHeight: number;
  /** Horizontal speed in u/s, or NaN when a teleport makes it undefined. */
  speed: number;
  /** Vertical speed in u/s, or NaN when a teleport makes it undefined. */
  verticalSpeed: number;
  grounded: boolean;
  ducking: boolean;
  /** True when the step arriving at this tick was a teleport. */
  teleported: boolean;
  isPlaying: boolean;
  playbackRate: number;
  totalTicks: number;
  tickRate: number;
  time: number;
}

export class PlaybackEngine {
  private readonly positions: Float32Array;
  private readonly angles: Float32Array;
  private readonly buttons: Int32Array;
  private readonly flags: Int32Array;
  private readonly tickCount: number;
  readonly analysis: MovementAnalysis;
  readonly tickRate: number;
  readonly replayTime: number;

  /** Fractional playhead. May sit outside the replay during the end pauses. */
  private cursor = 0;
  isPlaying = true;
  playbackRate = 1.0;
  interpolation: InterpolationMode = "smooth";

  /** Bumped whenever the playhead moves discontinuously (seek, loop, step). */
  seekGeneration = 0;

  readonly state: PlaybackState;

  constructor(
    positions: Float32Array,
    angles: Float32Array,
    buttons: Int32Array,
    flags: Int32Array,
    tickCount: number,
    tickRate: number,
    replayTime: number,
    analysis?: MovementAnalysis,
  ) {
    this.positions = positions;
    this.angles = angles;
    this.buttons = buttons;
    this.flags = flags;
    this.tickCount = tickCount;
    this.tickRate = tickRate;
    this.replayTime = replayTime;
    this.analysis =
      analysis ??
      new MovementAnalysis(positions, flags, buttons, tickCount, tickRate);

    this.state = {
      tick: 0,
      exactTick: 0,
      position: new Float32Array(3),
      angles: new Float32Array(2),
      buttons: 0,
      flags: 0,
      eyeHeight: EYE_HEIGHT_STANDING,
      speed: 0,
      verticalSpeed: 0,
      grounded: false,
      ducking: false,
      teleported: false,
      isPlaying: true,
      playbackRate: 1.0,
      totalTicks: tickCount,
      tickRate,
      time: replayTime,
    };
    this.refresh();
  }

  get tick(): number {
    return this.state.tick;
  }

  private clampTick(tick: number): number {
    return tick < 0 ? 0 : tick > this.tickCount - 1 ? this.tickCount - 1 : tick;
  }

  private readPos(tick: number, out: Float32Array): void {
    const o = this.clampTick(tick) * 3;
    out[0] = this.positions[o]!;
    out[1] = this.positions[o + 1]!;
    out[2] = this.positions[o + 2]!;
  }

  private readAngles(tick: number, out: Float32Array): void {
    const o = this.clampTick(tick) * 2;
    out[0] = this.angles[o]!;
    out[1] = this.angles[o + 1]!;
  }

  getTickFlags(tick: number): number {
    return this.flags[this.clampTick(tick)]!;
  }

  getTickButtons(tick: number): number {
    return this.buttons[this.clampTick(tick)]!;
  }

  eyeHeightAt(tick: number): number {
    return (this.getTickFlags(tick) & FL_DUCKING) !== 0
      ? EYE_HEIGHT_DUCKED
      : EYE_HEIGHT_STANDING;
  }

  /** Eye position and angles at an exact tick. Used by the scrub preview. */
  getTickView(
    tick: number,
    outPos: Float32Array,
    outAngles: Float32Array,
  ): number {
    this.readPos(tick, outPos);
    this.readAngles(tick, outAngles);
    return this.eyeHeightAt(tick);
  }

  setTick(tick: number): void {
    const next = clamp(tick, 0, this.tickCount - 1);
    if (next !== this.cursor) this.seekGeneration++;
    this.cursor = next;
    this.refresh();
  }

  /** Move by whole ticks and pause, for frame-accurate analysis. */
  stepTicks(delta: number): void {
    this.setPlaying(false);
    this.setTick(Math.round(this.cursor) + delta);
  }

  setPlaying(isPlaying: boolean): void {
    this.isPlaying = isPlaying;
    this.state.isPlaying = isPlaying;
  }

  togglePlaying(): void {
    this.setPlaying(!this.isPlaying);
  }

  setPlaybackRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) return;
    this.playbackRate = rate;
    this.state.playbackRate = rate;
  }

  setInterpolation(mode: InterpolationMode): void {
    this.interpolation = mode;
  }

  update(dt: number): void {
    if (this.isPlaying && dt > 0) {
      const lo = -PAUSE_TICKS;
      const hi = this.tickCount - 1 + PAUSE_TICKS;
      this.cursor += dt * this.playbackRate * this.tickRate;
      if (this.cursor > hi) {
        this.cursor = lo;
        this.seekGeneration++;
      } else if (this.cursor < lo) {
        this.cursor = hi;
        this.seekGeneration++;
      }
    }
    this.refresh();
  }

  /** Recompute the output state from the current playhead. */
  private refresh(): void {
    const state = this.state;
    const analysis = this.analysis;
    const exact = clamp(this.cursor, 0, this.tickCount - 1);
    const tick = Math.floor(exact);
    let frac = exact - tick;

    // Never interpolate across a teleport, and never interpolate at all in
    // exact mode. Both leave the view sitting on a recorded tick.
    if (this.interpolation === "exact" || analysis.breaksAfter(tick)) frac = 0;

    this.readPos(tick, state.position);
    this.readAngles(tick, state.angles);

    if (frac > 0) {
      if (this.interpolation === "smooth") this.smoothSample(tick, frac, state);
      else this.linearSample(tick, frac, state);
      // Eye height always ramps linearly. The recorded duck flag is binary, so
      // a cubic here would overshoot below the ducked height or above standing.
      state.eyeHeight = lerp(
        this.eyeHeightAt(tick),
        this.eyeHeightAt(tick + 1),
        frac,
      );
    } else {
      state.eyeHeight = this.eyeHeightAt(tick);
    }

    const flags = this.getTickFlags(tick);
    state.tick = tick;
    state.exactTick = tick + frac;
    state.buttons = this.getTickButtons(tick);
    state.flags = flags;
    state.speed = analysis.horizontalSpeed[tick]!;
    state.verticalSpeed = analysis.verticalSpeed[tick]!;
    state.grounded = (flags & FL_ONGROUND) !== 0;
    state.ducking = (flags & FL_DUCKING) !== 0;
    state.teleported = analysis.discontinuity[tick]! === 1;
    state.isPlaying = this.isPlaying;
    state.playbackRate = this.playbackRate;
  }

  private readonly scratch = {
    p0: new Float32Array(3),
    p1: new Float32Array(3),
    p2: new Float32Array(3),
    p3: new Float32Array(3),
    a1: new Float32Array(2),
    a2: new Float32Array(2),
    a0: new Float32Array(2),
    a3: new Float32Array(2),
  };

  private linearSample(tick: number, frac: number, state: PlaybackState): void {
    const s = this.scratch;
    this.readPos(tick, s.p1);
    this.readPos(tick + 1, s.p2);
    state.position[0] = lerp(s.p1[0]!, s.p2[0]!, frac);
    state.position[1] = lerp(s.p1[1]!, s.p2[1]!, frac);
    state.position[2] = lerp(s.p1[2]!, s.p2[2]!, frac);

    this.readAngles(tick, s.a1);
    this.readAngles(tick + 1, s.a2);
    state.angles[0] = s.a1[0]! + deltaAngle(s.a1[0]!, s.a2[0]!) * frac;
    state.angles[1] = s.a1[1]! + deltaAngle(s.a1[1]!, s.a2[1]!) * frac;
  }

  private smoothSample(tick: number, frac: number, state: PlaybackState): void {
    const s = this.scratch;
    const analysis = this.analysis;
    this.readPos(tick, s.p1);
    this.readPos(tick + 1, s.p2);
    // A teleport on either side of the segment poisons that tangent, so fall
    // back to the segment endpoint and let the curve start or end flat.
    if (analysis.breaksBefore(tick)) s.p0.set(s.p1);
    else this.readPos(tick - 1, s.p0);
    if (analysis.breaksAfter(tick + 1)) s.p3.set(s.p2);
    else this.readPos(tick + 2, s.p3);

    for (let i = 0; i < 3; i++)
      state.position[i] = hermiteValueClamped(
        s.p0[i]!,
        s.p1[i]!,
        s.p2[i]!,
        s.p3[i]!,
        frac,
        SMOOTH_SLACK,
      );

    this.readAngles(tick, s.a1);
    this.readAngles(tick + 1, s.a2);
    if (analysis.breaksBefore(tick)) s.a0.set(s.a1);
    else this.readAngles(tick - 1, s.a0);
    if (analysis.breaksAfter(tick + 1)) s.a3.set(s.a2);
    else this.readAngles(tick + 2, s.a3);

    for (let i = 0; i < 2; i++) {
      // Unwrap everything relative to the current tick so +-180 crossings take
      // the short way round.
      const base = s.a1[i]!;
      state.angles[i] = hermiteValueMonotone(
        base + deltaAngle(base, s.a0[i]!),
        base,
        base + deltaAngle(base, s.a2[i]!),
        base + deltaAngle(base, s.a3[i]!),
        frac,
      );
    }
  }
}
