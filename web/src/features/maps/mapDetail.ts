// A map's public detail, read once per request however many parts of the page show it (header and boards).
import { cache } from "react";
import { api } from "@/api/client";

/** Undefined when the API can't be reached; otherwise the response, so callers can tell a 404. */
export const getMap = cache((name: string) =>
  api
    .GET("/v1/maps/{map}", { params: { path: { map: name } } })
    .catch(() => undefined),
);
