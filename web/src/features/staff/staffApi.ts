// Reading staff data on the signed-in staff member's behalf while rendering, and why it failed when it does.
// Staff pages read with `readAsStaff` and show `ReadFailure`; changes go through `useStaffAction`, which
// refreshes the page. Dialog fields that should take focus carry `data-autofocus`.
import { failureMessage } from "@/api/client";
import { sessionHeaders } from "@/features/auth/signedInPlayer";

export type StaffFailure =
  | { failure: "signed_out" }
  /** The API's reason: not staff at all, or not this section. */
  | { failure: "forbidden"; message: string }
  | { failure: "unavailable" };

export type StaffRead<T> = { data: T } | StaffFailure;

/**
 * Calls `send` with the request's session. Every staff page reads through this, so each one says for
 * itself why it can't show its data; the layout around them never waits for a sign-in check.
 */
export async function readAsStaff<T>(
  send: (headers: {
    cookie: string;
  }) => Promise<{ data?: T; error?: { error: string }; response: Response }>,
): Promise<StaffRead<T>> {
  const headers = await sessionHeaders();
  if (!headers) return { failure: "signed_out" };
  const result = await send(headers).catch(() => undefined);
  if (result?.data !== undefined) return { data: result.data };
  if (result?.response.status === 401) return { failure: "signed_out" };
  if (result?.response.status === 403) {
    return {
      failure: "forbidden",
      message: failureMessage(result.error, "This is for SourceJump staff."),
    };
  }
  return { failure: "unavailable" };
}
