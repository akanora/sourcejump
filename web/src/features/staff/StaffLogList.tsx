// The staff log, newest first, a page at a time, with links to newer and older pages. A menu picks one kind
// of action, and a search box narrows it to one player, map, run, key or server.
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import Form from "next/form";
import type { ReactNode } from "react";
import { Button, ButtonLink } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ChoiceBar } from "@/ui/ChoiceBar";
import { ChoiceMenu } from "@/ui/ChoiceMenu";
import { DividedList } from "@/ui/Divided";
import { Input } from "@/ui/Input";
import { LogEntry } from "./LogEntry";
import { ReadFailure } from "./ReadFailure";
import { type LogKind as Kind, type LogPage, readStaffLog } from "./staffLog";

const kinds: { value: Kind | "all"; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "players", label: "Players and bans" },
  { value: "runs", label: "Runs" },
  { value: "servers", label: "Servers and keys" },
  { value: "maps", label: "Maps" },
  { value: "rules", label: "Rules" },
  { value: "posts", label: "Posts and comments" },
];

/** Reads the kind from the address; anything else is everything. */
export function logKind(value: string | undefined): Kind | undefined {
  return kinds.find((kind) => kind.value === value && value !== "all")
    ?.value as Kind | undefined;
}

export async function StaffLogList({ page }: { page: LogPage }) {
  const result = await readStaffLog(page);
  const about = page.about?.trim() ?? "";
  // Paging and the kind menu keep the other filter.
  const href = (choice: {
    kind?: Kind | "all";
    before?: string;
    after?: string;
  }) => {
    const query = new URLSearchParams();
    const kind = choice.kind ?? page.kind;
    if (kind && kind !== "all") query.set("kind", kind);
    if (about) query.set("about", about);
    if (choice.before) query.set("before", choice.before);
    if (choice.after) query.set("after", choice.after);
    const text = query.toString();
    return text ? `/staff?${text}` : "/staff";
  };
  const filters = (
    <ChoiceBar>
      <ChoiceMenu
        label="Show"
        options={kinds.map((kind) => ({
          ...kind,
          href: href({ kind: kind.value }),
        }))}
        value={page.kind ?? "all"}
      />
      <Form
        action="/staff"
        prefetch={false}
        className="flex min-w-0 flex-1 gap-2 sm:max-w-md"
      >
        {page.kind && <input type="hidden" name="kind" value={page.kind} />}
        <Input
          icon={Search}
          type="search"
          name="about"
          defaultValue={about}
          placeholder="SteamID, map, run, key or server"
          aria-label="Find entries about"
          className="flex-1"
        />
        <Button type="submit">Find</Button>
      </Form>
    </ChoiceBar>
  );
  if (!("data" in result)) {
    return (
      <div className="flex flex-col gap-4">
        {filters}
        <ReadFailure failure={result} />
      </div>
    );
  }
  const log = result.data;
  const filtered = Boolean(page.kind || about);
  return (
    <div className="flex flex-col gap-4">
      {filters}
      <Card className="py-2">
        {log.entries.length === 0 ? (
          <p className="text-text-muted py-3">
            {filtered ? "No entries match." : "No staff actions yet."}
          </p>
        ) : (
          <DividedList>
            {log.entries.map((entry) => (
              <LogEntry key={entry.id} entry={entry} />
            ))}
          </DividedList>
        )}
      </Card>
      {(log.newer || log.older) && (
        <nav aria-label="Pages" className="flex justify-between gap-4">
          <PageLink href={log.newer && href({ after: log.newer })}>
            <ChevronLeft aria-hidden />
            Newer
          </PageLink>
          <PageLink href={log.older && href({ before: log.older })}>
            Older
            <ChevronRight aria-hidden />
          </PageLink>
        </nav>
      )}
    </div>
  );
}

/** Both directions stay in place, dimmed at either end, so the buttons don't jump between pages. */
function PageLink({
  href,
  children,
}: {
  href: string | null | undefined;
  children: ReactNode;
}) {
  return href ? (
    <ButtonLink href={href} size="sm">
      {children}
    </ButtonLink>
  ) : (
    <Button size="sm" disabled>
      {children}
    </Button>
  );
}
