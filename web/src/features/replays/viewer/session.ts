// One replay playing in a canvas: loads the map and the replay together, then runs the frame loop. The page
// imports this only when someone presses play, so the renderer stays out of every page's bundle.
import { mat4 } from "gl-matrix";
import { Camera, followViewMatrix } from "./camera";
import { tokenColor } from "./colors";
import {
  type InterpolationMode,
  PlaybackEngine,
  type PlaybackState,
} from "./playback";
import { FL_DUCKING, MovementAnalysis } from "./movement";
import type { PathSpec } from "./pathRenderer";
import { Renderer } from "./renderer";
import { createDiffSample, type DiffSample, ReplayDiff } from "./replayDiff";
import { loadReplay, type Replay } from "./sjr";
import type { BoxSpec } from "./zoneRenderer";

export interface ViewerSource {
  mapName: string;
  /** The map's stripped viewer file; the browser decodes its brotli encoding. */
  mapUrl: string;
  stockContentUrl: string;
  replayUrl: string;
}

export interface ViewerEvents {
  /**
   * Every frame, with the playhead and the run's timer (seconds since the start, held at 0 before it and at
   * the final time after the finish), and where the comparison run was at the same point of the route: null
   * without one, before the start, or off its route. `viewed` is the run the view follows: this one's state, or
   * the compared run's at the same time into its run. It should write to the DOM directly rather than set React
   * state, which would re-render 60 times a second.
   */
  onFrame: (
    state: PlaybackState,
    timer: number,
    comparison: DiffSample | null,
    viewed: PlaybackState,
  ) => void;
  /** Freecam switched on or off, including when the browser released the mouse. */
  onCameraChange: (freecam: boolean) => void;
}

/** Whose eyes the view follows outside freecam: the replay's own run, or the run it's compared with. */
export type Follow = "run" | "compared";

/** What's drawn into the map besides the replay itself. */
export interface Overlays {
  /** Each run's route: bright where it has been, muted ahead. */
  paths: boolean;
  /** A box where each run's player is: the compared run's always, this run's in freecam. */
  players: boolean;
}

export interface ViewerSession {
  readonly tickCount: number;
  readonly tickRate: number;
  /** The run's bounds within the replay, which also holds the ticks before the start and after the finish. */
  readonly runStart: number;
  readonly runEnd: number;
  readonly playing: boolean;
  setPlaying(playing: boolean): void;
  seek(tick: number): void;
  /** Moves by whole ticks and pauses. */
  step(ticks: number): void;
  setSpeed(rate: number): void;
  setInterpolation(mode: InterpolationMode): void;
  setFullbright(on: boolean): void;
  /** Test only (`?texcap=`): textures at most `cap` pixels a side, null for full detail. */
  setTextureCap(cap: number | null): void;
  /** Must run inside a click or key press, which the browser needs before it captures the mouse. */
  setFreecam(freecam: boolean): void;
  readonly freecam: boolean;
  /** Loads another run's replay on the same map and style to measure this one against, from the next frame on. */
  compareWith(replayUrl: string, signal: AbortSignal): Promise<void>;
  setOverlays(overlays: Overlays): void;
  /** The compared run's view needs a compared run; without one the view stays on this run. */
  setFollow(follow: Follow): void;
  /** Draws the replay at `tick` into `target` from the next frame on, until called with null. */
  setPreview(tick: number | null, target: HTMLCanvasElement | null): void;
  dispose(): void;
}

// A frame longer than this (a background tab, a debugger pause) is treated as this long, so playback doesn't
// leap ahead when the page comes back.
const MAX_FRAME_SECONDS = 0.1;
// The hover preview is a second render pass; dragging along the scrubber needs no more than this.
const PREVIEW_INTERVAL_MS = 50;
// A player's box, as Source's hull: 32 units square, 72 tall standing and 54 ducked.
const HULL_HALF_WIDTH = 16;
const HULL_HEIGHT = 72;
const HULL_HEIGHT_DUCKED = 54;

