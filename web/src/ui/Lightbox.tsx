"use client";
// Pictures shown whole over the page, one at a time: arrows (and the arrow keys) step through them, and the
// miniatures below jump to one. Controlled like Dialog: the caller owns which picture is open, or null.
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "./Button";
import { classNames } from "./classNames";

export interface LightboxImage {
  /** The full picture. */
  url: string;
  /** A small copy, for the miniatures. */
  thumbnailUrl: string;
}

/**
 * Uses the native <dialog>, as Dialog does: it traps focus, makes the page behind it inert, closes on Escape
 * and returns focus to the opener. The page behind is darkened and blurred, so only the pictures stand out.
 * Clicking anywhere outside the picture and its controls closes it.
 */
export function Lightbox({
  images,
  index,
  onIndex,
  label,
}: {
  images: LightboxImage[];
  /** The picture shown, or null when closed. */
  index: number | null;
  onIndex: (index: number | null) => void;
  /** Names the pictures for screen readers, e.g. "Pictures of bhop_forest". */
  label: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closingQuietly = useRef(false);
  const open = index !== null;
  const count = images.length;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    // As in Dialog: a page kept hidden for Back must not leave an open modal making the next page inert.
    return () => {
      if (element.open) {
        closingQuietly.current = true;
        element.close();
      }
    };
  }, [open]);

  const step = (by: number) => {
    if (index !== null && count > 0) onIndex((index + by + count) % count);
  };
  const shown = index === null ? undefined : images[index];

  return (
    <dialog
      ref={dialog}
      aria-label={label}
      onClose={() => {
        if (closingQuietly.current) {
          closingQuietly.current = false;
          return;
        }
        onIndex(null);
      }}
      // Anywhere but the picture and the controls closes it: the empty space around the picture belongs to
      // several layout boxes, so this checks what was clicked rather than which box.
      onClick={(event) => {
        if (!(event.target as Element).closest("img, button")) onIndex(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") step(-1);
        if (event.key === "ArrowRight") step(1);
      }}
      className="text-text open:motion-enter backdrop:bg-bg/90 m-0 h-dvh max-h-none w-dvw max-w-none bg-transparent p-0 backdrop:backdrop-blur-md"
    >
      <div className="flex h-full flex-col items-center justify-center gap-4 p-4">
        <div className="flex w-full items-center justify-between">
          <span className="text-text-muted text-sm tabular-nums">
            {index !== null && count > 1 && `${index + 1} / ${count}`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Close"
            onClick={() => onIndex(null)}
          >
            <X aria-hidden />
          </Button>
        </div>
        <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
          {shown && (
            // The pictures come from storage at their display size; Next's resizer has nothing to add.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={shown.url}
              src={shown.url}
              alt=""
              className="motion-enter max-h-full max-w-full rounded-md object-contain"
            />
          )}
          {count > 1 && (
            <>
              <Button
                variant="secondary"
                size="sm"
                aria-label="Previous picture"
                onClick={() => step(-1)}
                className="absolute left-0"
              >
                <ChevronLeft aria-hidden />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                aria-label="Next picture"
                onClick={() => step(1)}
                className="absolute right-0"
              >
                <ChevronRight aria-hidden />
              </Button>
            </>
          )}
        </div>
        {count > 1 && (
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
            {images.map((image, i) => (
              <button
                key={image.url}
                type="button"
                aria-label={`Picture ${i + 1}`}
                aria-current={i === index ? "true" : undefined}
                onClick={() => onIndex(i)}
                className={classNames(
                  "shrink-0 overflow-hidden rounded-md border-2 transition-opacity duration-(--duration-fast)",
                  i === index
                    ? "border-accent"
                    : "border-transparent opacity-60 hover:opacity-100",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  className="h-12 w-20 object-cover sm:h-16 sm:w-28"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </dialog>
  );
}
