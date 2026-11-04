// A map as staff see it, read once per request: the header needs it for maps without runs, and so does the
// Manage view.
import { cache } from "react";
import { api } from "@/api/client";
import { readAsStaff } from "../staffApi";

export const getStaffMap = cache((name: string) =>
  readAsStaff((headers) =>
    api.GET("/v1/staff/maps/{map}", {
      params: { path: { map: name } },
      headers,
    }),
  ),
);
