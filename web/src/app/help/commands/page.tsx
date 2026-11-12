// Commands page: every command the timer and the SourceJump plugin add on a connected server, by plugin.
import type { Metadata } from "next";
import { CommandsBrowser, Code } from "@/features/help/CommandsBrowser";
import { adminFlags } from "@/features/help/commands";
import { PageView } from "@/ui/Page";

export const metadata: Metadata = {
  title: "Commands",
  description:
    "Every command on a SourceJump server, by plugin: other names, who can use it and what it does.",
};

export default function CommandsPage() {
  return (
    <PageView>
      <h1 className="text-3xl font-bold">Commands</h1>
      <div className="flex max-w-3xl flex-col gap-3 leading-relaxed">
        <p>
          Every command in SourceJump&apos;s server release: shavit&apos;s timer
          and the SourceJump plugin. A server can turn some off or add its own.
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-6">
          <li>
            Type a command in chat as <Code>!name</Code> or <Code>/name</Code> (
            <Code>/</Code> hides it from chat), or in the console as{" "}
            <Code>sm_name</Code>. Uppercase works too: <Code>!R</Code> is the
            same as <Code>!r</Code>.
          </li>
          <li>Aliases are other names for the same command.</li>
          <li>
            <strong>Who</strong> can use it: everyone, players an admin has
            given access to, or an admin with a SourceMod flag, shown as{" "}
            &ldquo;Admin (m)&rdquo;. The flags:{" "}
            {Object.entries(adminFlags).map(([flag, name], index, all) => (
              <span key={flag} className="whitespace-nowrap">
                <Code>{flag}</Code> {name}
                {index < all.length - 1 ? ", " : "."}
              </span>
            ))}
          </li>
        </ul>
      </div>
      <CommandsBrowser />
    </PageView>
  );
}
