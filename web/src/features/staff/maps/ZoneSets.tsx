"use client";
// A map's zone sets: any version drawn against the one before it, and publishing a new set from a shavit file
// or from the 3D editor.
import { Box, Upload } from "lucide-react";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { api, type Schemas } from "@/api/client";
import { formatDate } from "@/features/runs/time";
import { Button, ButtonLink } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { Segmented } from "@/ui/Segmented";
import { Textarea } from "@/ui/Textarea";
import { useStaffAction } from "../useStaffAction";
import { ZonePlan } from "./ZonePlan";
import { parseZones, zoneChanges } from "./zones";

type Version = Schemas["ZoneSetVersion"];

export function ZoneSets({
  map,
  versions,
}: {
  map: string;
  /** Newest first. */
  versions: Version[];
}) {
  // Null follows the newest version, so a set just published shows at once; picking one pins it.
  const [picked, setPicked] = useState<number | null>(null);
  const shown = picked ?? versions[0]?.version ?? 0;
  const [drafting, setDrafting] = useState(versions.length === 0);
  const index = versions.findIndex((v) => v.version === shown);
  const version = versions[index];

  return (
    <div className="flex flex-col gap-4">
      {versions.length > 0 && !drafting && version && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label="Zone set version"
              value={String(shown)}
              onChange={(value) => setPicked(Number(value))}
              options={versions.slice(0, 8).map((v, i) => ({
                value: String(v.version),
                label: i === 0 ? `v${v.version} · in force` : `v${v.version}`,
              }))}
            />
            <div className="flex gap-2">
              <EditIn3d map={map} />
              <Button onClick={() => setDrafting(true)}>
                <Upload aria-hidden />
                From a file
              </Button>
            </div>
          </div>
          <p className="text-text-muted text-sm">
            Published {formatDate(version.published_at)}
            {version.published_by ? ` by ${version.published_by.name}` : ""}
            {version.note && <> · {version.note}</>}
          </p>
          <ZonePlan
            zones={version.zones}
            previous={versions[index + 1]?.zones}
          />
          {versions[index + 1] && (
            <ChangeList
              changes={zoneChanges(
                versions[index + 1]?.zones ?? [],
                version.zones,
              )}
            />
          )}
        </>
      )}
      {drafting && versions.length === 0 && <EditIn3d map={map} />}
      {drafting && (
        <ZoneDraft
          map={map}
          base={versions[0] ?? null}
          onCancel={versions.length > 0 ? () => setDrafting(false) : undefined}
        />
      )}
    </div>
  );
}

function EditIn3d({ map }: { map: string }) {
  return (
    <ButtonLink
      href={`/maps/${encodeURIComponent(map)}/manage/zones`}
      className="self-start"
    >
      <Box aria-hidden />
      Edit in 3D
    </ButtonLink>
  );
}

function ChangeList({ changes }: { changes: string[] }) {
  if (changes.length === 0) return null;
  return (
    <ul className="text-text-muted flex list-disc flex-col gap-0.5 pl-5 text-sm">
      {/* Two zones of one type on one track read the same, so the list is keyed by place. */}
      {changes.map((change, index) => (
        <li key={index}>{change}</li>
      ))}
    </ul>
  );
}

function ZoneDraft({
  map,
  base,
  onCancel,
}: {
  map: string;
  base: Version | null;
  onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const action = useStaffAction();
  const parsed = text.trim() ? parseZones(text) : null;
  const zones = Array.isArray(parsed) ? parsed : null;

  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) setText(await file.text());
  }

  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!zones) return;
    const done = await action.run(
      () =>
        api.POST("/v1/staff/maps/{map}/zones", {
          params: { path: { map } },
          body: { based_on: base?.version ?? null, zones, note },
        }),
      "The zones couldn't be published. Try again.",
    );
    if (done) {
      setText("");
      setNote("");
      onCancel?.();
    }
  }

  return (
    <form onSubmit={publish} className="flex flex-col gap-3">
      <p className="text-text-muted text-sm">
        Paste a shavit zones file (the JSON shavit-zones-json reads), or choose
        the file. It replaces every zone on the map.
      </p>
      <label className="text-sm">
        <span className="sr-only">Zones file</span>
        <input
          type="file"
          accept=".json,application/json"
          onChange={loadFile}
          className="text-text-muted file:border-border file:bg-surface file:text-text text-sm file:mr-3 file:rounded-md file:border file:px-3 file:py-1.5"
        />
      </label>
      <Textarea
        aria-label="Zones file contents"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='[{ "type": "start", "track": 0, "id": 1, "point_a": [...], "point_b": [...] }, …]'
        className="font-mono text-xs"
      />
      {typeof parsed === "string" && (
        <p className="text-warning text-sm">{parsed}</p>
      )}
      {zones && (
        <>
          <ZonePlan zones={zones} previous={base?.zones} />
          <ChangeList
            changes={base ? zoneChanges(base.zones, zones) : ["First zone set"]}
          />
          <div className="flex flex-wrap items-end gap-2">
            <label htmlFor={`zones-note-${map}`} className="sr-only">
              What changed and why
            </label>
            <Input
              id={`zones-note-${map}`}
              placeholder="What changed and why, for the staff log"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              required
              className="min-w-64 flex-1"
            />
            <Button variant="primary" type="submit" disabled={action.busy}>
              {action.busy
                ? "Publishing…"
                : `Publish version ${(base?.version ?? 0) + 1}`}
            </Button>
          </div>
        </>
      )}
      {action.error && <p className="text-danger text-sm">{action.error}</p>}
      {onCancel && (
        <Button variant="ghost" className="self-start" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </form>
  );
}
