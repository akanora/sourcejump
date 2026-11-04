// A player's public profile, read once per request however many parts of the page show it (header and body).
import { cache } from "react";
import { api } from "@/api/client";

/** Undefined when the API can't be reached; otherwise the response, so callers can tell a 404. */
export const getPlayer = cache((steamid: string) =>
  api
    .GET("/v1/players/{player}", { params: { path: { player: steamid } } })
    .catch(() => undefined),
);