/** The run within a replay, as drawn: its route and colour. */
function pathOf(replay: Replay, color: PathSpec["color"]): PathSpec {
  const analysis = new MovementAnalysis(
    replay.positions,
    replay.flags,
    replay.buttons,
    replay.tickCount,
    replay.tickRate,
  );
  return {
    positions: replay.positions,
    teleports: analysis.discontinuity,
    from: replay.preFrames,
    to: replay.tickCount - replay.postFrames - 1,
    color,
  };
}

/** The player's box at a fractional tick, between the ticks around it. */
function hullAt(
  replay: Replay,
  exactTick: number,
  color: BoxSpec["color"],
): BoxSpec {
  const last = replay.tickCount - 1;
  const tick = Math.min(Math.max(exactTick, 0), last);
  const a = Math.floor(tick);
  const b = Math.min(a + 1, last);
  const t = tick - a;
  const p = replay.positions;
  const at = (axis: number) =>
    p[a * 3 + axis]! + (p[b * 3 + axis]! - p[a * 3 + axis]!) * t;
  const [x, y, z] = [at(0), at(1), at(2)];
  const height =
    replay.flags[a]! & FL_DUCKING ? HULL_HEIGHT_DUCKED : HULL_HEIGHT;
  return {
    min: [x - HULL_HALF_WIDTH, y - HULL_HALF_WIDTH, z],
    max: [x + HULL_HALF_WIDTH, y + HULL_HALF_WIDTH, z + height],
    color,
  };
}

