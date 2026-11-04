// A player as staff see them, read once per request: the header needs it for players SourceJump hasn't seen
// and for the Banned badge, and so does the Manage view.
import { cache } from "react";
import { api } from "@/api/client";
import { readAsStaff } from "../staffApi";

export const getStaffPlayer = cache((steamid: string) =>
  readAsStaff((headers) =>
    api.GET("/v1/staff/players/{player}", {
      params: { path: { player: steamid } },
      headers,
    }),
  ),
);
