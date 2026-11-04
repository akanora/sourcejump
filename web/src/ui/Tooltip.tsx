"use client";
// A short hint shown on hover or keyboard focus, e.g. the exact date behind "3 days ago".
import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { anchoredStyle, anchorStyle } from "./anchor";

/**
 * The tip is a popover in the top layer, so tables and other scroll containers can't clip it.
 * `children` must be one element that can take focus (a button or link) so keyboard users get it too.
 */
export function Tooltip({
  content,
  children,
}: {
  content: ReactNode;
  children: ReactElement;
}) {
  const id = useId();
  const tip = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  // Links the child to the tip in the DOM rather than with cloneElement: an element a server component
  // sends after awaiting data can arrive here as a lazy reference (seen in development), and cloning one
  // loses its type.
  useEffect(() => {
    anchor.current?.firstElementChild?.setAttribute("aria-describedby", id);
  }, [id]);
  const show = () => {
    if (!tip.current?.matches(":popover-open")) tip.current?.showPopover();
  };
  const hide = () => tip.current?.hidePopover();

  return (
    <>
      <span
        ref={anchor}
        style={anchorStyle(id)}
        className="inline-flex"
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      <div
        ref={tip}
        id={id}
        role="tooltip"
        popover="manual"
        style={anchoredStyle(id, "top")}
        // The tip sits beside its anchor in the DOM, so it inherits text styles from wherever it's used (a
        // table cell's nowrap, a badge row's capitals); reset them so it always reads as wrapped plain text.
        className="border-border-strong bg-surface-overlay text-text shadow-popover m-0 mb-2 max-w-64 rounded-md border px-2 py-1 text-left text-xs font-normal tracking-normal whitespace-normal normal-case"
      >
        {content}
      </div>
    </>
  );
}
