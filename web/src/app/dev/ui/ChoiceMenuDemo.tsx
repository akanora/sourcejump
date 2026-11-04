"use client";
// ChoiceMenu with its own state, since a choice in place needs a client component.
import { useState } from "react";
import { ChoiceMenu } from "@/ui/ChoiceMenu";

export function ChoiceMenuDemo() {
  const [style, setStyle] = useState("normal");
  const [track, setTrack] = useState("0");
  return (
    <div className="flex flex-wrap gap-2">
      <ChoiceMenu
        label="Style"
        options={[
          { value: "normal", label: "Normal" },
          { value: "sw", label: "Sideways" },
          { value: "bw", label: "Backwards", quiet: true },
        ]}
        value={style}
        onChange={setStyle}
      />
      <ChoiceMenu
        label="Track"
        options={[
          { value: "0", label: "Main" },
          { value: "1", label: "Bonus 1" },
        ]}
        value={track}
        onChange={setTrack}
      />
    </div>
  );
}
