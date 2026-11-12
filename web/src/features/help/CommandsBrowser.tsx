"use client";
// The Commands page's list: a search over command names and aliases, then each plugin's commands, as a table on wide
// screens and as rows in a card on a phone, where four columns of text won't fit.
import { Search } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import { Card } from "@/ui/Card";
import { DividedList } from "@/ui/Divided";
import { Input } from "@/ui/Input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/ui/Table";
import {
  type Command,
  type CommandGroup,
  commandGroups,
  commandMatches,
  defaultStyleCommands,
  styleMatches,
  type Text,
  whoLabel,
} from "./commands";

/** The table on screens wide enough for its columns; the card below that. */
const wideOnly = "hidden md:block";
const narrowOnly = "md:hidden";

export function CommandsBrowser() {
  const [query, setQuery] = useState("");
  const groups = commandGroups
    .map((group) => ({
      ...group,
      commands: group.commands.filter((command) =>
        commandMatches(command, query),
      ),
    }))
    .filter((group) => group.commands.length > 0);
  const styles = defaultStyleCommands.filter((style) =>
    styleMatches(style, query),
  );
  const searching = query.trim() !== "";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Input
          icon={Search}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search commands and aliases"
          aria-label="Search commands and aliases"
          className="sm:max-w-sm"
        />
        {/* The sections to jump to; while searching, the list itself is short, and some sections are gone. */}
        {!searching && (
          <nav aria-label="Plugins">
            <ul className="text-text-muted flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {commandGroups.map(({ id, title }) => (
                <li key={id}>
                  <a href={`#${id}`} className="hover:text-accent">
                    {title}
                  </a>
                </li>
              ))}
              <li>
                <a href="#styles" className="hover:text-accent">
                  Styles
                </a>
              </li>
            </ul>
          </nav>
        )}
      </div>

      {groups.map((group) => (
        <GroupSection key={group.id} group={group} />
      ))}
      {styles.length > 0 && <StylesSection styles={styles} />}

      {groups.length === 0 && styles.length === 0 && (
        <p className="text-text-muted" role="status">
          No command or alias contains “{query.trim()}”.
        </p>
      )}
    </div>
  );
}

function GroupSection({ group }: { group: CommandGroup }) {
  const hasBinds = group.commands.some((command) => command.binds);
  return (
    <Section
      id={group.id}
      title={group.title}
      plugins={group.plugins}
      intro={group.intro}
      notes={group.notes}
    >
      <Table aria-labelledby={`${group.id}-title`} className={wideOnly}>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Command</TableHeaderCell>
            <TableHeaderCell>Aliases</TableHeaderCell>
            {hasBinds && <TableHeaderCell>Bind</TableHeaderCell>}
            <TableHeaderCell>Who</TableHeaderCell>
            <TableHeaderCell>What it does</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {group.commands.map((command) => (
            <TableRow key={command.name}>
              <TableCell wrap className="align-top">
                <CommandName command={command} />
              </TableCell>
              <TableCell wrap className="min-w-32 align-top">
                <CodeList names={command.aliases} />
              </TableCell>
              {hasBinds && (
                <TableCell className="align-top">
                  <CodeList names={command.binds} />
                </TableCell>
              )}
              <TableCell className="text-text-muted align-top">
                {whoLabel(command.who)}
              </TableCell>
              <TableCell wrap className="align-top">
                <RichText text={command.description} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Card className={narrowOnly}>
        <DividedList className="-my-2">
          {group.commands.map((command) => (
            <li key={command.name} className="flex flex-col gap-1 py-3">
              <div className="flex items-start justify-between gap-3">
                <CommandName command={command} />
                <span className="text-text-muted shrink-0 text-xs">
                  {whoLabel(command.who)}
                </span>
              </div>
              {command.aliases && (
                <p className="text-text-muted text-sm">
                  Also <CodeList names={command.aliases} />
                </p>
              )}
              {command.binds && (
                <p className="text-text-muted text-sm">
                  Bind <CodeList names={command.binds} />
                </p>
              )}
              <p className="text-sm">
                <RichText text={command.description} />
              </p>
            </li>
          ))}
        </DividedList>
      </Card>
    </Section>
  );
}

function StylesSection({
  styles,
}: {
  styles: readonly (typeof defaultStyleCommands)[number][];
}) {
  return (
    <Section
      id="styles"
      title="Styles"
      plugins={["shavit-core"]}
      intro={[
        "Each style a server sets up in its ",
        { code: "shavit-styles.cfg" },
        " adds its own commands to switch to it, and leaderboard commands such as ",
        { code: "!wr<style>" },
        " (see Records). These are the defaults; a server's styles and their commands can differ.",
      ]}
      notes={[
        [
          "Segmented's ",
          { code: "!sr" },
          " has the same name as the Records command ",
          { code: "!sr" },
          " (server record), so both are registered under one name.",
        ],
      ]}
    >
      <Table aria-labelledby="styles-title" className={wideOnly}>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Style</TableHeaderCell>
            <TableHeaderCell>Commands</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {styles.map(({ style, commands }) => (
            <TableRow key={style}>
              <TableCell>{style}</TableCell>
              <TableCell wrap>
                <CodeList names={commands} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Card className={narrowOnly}>
        <DividedList className="-my-2">
          {styles.map(({ style, commands }) => (
            <li key={style} className="flex flex-col gap-1 py-3">
              <span className="font-bold">{style}</span>
              <p className="text-sm">
                <CodeList names={commands} />
              </p>
            </li>
          ))}
        </DividedList>
      </Card>
    </Section>
  );
}

function Section({
  id,
  title,
  plugins,
  intro,
  notes,
  children,
}: {
  id: string;
  title: string;
  plugins: readonly string[];
  intro?: Text;
  notes?: readonly Text[];
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-20 flex-col gap-3"
    >
      <h2 id={`${id}-title`} className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-xl font-bold">{title}</span>
        <span className="text-text-subtle text-sm">{plugins.join(", ")}</span>
      </h2>
      {intro && (
        <p className="text-text-muted text-sm">
          <RichText text={intro} />
        </p>
      )}
      {children}
      {notes?.map((note, index) => (
        <p key={index} className="text-text-muted text-sm">
          <RichText text={note} />
        </p>
      ))}
    </section>
  );
}

function CommandName({ command }: { command: Command }) {
  return (
    <span className="font-bold">
      <Code>{command.name}</Code>
      {command.args && (
        <span className="text-text-muted font-normal"> {command.args}</span>
      )}
    </span>
  );
}

/** Names separated by commas. The line may break after a comma, never inside a name. */
function CodeList({ names }: { names?: readonly string[] }) {
  if (!names?.length) return null;
  return names.map((name, index) => (
    <Fragment key={name}>
      <Code>{name}</Code>
      {index < names.length - 1 && ", "}
    </Fragment>
  ));
}

function RichText({ text }: { text: Text }) {
  if (typeof text === "string") return text;
  return text.map((part, index) =>
    typeof part === "string" ? part : <Code key={index}>{part.code}</Code>,
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="bg-surface-raised rounded-sm px-1 text-sm whitespace-nowrap">
      {children}
    </code>
  );
}
