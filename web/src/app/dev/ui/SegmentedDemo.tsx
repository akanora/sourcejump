"use client";
// Segmented with its own state, since a choice in place needs a client component.
import { useState } from "react";
import { Segmented } from "@/ui/Segmented";

export function SegmentedDemo() {
  const [track, setTrack] = useState("0");
  return (
    <Segmented
      label="Example tracks"
      className="self-start"
      options={[
        { value: "0", label: "Main" },
        { value: "1", label: "Bonus 1" },
        { value: "2", label: "Bonus 2" },
      ]}
      value={track}
      onChange={setTrack}
    />
  );
}
