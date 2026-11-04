"use client";
// A server's address with a button to copy it, for pasting into the game's console.
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function ServerAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`connect ${address}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Without clipboard access (an insecure context or a refusal) the address is still there to select.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy "connect ${address}"`}
      className="text-text-muted hover:text-text inline-flex items-center gap-1.5 text-sm tabular-nums transition-colors duration-(--duration-fast)"
    >
      {address}
      {copied ? (
        <Check aria-hidden className="text-success size-3.5" />
      ) : (
        <Copy aria-hidden className="size-3.5" />
      )}
    </button>
  );
}
