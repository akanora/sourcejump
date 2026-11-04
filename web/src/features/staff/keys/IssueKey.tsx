"use client";
// Issues a key and shows it once: for a new server (asking its name), for a server without one, or in place
// of a server's current key, which stops working in the same step.
import { Check, Copy, Plus, RefreshCw } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { api } from "@/api/client";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { useStaffAction } from "../useStaffAction";

type Issued = { serverName: string; key: string };

/** Without `server`, asks for a new server's name; with it, gives that server a key, replacing `current`. */
export function IssueKey({
  server,
}: {
  server?: { id: number; name: string; current?: string };
}) {
  const [asking, setAsking] = useState(false);
  const [name, setName] = useState("");
  const [issued, setIssued] = useState<Issued | null>(null);
  const action = useStaffAction();
  const formId = useId();
  const replacing = server?.current != null;

  async function issue(event?: FormEvent) {
    event?.preventDefault();
    const body = server ? { server_id: server.id } : { server_name: name };
    const result = await action.run(
      () => api.POST("/v1/staff/keys", { body }),
      "The key couldn't be issued. Try again.",
    );
    if (result && result !== true) {
      setAsking(false);
      setName("");
      setIssued({ serverName: server?.name ?? name.trim(), key: result.key });
    }
  }

  const title = !server
    ? "Key for a new server"
    : replacing
      ? `Replace the key of ${server.name}`
      : `Key for ${server.name}`;
  const confirm = replacing ? "Replace key" : "Issue key";

  return (
    <>
      {!server ? (
        <Button variant="primary" onClick={() => setAsking(true)}>
          <Plus aria-hidden />
          Issue key
        </Button>
      ) : replacing ? (
        <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>
          <RefreshCw aria-hidden />
          Replace
        </Button>
      ) : (
        <Button size="sm" onClick={() => setAsking(true)}>
          <Plus aria-hidden />
          Issue key
        </Button>
      )}
      <Dialog
        open={asking}
        onClose={() => {
          setAsking(false);
          action.clearError();
        }}
        title={title}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={formId}
              disabled={action.busy}
            >
              {action.busy ? "Issuing…" : confirm}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={issue} className="flex flex-col gap-3">
          {!server ? (
            <label className="flex flex-col gap-1.5 text-sm">
              Server name, for telling servers apart here
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={64}
                required
                data-autofocus
              />
            </label>
          ) : (
            <p className="text-text-muted">
              {replacing && (
                <>
                  The current key{" "}
                  <code className="tabular-nums">{server.current}…</code> stops
                  working at once. The runs the server sent stay as they
                  are.{" "}
                </>
              )}
              The new key is shown once, for the server owner to set in the
              plugin.
            </p>
          )}
          {action.error && (
            <p className="text-danger text-sm">{action.error}</p>
          )}
        </form>
      </Dialog>
      {issued && <KeyReveal issued={issued} onDone={() => setIssued(null)} />}
    </>
  );
}

function KeyReveal({ issued, onDone }: { issued: Issued; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.key);
      setCopied(true);
    } catch {
      // Without clipboard access the key is still there to select.
    }
  }

  return (
    <Dialog
      open
      onClose={onDone}
      title={`Key for ${issued.serverName}`}
      footer={
        <>
          <Button onClick={copy}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="primary" onClick={onDone}>
            I&apos;ve saved it
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <code className="border-border-strong bg-bg text-accent rounded-md border p-3 text-sm break-all select-all">
          {issued.key}
        </code>
        <p className="text-text-muted text-sm">
          Copy it now. SourceJump keeps only a hash, so it can&apos;t be shown
          again. The server owner sets it as the plugin&apos;s API key.
        </p>
      </div>
    </Dialog>
  );
}
