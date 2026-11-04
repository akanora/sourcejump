"use client";
// The map's public description, plain text: edited here, saved with the button, and empty to remove it.
import { type FormEvent, useState } from "react";
import { api } from "@/api/client";
import { Button } from "@/ui/Button";
import { Textarea } from "@/ui/Textarea";
import { useStaffAction } from "../useStaffAction";

const MAX_CHARS = 1000;

export function DescriptionForm({
  map,
  description,
}: {
  map: string;
  description: string | null | undefined;
}) {
  const [text, setText] = useState(description ?? "");
  const action = useStaffAction();
  const changed = text.trim() !== (description ?? "");

  async function save(event: FormEvent) {
    event.preventDefault();
    await action.run(
      () =>
        api.PUT("/v1/staff/maps/{map}/description", {
          params: { path: { map } },
          body: { description: text.trim() || null },
        }),
      "The description couldn't be saved. Try again.",
    );
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <label htmlFor={`description-${map}`} className="sr-only">
        Description
      </label>
      <Textarea
        id={`description-${map}`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={MAX_CHARS}
        placeholder="Who made it, what it's like, anything players should know."
        className="min-h-24"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-text-subtle text-xs tabular-nums">
          {text.length} / {MAX_CHARS}
        </span>
        <Button type="submit" disabled={action.busy || !changed}>
          {action.busy ? "Saving…" : "Save"}
        </Button>
      </div>
      {action.error && <p className="text-danger text-sm">{action.error}</p>}
    </form>
  );
}
