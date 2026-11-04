"use client";
// The HUD over a playing replay: the run timer and speed at the bottom centre, each with its gap to the comparison
// run, and the keys held in the bottom-left corner (daf's layout). Both sit above the control bar while it shows and drop into its place when it fades.
// Everything here changes every frame, so it's written to the DOM, not React state.
import { type Ref, useImperativeHandle, useRef } from "react";
import { formatTime } from "@/features/runs/time";
import { classNames } from "@/ui/classNames";
import { speedBand } from "./speedBand";
import type { DiffSample } from "./viewer/replayDiff";
import {
  IN_BACK,
  IN_DUCK,
  IN_FORWARD,
  IN_JUMP,
  IN_LEFT,
  IN_MOVELEFT,
  IN_MOVERIGHT,
  IN_RIGHT,
  type PlaybackState,
} from "./viewer/playback";

export interface HudHandle {
  /** Shows the playhead's timer, speed, keys and gaps to the comparison run; called every frame. */
  update(
    state: PlaybackState,
    timer: number,
    comparison: DiffSample | null,
  ): void;
}

// +L and +R are +left and +right, which turn the view from the keyboard; about a third of runs use them.
const KEYS: { label: string; button: number; wide?: boolean }[][] = [
  [
    { label: "+L", button: IN_LEFT },
    { label: "W", button: IN_FORWARD },
    { label: "+R", button: IN_RIGHT },
  ],
  [
    { label: "A", button: IN_MOVELEFT },
    { label: "S", button: IN_BACK },
    { label: "D", button: IN_MOVERIGHT },
  ],
  [
    { label: "Duck", button: IN_DUCK, wide: true },
    { label: "Jump", button: IN_JUMP, wide: true },
  ],
];

// The gaps' sign takes a true minus, which is as wide as the plus, so a gap changing sign doesn't shift.
const MINUS = "\u2212";
// Green ahead of the comparison run, red behind it, muted level with it; an empty gap takes no room, so the panel
// only grows for it.
const GAP =
  "data-[sign=ahead]:text-success data-[sign=behind]:text-danger data-[sign=even]:text-text-muted text-xs empty:hidden @xl:text-sm";

interface Gap {
  text: string;
  sign: "ahead" | "behind" | "even";
}

/**
 * A gap as shown, `+0.211`, `−0.034` or `+12`, rounded first: on a route both runs took alike the raw gap hovers
 * around zero, and its sign and colour would flicker with the rounding noise.
 */
function gap(
  value: number,
  decimals: number,
  format: (magnitude: number) => string,
  aheadWhenLess: boolean,
): Gap {
  const rounded = Number(value.toFixed(decimals));
  if (rounded === 0) return { text: format(0), sign: "even" };
  const ahead = aheadWhenLess ? rounded < 0 : rounded > 0;
  return {
    text: (rounded < 0 ? MINUS : "+") + format(Math.abs(rounded)),
    sign: ahead ? "ahead" : "behind",
  };
}

function writeGap(element: HTMLElement | null, shown: Gap | null) {
  if (!element) return;
  element.textContent = shown?.text ?? "";
  element.dataset.sign = shown?.sign ?? "even";
}

