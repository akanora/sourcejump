"use client";
// Whether the signed-in player holds a privilege, for staff tools on public pages. The API checks the
// privilege again on every change; this only decides what to offer.
import type { Schemas } from "@/api/client";
import { useSignedInPlayer } from "@/features/auth/useSignedInPlayer";

/** False until the answer arrives, and for everyone who doesn't hold `privilege`. */
export function useHeldPrivilege(privilege: Schemas["Privilege"]): boolean {
  return useSignedInPlayer()?.privileges.includes(privilege) ?? false;
}
