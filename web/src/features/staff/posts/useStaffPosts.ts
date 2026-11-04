"use client";
// The Community page's posts for staff who hold manage_posts, removed ones included, read from the browser so
// the page itself stays the same for everyone.
import { useCallback, useEffect, useState } from "react";
import { api, type Schemas } from "@/api/client";
import { useSignedInPlayer } from "@/features/auth/useSignedInPlayer";

/**
 * Null for everyone else, and until the page arrives. If it can't be read, staff keep the public list rather
 * than an error: nothing published is lost, and the removed posts come back on the next visit.
 */
export function useStaffPosts({
  kind,
  before,
}: {
  kind?: Schemas["PostKind"];
  before?: string;
}): {
  list: Schemas["StaffPostList"];
  me: Schemas["Me"];
  reload: () => void;
} | null {
  const me = useSignedInPlayer();
  const allowed = me?.privileges.includes("manage_posts") ?? false;
  const [list, setList] = useState<Schemas["StaffPostList"] | null>(null);

  const reload = useCallback(() => {
    void api
      .GET("/v1/staff/posts", {
        params: { query: { kind, cursor: before } },
      })
      .then((result) => {
        if (result.data) setList(result.data);
      })
      .catch(() => undefined);
  }, [kind, before]);

  useEffect(() => {
    if (allowed) reload();
  }, [allowed, reload]);

  return me && allowed && list ? { list, me, reload } : null;
}
