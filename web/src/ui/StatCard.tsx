// A headline number with a label, e.g. the world record count on the home page.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, Label } from "./Card";
import { CountUp } from "./CountUp";

interface Props {
  label: string;
  /** Null shows a dash: a number that doesn't exist yet, e.g. a rank before points are decided. */
  value: number | null;
  format?: Intl.NumberFormatOptions;
  icon?: LucideIcon;
  /** A short note beside the number, e.g. "of 11". Kept on the number's line so cards in a row stay one height. */
  detail?: ReactNode;
  className?: string;
}

export function StatCard({
  label,
  value,
  format,
  icon: Icon,
  detail,
  className,
}: Props) {
  return (
    <Card className={className}>
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {Icon && <Icon aria-hidden className="text-text-subtle size-4" />}
      </div>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="text-3xl font-bold">
          {value === null ? "—" : <CountUp value={value} format={format} />}
        </span>
        {detail && <span className="text-text-muted text-sm">{detail}</span>}
      </p>
    </Card>
  );
}
