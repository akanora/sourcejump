// A short status label: WR, style names, server status.
import type { ComponentProps } from "react";
import { classNames } from "./classNames";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const tones: Record<Tone, string> = {
  neutral: "border-border-strong text-text-muted",
  accent: "border-accent/60 bg-accent-soft text-accent",
  success: "border-success/60 bg-success-soft text-success",
  warning: "border-warning/60 bg-warning-soft text-warning",
  danger: "border-danger/60 bg-danger-soft text-danger",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: { tone?: Tone } & ComponentProps<"span">) {
  return (
    <span
      className={classNames(
        "inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-xs font-bold tracking-wide whitespace-nowrap uppercase",
        "[&_svg]:size-3",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
