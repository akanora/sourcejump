"use client";
// A number that counts up to its value when it scrolls into view, and from the old value when it changes.
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";

interface Props {
  value: number;
  /** Passed to Intl.NumberFormat. Options rather than a function, so server components can set them. */
  format?: Intl.NumberFormatOptions;
}

const noSubscription = () => () => {};

export function CountUp({ value, format }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  /** The number on screen, mid-count included, so a change while counting carries on from where it is. */
  const shown = useRef(0);
  // False only while hydrating a server-rendered page, whose number the browser has already painted.
  const clientRender = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const fromServer = useRef(!clientRender);
  const formatter = new Intl.NumberFormat("en", format);
  const text = formatter.format(value);

  // A layout effect, so the starting number is in place before the browser paints the new one.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const from = shown.current;
    const settle = () => {
      shown.current = value;
      fromServer.current = false;
      element.textContent = text;
    };
    // Counting a number the page loaded with, in view, would take it back to 0 after it was read.
    if (
      from === value ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      (fromServer.current && inView(element))
    ) {
      settle();
      return;
    }

    // Whole numbers count in whole steps; the formatter would otherwise show the fractions in between.
    const whole = Number.isInteger(from) && Number.isInteger(value);
    element.textContent = formatter.format(from);
    const duration =
      toMilliseconds(
        getComputedStyle(element).getPropertyValue("--duration-count"),
      ) ?? 900;
    let frame = 0;
    const animate = () => {
      let start: number | undefined;
      const step = (now: number) => {
        // Timed from the first frame: a frame's timestamp can be earlier than the moment it was asked for.
        start ??= now;
        const progress = Math.min((now - start) / duration, 1);
        if (progress === 1) {
          settle();
          return;
        }
        const eased = 1 - (1 - progress) ** 3;
        const current = from + (value - from) * eased;
        shown.current = whole ? Math.round(current) : current;
        element.textContent = formatter.format(shown.current);
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };

    // Count only once the number can be seen; a count that finished off-screen is wasted.
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      animate();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
    // The formatter is rebuilt each render from `format`; its output is what matters, keyed by `text`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, text]);

  return (
    <>
      <span ref={ref} aria-hidden>
        {text}
      </span>
      <span className="sr-only">{text}</span>
    </>
  );
}

function inView(element: HTMLElement): boolean {
  const box = element.getBoundingClientRect();
  return box.bottom > 0 && box.top < window.innerHeight;
}

/** A CSS time, which the stylesheet's minifier may have rewritten (900ms becomes .9s). */
function toMilliseconds(time: string): number | undefined {
  const match = /^\s*([\d.]+)(ms|s)\s*$/.exec(time);
  if (!match) return undefined;
  const amount = Number(match[1]);
  return match[2] === "s" ? amount * 1000 : amount;
}
