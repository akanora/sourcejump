// The link out of a video post. Videos stay on YouTube; nothing is embedded (lead, 2026-10-20).
import { ExternalLink, Play } from "lucide-react";
import { buttonClasses } from "@/ui/Button";

export function WatchOnYouTube({
  href,
  size = "md",
}: {
  href: string;
  size?: "sm" | "md";
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClasses({ variant: "primary", size })}
    >
      <Play aria-hidden />
      Watch on YouTube
      <ExternalLink aria-hidden />
    </a>
  );
}
