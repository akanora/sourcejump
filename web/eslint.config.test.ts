// Project lint rules: no raw colors or arbitrary Tailwind values outside src/ui/, and links go through @/ui/Link.
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: import.meta.dirname });

async function errorsFrom(rule: string, code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === rule)
    .map((message) => message.message);
}

const rawValueErrors = (code: string, filePath: string) =>
  errorsFrom("no-restricted-syntax", code, filePath);

const page = "src/app/example/page.tsx";

describe("raw value lint rule", () => {
  it("fails on a raw hex color in a page", async () => {
    const errors = await rawValueErrors(
      `export const style = { color: "#ff0000" };`,
      page,
    );
    expect(errors).toEqual([expect.stringContaining("Raw hex color")]);
  });

  it("fails on color functions and arbitrary Tailwind values", async () => {
    const errors = await rawValueErrors(
      [
        `export const a = "rgb(0 0 0 / 0.5)";`,
        "export const b = `p-4 w-[13px]`;",
        `export const c = "hover:bg-[#fff]";`,
        `export const d = "[color:red]";`,
      ].join("\n"),
      page,
    );
    expect(errors).toHaveLength(4);
  });

  it("allows tokens, arbitrary variants and anchors", async () => {
    const errors = await rawValueErrors(
      [
        `export const a = "bg-surface text-accent rounded-lg p-4";`,
        `export const b = "aria-[current=page]:text-accent";`,
        `export const c = "#records";`,
      ].join("\n"),
      page,
    );
    expect(errors).toEqual([]);
  });

  it("allows raw values inside src/ui/", async () => {
    const errors = await rawValueErrors(
      `export const a = "w-[min(100%-2rem,36rem)]";`,
      "src/ui/Example.tsx",
    );
    expect(errors).toEqual([]);
  });
});

describe("next/link import rule", () => {
  const code = `import NextLink from "next/link";\nexport { NextLink };`;

  it("fails outside the Link primitive", async () => {
    expect(await errorsFrom("no-restricted-imports", code, page)).toEqual([
      expect.stringContaining("@/ui/Link"),
    ]);
  });

  it("allows the Link primitive itself", async () => {
    expect(
      await errorsFrom("no-restricted-imports", code, "src/ui/Link.tsx"),
    ).toEqual([]);
  });
});
