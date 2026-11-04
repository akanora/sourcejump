// Typed client for the SourceJump API. Its types come from `schema.ts`, generated from api/openapi.json by `just openapi`.
import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

// On the server, the API's own address: in production both run on the same machine, so this stays on loopback.
// In the browser, the site's origin, which passes /v1/* to the API (Caddy in production, a rewrite in
// development).
const baseUrl =
  typeof window === "undefined"
    ? (process.env.SJ_API_URL ?? "http://127.0.0.1:8080")
    : window.location.origin;

export const api = createClient<paths>({ baseUrl });

export type Schemas = components["schemas"];

/**
 * What to tell a person when a request failed: the API's message when it sent one, else `fallback`. The API
 * writes messages lowercase, to read inside a sentence; shown on their own, they're capitalized.
 */
export function failureMessage(
  error: { error: string } | undefined,
  fallback: string,
): string {
  const message = error?.error;
  return message
    ? message.charAt(0).toUpperCase() + message.slice(1)
    : fallback;
}
