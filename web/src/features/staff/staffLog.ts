// Reads the staff log on the signed-in staff member's behalf, while rendering.
import { api, type Schemas } from "@/api/client";
import type { paths } from "@/api/schema";

/** A kind of staff action, as the log reads them one at a time. */
export type LogKind = NonNullable<
  NonNullable<paths["/v1/staff/log"]["get"]["parameters"]["query"]>["kind"]
>;
import { readAsStaff, type StaffRead } from "./staffApi";

/** A page of the log: the newest, or the one before or after a cursor from another page, of one kind of
 * action or about one thing if chosen. */
export type LogPage = {
  before?: string;
  after?: string;
  kind?: LogKind;
  about?: string;
};

export function readStaffLog(
  page: LogPage = {},
): Promise<StaffRead<Schemas["StaffLog"]>> {
  return readAsStaff((headers) =>
    api.GET("/v1/staff/log", { params: { query: page }, headers }),
  );
}