export function ReplayHud({
  barShown,
  ref,
}: {
  /** The control bar is showing, so the HUD sits above it. */
  barShown: boolean;
  ref: Ref<HudHandle>;
}) {
  const timerRef = useRef<HTMLSpanElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const timeGapRef = useRef<HTMLSpanElement>(null);
  const speedGapRef = useRef<HTMLSpanElement>(null);
  const keyRefs = useRef(new Map<number, HTMLElement>());
  // What's on screen, so a frame that changes nothing writes nothing.
  const shown = useRef({
    timer: "",
    speed: "",
    buttons: -1,
    band: "",
    timeGap: "",
    speedGap: "",
  });
  const sample = useRef({ tick: Number.NaN, speed: 0 });

  useImperativeHandle(ref, () => ({
    update(state, timer, comparison) {
      const last = shown.current;
      const timerText = formatTime(timer);
      if (timerText !== last.timer && timerRef.current) {
        last.timer = timerText;
        timerRef.current.textContent = timerText;
      }
      // Across a teleport the recorded displacement means nothing, so the speed says so rather than showing
      // a five-digit number.
      const speedText = Number.isNaN(state.speed)
        ? "--"
        : String(Math.round(state.speed));
      if (speedText !== last.speed && speedRef.current) {
        last.speed = speedText;
        speedRef.current.textContent = speedText;
      }
      const band = speedBand(sample.current, state);
      if (band && band !== last.band && speedRef.current) {
        last.band = band;
        speedRef.current.dataset.band = band;
      }
      // Less time at the same point of the route is ahead; more speed is.
      const timeGap =
        comparison && gap(timer - comparison.time, 3, formatTime, true);
      if ((timeGap?.text ?? "") !== last.timeGap) {
        last.timeGap = timeGap?.text ?? "";
        writeGap(timeGapRef.current, timeGap);
      }
      const speedGap =
        comparison &&
        !Number.isNaN(state.speed) &&
        !Number.isNaN(comparison.speed)
          ? gap(state.speed - comparison.speed, 0, String, false)
          : null;
      if ((speedGap?.text ?? "") !== last.speedGap) {
        last.speedGap = speedGap?.text ?? "";
        writeGap(speedGapRef.current, speedGap);
      }
      if (state.buttons !== last.buttons) {
        last.buttons = state.buttons;
        for (const [button, key] of keyRefs.current)
          key.toggleAttribute("data-on", (state.buttons & button) !== 0);
      }
    },
  }));

  // --replay-bar is the bar's height, set by ReplayControls; the panels sit that far above their resting place.
  const lift = classNames(
    "transition-transform duration-(--duration-base) ease-out motion-reduce:transition-none",
    barShown ? "-translate-y-(--replay-bar)" : "translate-y-0",
  );
  const panel =
    "bg-bg/55 border-text/10 absolute bottom-3 rounded-md border backdrop-blur-xs";
  return (
    // The bar shows the same time to assistive technology; a readout that changes every frame would only be noise.
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div
        className={classNames(
          panel,
          lift,
          "left-1/2 flex w-max -translate-x-1/2 flex-col items-center px-2.5 py-1 font-bold tabular-nums @xl:px-3.5 @xl:py-1.5",
        )}
      >
        <span className="flex items-baseline gap-2">
          <span ref={timerRef} className="text-text text-sm @xl:text-lg">
            {formatTime(0)}
          </span>
          <span ref={timeGapRef} className={GAP} />
        </span>
        <span className="flex items-baseline gap-1">
          <span
            ref={speedRef}
            className="text-text data-[band=gaining]:text-success data-[band=holding]:text-accent data-[band=losing]:text-danger text-base transition-colors duration-(--duration-fast) @xl:text-xl"
          >
            0
          </span>
          <span className="text-text-subtle text-xs">u/s</span>
          <span ref={speedGapRef} className={classNames(GAP, "ml-1")} />
        </span>
      </div>
      {/* On a small player the keys would cover a corner of the picture; the timer and speed are what's read. */}
      <div
        className={classNames(
          panel,
          lift,
          "left-3 flex flex-col gap-1 p-1.5 @max-xl:hidden",
        )}
      >
        {KEYS.map((row) => (
          <div key={row[0]!.label} className="flex gap-1">
            {row.map(({ label, button, wide }) => (
              <span
                key={label}
                ref={(element) => {
                  if (element) keyRefs.current.set(button, element);
                  else keyRefs.current.delete(button);
                }}
                className={classNames(
                  "border-text/10 bg-text/5 text-text/40 flex h-9 items-center justify-center rounded-sm border text-xs font-bold",
                  "data-on:border-accent data-on:bg-accent/30 data-on:text-text",
                  wide ? "flex-1" : "w-9",
                )}
              >
                {label}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
