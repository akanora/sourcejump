// The signed-in player for this request, read from the session cookie and checked with the API.
import { cookies } from "next/headers";
import { api, type Schemas } from "@/api/client";

const SESSION_COOKIE = "sj_session";

/**
 * Headers that carry the request's session to the API, for calls made on the player's behalf while
 * rendering. Reads the request's cookies, so whatever calls this renders per request: keep it inside
 * <Suspense> so the rest of the page stays static. Null when signed out.
 */
export async function sessionHeaders(): Promise<{ cookie: string } | null> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  return session ? { cookie: `${SESSION_COOKIE}=${session}` } : null;
}

/** Null when signed out, or when the API can't be reached. Renders per request, like `sessionHeaders`. */
export async function signedInPlayer(): Promise<Schemas["Me"] | null> {
  const headers = await sessionHeaders();
  if (!headers) return null;
  const result = await api.GET("/v1/me", { headers }).catch(() => undefined);
  return result?.data ?? null;
}