/** Loads and starts a replay. */
export async function startViewer(
  canvas: HTMLCanvasElement,
  source: ViewerSource,
  events: ViewerEvents,
  signal: AbortSignal,
): Promise<ViewerSession> {
  const renderer = new Renderer(canvas, source.stockContentUrl);
  const loading = new AbortController();
  const loadSignal = AbortSignal.any([signal, loading.signal]);
  try {
    const [, replay] = await Promise.all([
      renderer.load(source.mapUrl, source.mapName, loadSignal),
      loadReplay(source.replayUrl, loadSignal),
    ]);

    const engine = new PlaybackEngine(
      replay.positions,
      replay.angles,
      replay.buttons,
      replay.flags,
      replay.tickCount,
      replay.tickRate,
      replay.time,
    );
    const camera = new Camera(canvas);
    camera.onModeChange = () => events.onCameraChange(camera.isFreecam);
    const runStart = replay.preFrames;

    const preview = {
      tick: null as number | null,
      target: null as HTMLCanvasElement | null,
      drawnTick: null as number | null,
      drawnAt: 0,
      view: mat4.create(),
      position: new Float32Array(3),
      angles: new Float32Array(2),
    };
    const drawPreview = (now: number) => {
      if (preview.tick === null || !preview.target) return;
      if (preview.tick === preview.drawnTick) return;
      if (now - preview.drawnAt < PREVIEW_INTERVAL_MS) return;
      const eyeHeight = engine.getTickView(
        preview.tick,
        preview.position,
        preview.angles,
      );
      followViewMatrix(
        preview.view,
        preview.position,
        eyeHeight,
        preview.angles,
      );
      renderer.renderPreview(preview.view, preview.target);
      preview.drawnTick = preview.tick;
      preview.drawnAt = now;
    };

    let diff: ReplayDiff | null = null;
    const comparison = createDiffSample();
    let other: Replay | null = null;
    // The compared run played in step with this one, for following it.
    let otherEngine: PlaybackEngine | null = null;
    let follow: Follow = "run";
    let interpolation: InterpolationMode = "smooth";
    let overlays: Overlays = { paths: false, players: false };
    const colors = {
      run: tokenColor("--color-accent"),
      other: tokenColor("--color-warning"),
    };
    const drawPaths = () =>
      renderer.setPaths(
        overlays.paths
          ? [
              pathOf(replay, colors.run),
              ...(other ? [pathOf(other, colors.other)] : []),
            ]
          : [],
      );

    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const seconds = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
      last = now;
      engine.update(seconds);
      const timer = (engine.state.exactTick - runStart) / replay.tickRate;
      // The compared run where it was at the same time into its run: a ghost to race.
      const otherTick = other ? other.preFrames + timer * other.tickRate : 0;
      otherEngine?.setTick(otherTick);
      const following = follow === "compared" && otherEngine !== null;
      const viewed = following ? otherEngine!.state : engine.state;
      // Before the main pass, which draws over the corner of the canvas the preview borrows.
      drawPreview(now);
      renderer.render(camera.update(seconds, viewed));
      if (overlays.paths)
        renderer.setPathTicks([engine.state.exactTick, otherTick]);
      if (overlays.players) {
        // Seen from a player's own eyes, their box would only frame the view, so the followed run has none.
        const markers: BoxSpec[] = [];
        if (other && (camera.isFreecam || !following))
          markers.push(hullAt(other, otherTick, colors.other));
        if (camera.isFreecam || following)
          markers.push(hullAt(replay, engine.state.exactTick, colors.run));
        renderer.setMarkers(markers);
      }
      if (diff)
        diff.sample(engine.state.position, comparison, engine.seekGeneration);
      const comparable =
        diff !== null && comparison.valid && engine.state.exactTick >= runStart;
      // The gaps are this run's against the other; they'd read backwards while watching the other.
      events.onFrame(
        engine.state,
        Math.min(Math.max(timer, 0), replay.time),
        comparable && !following ? comparison : null,
        viewed,
      );
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return {
      tickCount: replay.tickCount,
      tickRate: replay.tickRate,
      runStart,
      runEnd: replay.tickCount - replay.postFrames,
      get playing() {
        return engine.isPlaying;
      },
      setPlaying: (playing) => engine.setPlaying(playing),
      seek: (tick) => engine.setTick(tick),
      step: (ticks) => engine.stepTicks(ticks),
      setSpeed: (rate) => engine.setPlaybackRate(rate),
      setInterpolation: (mode) => {
        interpolation = mode;
        engine.setInterpolation(mode);
        otherEngine?.setInterpolation(mode);
      },
      setFullbright: (on) => renderer.setFullbright(on),
      setTextureCap: (cap) => renderer.setTextureCap(cap),
      setFreecam: (freecam) => camera.setFreecam(freecam),
      get freecam() {
        return camera.isFreecam;
      },
      compareWith: async (replayUrl, signal) => {
        const loaded = await loadReplay(replayUrl, signal);
        const analysis = new MovementAnalysis(
          loaded.positions,
          loaded.flags,
          loaded.buttons,
          loaded.tickCount,
          loaded.tickRate,
        );
        diff = new ReplayDiff(
          loaded.positions,
          loaded.tickRate,
          {
            start: loaded.preFrames,
            end: loaded.tickCount - loaded.postFrames,
          },
          analysis,
        );
        other = loaded;
        otherEngine = new PlaybackEngine(
          loaded.positions,
          loaded.angles,
          loaded.buttons,
          loaded.flags,
          loaded.tickCount,
          loaded.tickRate,
          loaded.time,
        );
        otherEngine.setInterpolation(interpolation);
        drawPaths();
      },
      setFollow: (next) => {
        follow = next;
      },
      setOverlays: (next) => {
        const pathsChanged = next.paths !== overlays.paths;
        overlays = next;
        if (pathsChanged) drawPaths();
        if (!next.players) renderer.setMarkers([]);
      },
      setPreview: (tick, target) => {
        preview.tick = tick;
        preview.target = target;
        if (tick === null) preview.drawnTick = null;
      },
      dispose: () => {
        cancelAnimationFrame(frame);
        camera.dispose();
        renderer.dispose();
      },
    };
  } catch (error) {
    loading.abort();
    renderer.dispose();
    throw error;
  }
}
