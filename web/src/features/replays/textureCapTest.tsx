// Test only: `?texcap=full|1024|512` draws the viewer's textures with a size limit and T cycles it live, so a limit
// can be judged by eye before any map file is made smaller (docs/plans/viewer-texture-study.md).
import { type KeyboardEvent, useEffect, useState } from "react";

const CAPS = [null, 1024, 512] as const;
type TextureCap = (typeof CAPS)[number];

/** Undefined without `?texcap=`, which leaves the viewer as it always is. */
function capFromAddress(): TextureCap | undefined {
  if (typeof window === "undefined") return undefined;
  const asked = new URLSearchParams(window.location.search).get("texcap");
  if (asked === null) return undefined;
  return CAPS.find((cap) => String(cap ?? "full") === asked) ?? null;
}

/** Applies the cap to a viewer and answers T; does nothing without `?texcap=`. */
export function useTextureCapTest(
  session: { setTextureCap(cap: number | null): void } | null,
) {
  // Read once on the client; the label only shows with a session, which the server never has.
  const [cap, setCap] = useState(capFromAddress);
  useEffect(() => {
    if (session && cap !== undefined) session.setTextureCap(cap);
  }, [session, cap]);

  /** True when the key was the switch's. */
  const onKey = (event: KeyboardEvent): boolean => {
    if (cap === undefined || event.key.toLowerCase() !== "t") return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    setCap(CAPS[(CAPS.indexOf(cap) + 1) % CAPS.length]);
    return true;
  };
  const label =
    session && cap !== undefined ? <TextureCapLabel cap={cap} /> : null;
  return { onKey, label };
}

function TextureCapLabel({ cap }: { cap: TextureCap }) {
  return (
    <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2">
      <span className="bg-bg/80 text-text-muted rounded-sm px-1.5 py-0.5 text-xs">
        Textures: {cap === null ? "full detail" : `up to ${cap} px`} · T to
        switch (test)
      </span>
    </div>
  );
}
