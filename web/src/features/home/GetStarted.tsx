// The home page's way in for a new player: where to play, what to play, and where their times show up.
import {
  Activity,
  ArrowRight,
  Map,
  Server,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/ui/Card";
import { Link } from "@/ui/Link";

const steps: { icon: LucideIcon; title: string; body: string; href: string }[] =
  [
    {
      icon: Server,
      title: "Join a server",
      body: "Runs on listed servers count here.",
      href: "/servers",
    },
    {
      icon: Map,
      title: "Pick a map",
      body: "Leaderboards and record history for each.",
      href: "/maps",
    },
    {
      icon: Activity,
      title: "Follow the times",
      body: "New runs and world records as they land.",
      href: "/activity",
    },
  ];

export function GetStarted() {
  return (
    <section className="flex flex-col gap-6" aria-labelledby="get-started">
      <h2 id="get-started" className="text-3xl font-bold">
        Your times, on one global list
      </h2>
      <ol className="grid gap-4 md:grid-cols-3">
        {steps.map(({ icon: Icon, ...step }) => (
          <li key={step.title} className="motion-reveal">
            <Link href={step.href} className="group block h-full">
              <Card interactive className="flex h-full items-center gap-4">
                <span className="bg-accent-soft text-accent flex size-10 shrink-0 items-center justify-center rounded-md">
                  <Icon aria-hidden className="size-5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-bold">{step.title}</span>
                  <span className="text-text-muted text-sm">{step.body}</span>
                </span>
                <ArrowRight
                  aria-hidden
                  className="text-text-subtle group-hover:text-accent size-4 shrink-0 transition-colors duration-(--duration-fast)"
                />
              </Card>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
