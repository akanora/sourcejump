"use client";
// Style guide demo: replays each named motion on demand.
import { RotateCcw } from "lucide-react";
import { type CSSProperties, type ReactNode, useState } from "react";
import { Button } from "@/ui/Button";
import { Card, Label } from "@/ui/Card";
import { CountUp } from "@/ui/CountUp";

export function MotionDemo() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Replay name="motion-enter">
        {(key) => (
          <div className="flex gap-2">
            {[0, 1, 2].map((index) => (
              <div
                key={`${key}-${index}`}
                style={{ "--motion-delay": `${index * 80}ms` } as CSSProperties}
                className="bg-surface-overlay motion-enter h-10 flex-1 rounded-md"
              />
            ))}
          </div>
        )}
      </Replay>
      <Card interactive>
        <Label>motion-lift</Label>
        <p className="text-text-muted mt-2 text-sm">Hover this card.</p>
      </Card>
      <Replay name="motion-rank-change">
        {(key) => (
          <div
            key={key}
            className="motion-rank-change rounded-md px-3 py-2 text-sm"
          >
            Moved from 5th to 2nd
          </div>
        )}
      </Replay>
      <Replay name="motion-wr-highlight">
        {(key) => (
          <div
            key={key}
            className="border-border motion-wr-highlight rounded-md border px-3 py-2 text-sm"
          >
            New world record
          </div>
        )}
      </Replay>
      <Replay name="CountUp">
        {(key) => (
          <p className="text-3xl font-bold">
            <CountUp key={key} value={24892} />
          </p>
        )}
      </Replay>
    </div>
  );
}

function Replay({
  name,
  children,
}: {
  name: string;
  children: (key: number) => ReactNode;
}) {
  const [key, setKey] = useState(0);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label>{name}</Label>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Replay ${name}`}
          onClick={() => setKey(key + 1)}
        >
          <RotateCcw aria-hidden />
        </Button>
      </div>
      {children(key)}
    </Card>
  );
}
