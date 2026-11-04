// The ranked styles' display names and order, from the current ruleset.
import { cache } from "react";
import { api } from "@/api/client";

export interface Styles {
  /** Style keys in the ruleset's order. */
  keys: string[];
  /** The style's name, or its key for a style the current ruleset no longer ranks. */
  name: (key: string) => string;
}

/** Fetched once per request, however many components ask. Without a ruleset, keys stand in for names. */
export const currentStyles = cache(async (): Promise<Styles> => {
  const result = await api.GET("/v1/ruleset").catch(() => undefined);
  const styles = result?.data?.styles ?? [];
  const names = new Map(styles.map((style) => [style.key, style.name]));
  return {
    keys: styles.map((style) => style.key),
    name: (key) => names.get(key) ?? key,
  };
});
