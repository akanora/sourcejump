"use client";
// The map's file for the replay viewer and the zone editor, on its Manage view. Staff drop the map's .bsp or
// .bsp.bz2; their browser packs it (`viewerPack.ts`, minutes for a large map) and uploads the result
// (`uploadViewerFile.ts`), which the API checks before storing it.
import { FileUp, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { type Schemas } from "@/api/client";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { classNames } from "@/ui/classNames";
import { uploadViewerFile } from "./uploadViewerFile";
import { packMap } from "./viewerPack";

/** The packer's limit on the map before packing (`viewer_pack::MAX_MAP_BYTES`); it checks the site's limits on
 * the result itself. */
const MAX_MAP_BYTES = 1024 * 1024 * 1024;

type Work =
  | { step: "packing"; name: string; fraction: number; stop: AbortController }
  | { step: "uploading"; name: string }
  | null;

export function ViewerFileCard({
  map,
  viewerFile,
}: {
  map: string;
  viewerFile: Schemas["ViewerFile"] | null | undefined;
}) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [work, setWork] = useState<Work>(null);
  const [dragging, setDragging] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  async function take(file: File) {
    setOutcome(null);
    const problem = checkFile(file, map);
    if (problem) {
      setOutcome({ ok: false, text: problem });
      return;
    }
    const stop = new AbortController();
    setWork({ step: "packing", name: file.name, fraction: 0, stop });
    const started = performance.now();
    let packed;
    try {
      packed = await packMap(
        file,
        (fraction) =>
          setWork((work) =>
            work?.step === "packing" ? { ...work, fraction } : work,
          ),
        stop.signal,
      );
    } catch (error) {
      setWork(null);
      if (!stop.signal.aborted) {
        setOutcome({
          ok: false,
          text: `${file.name} couldn't be packed: ${(error as Error).message}`,
        });
      }
      return;
    }
    const seconds = Math.round((performance.now() - started) / 1000);
    setWork({ step: "uploading", name: file.name });
    const result = await uploadViewerFile(map, packed.file);
    setWork(null);
    if (!result.ok) {
      setOutcome({ ok: false, text: result.message });
      return;
    }
    setOutcome({
      ok: true,
      text: `Packed ${megabytes(packed.sourceBytes)} to ${megabytes(packed.file.byteLength)} in ${seconds} s, and stored.`,
    });
    router.refresh();
  }

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void take(file);
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !work) void take(file);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        {viewerFile ? (
          <>
            <Badge tone="success">Stored</Badge>
            <span className="text-text-muted tabular-nums">
              {megabytes(viewerFile.bytes)} for visitors to download
            </span>
          </>
        ) : (
          <>
            <Badge tone="warning">None yet</Badge>
            <span className="text-text-muted">
              Replays on this map can&apos;t be watched, and its zones
              can&apos;t be drawn in 3D.
            </span>
          </>
        )}
      </p>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!work) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        className={classNames(
          "flex min-h-28 flex-col items-center justify-center gap-3 rounded-md border border-dashed p-4 text-center text-sm transition-colors duration-(--duration-fast)",
          dragging ? "border-accent bg-accent-soft" : "border-border-strong",
        )}
      >
        {work === null ? (
          <>
            <span className="text-text-muted">
              Drop {map}.bsp or {map}.bsp.bz2 here, from the game&apos;s{" "}
              <code>cstrike/maps</code> or <code>cstrike/download/maps</code>{" "}
              folder.
            </span>
            <Button size="sm" onClick={() => input.current?.click()}>
              <FileUp aria-hidden />
              {viewerFile ? "Replace from a file" : "Choose a file"}
            </Button>
          </>
        ) : (
          <div className="motion-enter flex w-full max-w-md flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate">
                {work.step === "packing"
                  ? `Packing ${work.name}…`
                  : `Uploading ${work.name}…`}
              </span>
              {work.step === "packing" && (
                <span className="flex items-center gap-2">
                  <span className="text-text-muted tabular-nums">
                    {Math.floor(work.fraction * 100)}%
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Stop packing"
                    title="Stop"
                    onClick={() => work.stop.abort()}
                    className="px-1.5"
                  >
                    <Square aria-hidden />
                  </Button>
                </span>
              )}
            </div>
            <div
              role="progressbar"
              aria-label="Packing the map"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={
                work.step === "packing" ? Math.floor(work.fraction * 100) : 100
              }
              className="bg-surface-raised h-1.5 overflow-hidden rounded-full"
            >
              <div
                className="bg-accent h-full origin-left rounded-full transition-transform duration-(--duration-fast)"
                style={{
                  transform: `scaleX(${work.step === "packing" ? work.fraction : 1})`,
                }}
              />
            </div>
            {work.step === "packing" && (
              <span className="text-text-subtle text-xs">
                Large maps take a few minutes. Keep this tab open.
              </span>
            )}
          </div>
        )}
        <input
          ref={input}
          type="file"
          accept=".bsp,.bz2"
          onChange={choose}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose the map file"
        />
      </div>

      {outcome && (
        <p
          className={classNames(
            "motion-enter text-sm",
            outcome.ok ? "text-success" : "text-danger",
          )}
        >
          {outcome.text}
        </p>
      )}
    </div>
  );
}

/** Why the file can't be this map's, or null. Its name must be the map's, as the game requires. */
function checkFile(file: File, map: string): string | null {
  const name = file.name.toLowerCase();
  const base = name.replace(/\.bsp(\.bz2)?$/, "");
  if (base === name) return `${file.name} isn't a .bsp or .bsp.bz2 file.`;
  if (base !== map.toLowerCase()) {
    return `${file.name} is another map's file; this page is ${map}.`;
  }
  if (file.size > MAX_MAP_BYTES) return `${file.name} is over 1 GB.`;
  return null;
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
