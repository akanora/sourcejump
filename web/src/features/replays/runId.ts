// A run picked by what a viewer types or pastes: its number, or its page's link.

/** The run ID in what was typed or pasted: "1651", "#1651", or a run page's link. Null when there's none. */
export function parseRunId(text: string): number | null {
  const match = /(?:^#?|\/runs\/)(\d+)(?:[/?#].*)?$/.exec(text.trim());
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
