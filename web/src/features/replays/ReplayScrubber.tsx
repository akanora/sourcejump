"use client";
// The replay's timeline: where the run starts and ends within the replay, the playhead, and a preview of
// the moment under the pointer. The playhead moves every frame, so it's written to the DOM, not React state.
import { type Ref, useImperativeHandle, useRef, useState } from "react";
import { formatTime } from "@/features/runs/time";
import { classNames } from "@/ui/classNames";
import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from "./viewer/renderer";
import type { ViewerSession } from "./viewer/session";

export interface ScrubberHandle {
  /** Moves the playhead; called every frame. */
  update(tick: number): void;
}

export function ReplayScrubber({
  session,
  runTime,
  onScrubbing,
  ref,
}: {
  session: ViewerSession;
  /** The run's final time in seconds, which the preview's time is held to. */
  runTime: number;
  onScrubbing: (scrubbing: boolean) => void;
  ref: Ref<ScrubberHandle>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewTimeRef = useRef<HTMLSpanElement>(null);
  const scrubbing = useRef(false);
  const [hovering, setHovering] = useState(false);

  const lastTick = session.tickCount - 1;
  const percent = (tick: number) => `${(tick / lastTick) * 100}%`;

  const paint = (tick: number) => {
    if (fillRef.current) fillRef.current.style.width = percent(tick);
    if (thumbRef.current) thumbRef.current.style.left = percent(tick);
  };
  useImperativeHandle(ref, () => ({
    update(tick) {
      paint(tick);
      // While dragging, the input owns its value; writing the playhead back would fight the pointer.
      if (!scrubbing.current && inputRef.current)
        inputRef.current.value = String(tick);
    },
  }));

  const setScrubbing = (next: boolean) => {
    if (scrubbing.current === next) return;
    scrubbing.current = next;
    onScrubbing(next);
    // A drag released outside the window never reaches the input, so the release is heard on the document.
    if (next)
      document.addEventListener("pointerup", () => setScrubbing(false), {
        once: true,
      });
  };

  const hover = (clientX: number, track: HTMLElement) => {
    const box = track.getBoundingClientRect();
    const fraction = Math.min(Math.max((clientX - box.left) / box.width, 0), 1);
    const tick = Math.round(fraction * lastTick);
    // Kept inside the player, so the preview never hangs off its edge.
    const half = PREVIEW_WIDTH / 2;
    const left = Math.min(
      Math.max(fraction * box.width, half),
      box.width - half,
    );
    if (previewRef.current) previewRef.current.style.left = `${left}px`;
    if (previewTimeRef.current) {
      const timer = (tick - session.runStart) / session.tickRate;
      previewTimeRef.current.textContent = formatTime(
        Math.min(Math.max(timer, 0), runTime),
      );
    }
    session.setPreview(tick, previewCanvasRef.current);
  };

  return (
    <div
      className="group relative h-4 cursor-pointer touch-none"
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        setHovering(true);
        hover(event.clientX, event.currentTarget);
      }}
      onPointerMove={(event) => {
        if (event.pointerType === "mouse")
          hover(event.clientX, event.currentTarget);
      }}
      onPointerLeave={() => {
        setHovering(false);
        session.setPreview(null, null);
      }}
    >
      {/* Always in the DOM, so the first hover has a canvas to draw into. */}
      <div
        ref={previewRef}
        aria-hidden
        className={classNames(
          "pointer-events-none absolute bottom-full mb-3 flex -translate-x-1/2 flex-col items-center gap-1",
          "transition-opacity duration-(--duration-fast)",
          hovering ? "opacity-100" : "opacity-0",
        )}
      >
        <canvas
          ref={previewCanvasRef}
          width={PREVIEW_WIDTH}
          height={PREVIEW_HEIGHT}
          className="border-border-strong bg-bg shadow-popover aspect-video w-60 rounded-md border"
        />
        <span
          ref={previewTimeRef}
          className="bg-bg/90 rounded-sm px-1.5 text-xs tabular-nums"
        />
      </div>
      <div className="bg-text/25 absolute inset-x-0 top-1.5 h-1 rounded-full transition-all group-hover:top-1 group-hover:h-2">
        <div
          className="bg-text/25 absolute inset-y-0"
          style={{
            left: percent(session.runStart),
            right: `calc(100% - ${percent(session.runEnd)})`,
          }}
        />
        <div
          ref={fillRef}
          className="bg-accent absolute inset-y-0 left-0 rounded-full"
        />
      </div>
      {[session.runStart, session.runEnd].map((tick) => (
        <div
          key={tick}
          className="bg-text absolute top-0.5 h-3 w-0.5 -translate-x-1/2 rounded-full"
          style={{ left: percent(tick) }}
        />
      ))}
      <div
        ref={thumbRef}
        className="bg-accent absolute top-0.5 size-3 -translate-x-1/2 scale-0 rounded-full transition-transform group-hover:scale-100"
      />
      <input
        ref={inputRef}
        type="range"
        aria-label="Position in the replay"
        min={0}
        max={lastTick}
        defaultValue={0}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
        onPointerDown={() => setScrubbing(true)}
        onBlur={() => setScrubbing(false)}
        onInput={(event) => {
          const tick = Number(event.currentTarget.value);
          session.seek(tick);
          paint(tick);
        }}
      />
    </div>
  );
}
