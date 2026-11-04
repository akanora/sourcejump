"use client";
// Sends the player to Steam to sign in, and back to this page afterwards.
import { usePathname } from "next/navigation";
import { ButtonAnchor } from "@/ui/Button";

export function SignInButton() {
  const pathname = usePathname();
  return (
    // A full page load, not a client navigation: the API redirects to Steam.
    <ButtonAnchor
      href={`/v1/auth/steam?return_to=${encodeURIComponent(pathname)}`}
      size="sm"
    >
      Sign in with Steam
    </ButtonAnchor>
  );
}
