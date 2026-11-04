"use client";
// The control bar over a playing replay: play, the timeline, the time, and the camera, settings and fullscreen
// buttons. It fades out while the replay plays untouched, and stays while paused or in use.
import {
  Maximize,
  Minimize,
  Move3d,
  Pause,
  Play,
  Settings,
} from "lucide-react";
import {
  type Ref,
  type RefObject,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { formatTime } from "@/features/runs/time";
import { anchoredStyle, anchorStyle } from "@/ui/anchor";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { classNames } from "@/ui/classNames";
import { Segmented } from "@/ui/Segmented";
import { Tooltip } from "@/ui/Tooltip";
import type { ComparisonRun } from "./comparison";
import { type Lighting, LIGHTING_OPTIONS } from "./lighting";
import { parseRunId } from "./runId";
import { ReplayScrubber, type ScrubberHandle } from "./ReplayScrubber";
import type { InterpolationMode } from "./viewer/playback";
import type { Overlays, ViewerSession } from "./viewer/session";

export interface ControlsHandle {
  /** Moves the playhead and the time; called every frame. */
  update(tick: number, timer: number): void;
}

export const SPEEDS = [0.25, 0.5, 1, 2, 4];

const SMOOTHING: {
  value: InterpolationMode;
  label: string;
  description: string;
}[] = [
  {
    value: "smooth",
    label: "Smooth",
    description: "Curves through the recorded ticks.",
  },
  {
    value: "faithful",
    label: "Linear",
    description: "Straight lines between recorded ticks.",
  },
  {
    value: "exact",
    label: "Off",
    description: "Each recorded tick as it is, with no blending.",
  },
];

const SHORTCUTS = [
  ["Space", "Play or pause"],
  ["← →", "Step a tick (Shift 10, Ctrl 100)"],
  ["Home End", "Run start, run end"],
  ["X", "Freecam: WASD to fly, mouse to look"],
  ["F", "Fullscreen"],
];

// How long the bar stays after the pointer stops moving over a playing replay.
const HIDE_AFTER_MS = 2500;

export function ReplayControls({
  session,
  runTime,
  container,
  playing,
  freecam,
  fullscreen,
  speed,
  interpolation,
  lighting,
  overlays,
  comparison,
  usual,
  comparing,
  styleNames,
  onTogglePlaying,
  onToggleFreecam,
  onToggleFullscreen,
  onSpeed,
  onInterpolation,
  onLighting,
  onOverlays,
  onComparison,
  onIdle,
  ref,
}: {
  session: ViewerSession;
  runTime: number;
  /** The player, whose pointer movement brings the bar back. */
  container: RefObject<HTMLElement | null>;
  playing: boolean;
  freecam: boolean;
  /** Null where the browser can't make the player fullscreen (iPhone Safari). */
  fullscreen: boolean | null;
  speed: number;
  interpolation: InterpolationMode;
  lighting: Lighting;
  overlays: Overlays;
  /** The run the HUD's gaps are measured against, once its replay has loaded. */
  comparison: ComparisonRun | null;
  /** The run compared with by default: the record, or the next best. */
  usual: ComparisonRun | null;
  /** Another run's replay loading to compare with, or why it couldn't be. */
  comparing: { busy: boolean; problem: string | null };
  styleNames: Record<string, string>;
  onTogglePlaying: () => void;
  onToggleFreecam: () => void;
  onToggleFullscreen: () => void;
  onSpeed: (speed: number) => void;
  onInterpolation: (mode: InterpolationMode) => void;
  onLighting: (lighting: Lighting) => void;
  onOverlays: (overlays: Overlays) => void;
  onComparison: (runId: number) => void;
  /** The bar faded out (true) or came back, so the player can hide the pointer with it. */
  onIdle: (idle: boolean) => void;
  ref: Ref<ControlsHandle>;
}) {
  const scrubberRef = useRef<ScrubberHandle>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const settingsId = useId();
  const settingsRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [idle, setIdle] = useState(false);

  useImperativeHandle(ref, () => ({
    update(tick, timer) {
      scrubberRef.current?.update(tick);
      if (timeRef.current) timeRef.current.textContent = formatTime(timer);
    },
  }));

  // A mouse can send a thousand moves a second, so a move only stamps the time; one timer decides when to
  // hide. The bar stays while the replay is paused, a setting is open, the timeline is being dragged, or the
  // pointer or keyboard focus is on the bar.
  const held = !playing || settingsOpen || scrubbing;
  useEffect(() => {
    const player = container.current;
    if (!player) return;
    let lastActivity = performance.now();
    const wake = () => {
      lastActivity = performance.now();
      setIdle(false);
    };
    const check = () => {
      const bar = barRef.current;
      const inUse =
        held || !!bar?.matches(":hover") || !!bar?.matches(":focus-within");
      if (inUse) lastActivity = performance.now();
      else if (performance.now() - lastActivity > HIDE_AFTER_MS) setIdle(true);
    };
    if (held) wake();
    player.addEventListener("pointermove", wake, { passive: true });
    player.addEventListener("keydown", wake);
    const interval = window.setInterval(check, 250);
    return () => {
      player.removeEventListener("pointermove", wake);
      player.removeEventListener("keydown", wake);
      window.clearInterval(interval);
    };
  }, [container, held]);
  useEffect(() => onIdle(idle), [idle, onIdle]);

  // The HUD sits above the bar's content (not its fading gradient), whose height changes with the player's
  // width, so it's measured and handed over as --replay-bar on the player.
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const player = container.current;
    const content = contentRef.current;
    if (!player || !content) return;
    const observer = new ResizeObserver(() =>
      player.style.setProperty("--replay-bar", `${content.offsetHeight}px`),
    );
    observer.observe(content);
    return () => observer.disconnect();
  }, [container]);

  const smoothing = SMOOTHING.find((option) => option.value === interpolation);
  return (
    <div
      ref={barRef}
      className={classNames(
        "from-bg/90 absolute inset-x-0 bottom-0 bg-linear-to-t to-transparent px-3 pt-10 pb-1",
        "transition-opacity duration-(--duration-base)",
        idle ? "pointer-events-none opacity-0" : "opacity-100",
      )}
    >
      <div ref={contentRef}>
        <ReplayScrubber
          ref={scrubberRef}
          session={session}
          runTime={runTime}
          onScrubbing={setScrubbing}
        />
        <div className="flex items-center gap-1">
          <Tooltip content={playing ? "Pause (Space)" : "Play (Space)"}>
            <Button
              variant="ghost"
              size="sm"
              aria-label={playing ? "Pause" : "Play"}
              onClick={onTogglePlaying}
            >
              {playing ? <Pause /> : <Play />}
            </Button>
          </Tooltip>
          <span className="text-text-muted px-1 text-sm tabular-nums">
            <span ref={timeRef} className="text-text">
              {formatTime(0)}
            </span>
            {" / "}
            {formatTime(runTime)}
          </span>
          <span className="flex-1" />
          {speed !== 1 && (
            <Tooltip content="Back to normal speed">
              <Button variant="ghost" size="sm" onClick={() => onSpeed(1)}>
                {speed}×
              </Button>
            </Tooltip>
          )}
          <Tooltip
            content={freecam ? "Back to the player's view (X)" : "Freecam (X)"}
          >
            <Button
              variant="ghost"
              size="sm"
              aria-label="Freecam"
              aria-pressed={freecam}
              onClick={onToggleFreecam}
            >
              <Move3d />
            </Button>
          </Tooltip>
          <Button
            variant="ghost"
            size="sm"
            popoverTarget={settingsId}
            aria-label="Settings"
            aria-expanded={settingsOpen}
            style={anchorStyle(settingsId)}
          >
            <Settings
              className={classNames(
                "transition-transform duration-(--duration-base)",
                settingsOpen && "rotate-45",
              )}
            />
          </Button>
          {fullscreen !== null && (
            <Tooltip
              content={fullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}
            >
              <Button
                variant="ghost"
                size="sm"
                aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                onClick={onToggleFullscreen}
              >
                {fullscreen ? <Minimize /> : <Maximize />}
              </Button>
            </Tooltip>
          )}
        </div>
      </div>

      <div
        ref={settingsRef}
        id={settingsId}
        popover="auto"
        aria-label="Replay settings"
        style={anchoredStyle(settingsId, "top span-left")}
        onToggle={(event) => setSettingsOpen(event.newState === "open")}
        className="border-border-strong bg-surface-overlay text-text shadow-popover m-0 mb-2 max-h-96 w-72 overflow-y-auto rounded-md border p-3 text-sm"
      >
        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-1.5">
            <h3 className="text-text-subtle text-xs font-bold tracking-wide uppercase">
              Speed
            </h3>
            <Segmented
              label="Speed"
              value={String(speed)}
              onChange={(value) => onSpeed(Number(value))}
              options={SPEEDS.map((value) => ({
                value: String(value),
                label: `${value}×`,
              }))}
            />
          </section>
          <section className="flex flex-col gap-1.5">
            <h3 className="text-text-subtle text-xs font-bold tracking-wide uppercase">
              Smoothing
            </h3>
            <Segmented
              label="Smoothing"
              value={interpolation}
              onChange={(value) => onInterpolation(value as InterpolationMode)}
              options={SMOOTHING}
            />
            <p className="text-text-muted text-xs">{smoothing?.description}</p>
          </section>
          <section className="flex flex-col gap-1.5">
            <h3 className="text-text-subtle text-xs font-bold tracking-wide uppercase">
              Lighting
            </h3>
            <Segmented
              label="Lighting"
              value={lighting}
              onChange={(value) => onLighting(value as Lighting)}
              options={LIGHTING_OPTIONS}
            />
          </section>
          <section className="flex flex-col gap-1.5">
            <h3 className="text-text-subtle text-xs font-bold tracking-wide uppercase">
              Show
            </h3>
            <OverlayRow
              label="Routes"
              on={overlays.paths}
              onChange={(paths) => onOverlays({ ...overlays, paths })}
            />
            <OverlayRow
              label="Players"
              on={overlays.players}
              onChange={(players) => onOverlays({ ...overlays, players })}
            />
            <p className="text-text-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="bg-accent size-2 rounded-full" />
                This run
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="bg-warning size-2 rounded-full" />
                Compared run
              </span>
            </p>
            <p className="text-text-muted text-xs">
              Routes dim where the run is still to go. This run&apos;s player
              shows in freecam.
            </p>
          </section>
          <section className="flex flex-col gap-1.5">
            <h3 className="text-text-subtle text-xs font-bold tracking-wide uppercase">
              Compare with
            </h3>
            {comparison && (
              <p className="flex items-center gap-2 text-xs">
                <span aria-hidden className="bg-warning size-2 rounded-full" />
                <span className="min-w-0 truncate">
                  {comparison.player}, {formatTime(comparison.time)}
                </span>
                <span className="text-text-subtle ml-auto shrink-0">
                  {styleNames[comparison.style] ?? comparison.style}
                  {comparison.track !== 0 && ` · B${comparison.track}`}
                </span>
              </p>
            )}
            <CompareForm busy={comparing.busy} onCompare={onComparison} />
            {comparing.problem && (
              <p className="text-danger text-xs">{comparing.problem}</p>
            )}
            {usual && usual.runId !== comparison?.runId && (
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => onComparison(usual.runId)}
              >
                Back to {usual.rank === 1 ? "the record" : `#${usual.rank}`}
              </Button>
            )}
            <p className="text-text-muted text-xs">
              Any run on this map with a replay, of any style: its ID or its
              link. The timer and speed gaps are measured against it.
            </p>
          </section>
          <section className="border-border flex flex-col gap-1.5 border-t pt-3">
            <h3 className="text-text-subtle text-xs font-bold tracking-wide uppercase">
              Keyboard
            </h3>
            <dl className="flex flex-col gap-1 text-xs">
              {SHORTCUTS.map(([keys, action]) => (
                <div key={keys} className="flex gap-3">
                  <dt className="text-text w-16 shrink-0">{keys}</dt>
                  <dd className="text-text-muted">{action}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

/** One overlay switched off or on. */
function OverlayRow({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-muted text-xs">{label}</span>
      <Segmented
        label={label}
        value={on ? "on" : "off"}
        onChange={(value) => onChange(value === "on")}
        options={[
          { value: "off", label: "Off" },
          { value: "on", label: "On" },
        ]}
      />
    </div>
  );
}

/** A run to compare with, by the ID or link typed or pasted. */
function CompareForm({
  busy,
  onCompare,
}: {
  busy: boolean;
  onCompare: (runId: number) => void;
}) {
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        const id = parseRunId(text);
        setInvalid(id === null);
        if (id !== null) onCompare(id);
      }}
    >
      <div className="flex gap-2">
        <Input
          aria-label="Run ID or link"
          placeholder="Run ID or link"
          value={text}
          onChange={(event) => setText(event.target.value)}
          // Keys typed here are text, not the player's shortcuts.
          onKeyDown={(event) => event.stopPropagation()}
          className="min-w-0 flex-1"
        />
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          {busy ? "Loading…" : "Compare"}
        </Button>
      </div>
      {invalid && (
        <p className="text-danger text-xs">
          Give a run&apos;s number, like 1651, or its link.
        </p>
      )}
    </form>
  );
}
