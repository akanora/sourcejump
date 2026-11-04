"use client";
// Style guide demo: opens a Dialog, since a controlled dialog needs client state.
import { useState } from "react";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";

export function DialogDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="bhop_forest · Normal"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button variant="primary">Download replay</Button>
          </>
        }
      >
        <p className="text-text-muted">
          Run details go here: time, strafes, sync, jumps, server and date.
          Escape, the close button or a click on the backdrop closes it.
        </p>
      </Dialog>
    </>
  );
}
