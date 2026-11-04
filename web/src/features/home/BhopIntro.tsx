// The home page's introduction to bunnyhopping: the demo, and the three things a player does in a line each.
import type { ReactNode } from "react";
import { BhopDemo } from "./BhopDemo";

const steps: { title: string; body: string; keys: ReactNode }[] = [
  {
    title: "Jump as you land",
    body: "Same tick, no friction, no speed lost.",
    keys: <Key>Jump</Key>,
  },
  {
    title: "Strafe in the air",
    body: "Turn the mouse the way of the key you hold.",
    keys: (
      <>
        <Key>A</Key>
        <Key>D</Key>
      </>
    ),
  },
  {
    title: "Chain the hops",
    body: "Each hop starts with the last one's speed.",
    keys: <Key>u/s</Key>,
  },
];

export function BhopIntro() {
  return (
    <section className="flex flex-col gap-6" aria-labelledby="bhop-intro">
      <h2 id="bhop-intro" className="text-3xl font-bold">
        Speed from jumping and strafing
      </h2>
      <BhopDemo />
      <ol className="grid gap-4 sm:grid-cols-3">
        {steps.map((step) => (
          <li key={step.title} className="motion-reveal flex gap-3">
            <span className="flex shrink-0 gap-1">{step.keys}</span>
            <span className="flex flex-col">
              <span className="font-bold">{step.title}</span>
              <span className="text-text-muted text-sm">{step.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <span className="border-border bg-surface text-accent flex h-7 min-w-7 items-center justify-center rounded-sm border px-1.5 text-xs font-bold uppercase">
      {children}
    </span>
  );
}
