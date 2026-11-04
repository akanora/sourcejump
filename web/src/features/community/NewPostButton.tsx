"use client";
// The New post button on the Community page, for players who may post. It appears once the browser knows
// who is signed in, so the page itself is the same for everyone.
import { PenLine } from "lucide-react";
import { useSignedInPlayer } from "@/features/auth/useSignedInPlayer";
import { ButtonLink } from "@/ui/Button";
import { canPost } from "./posts";

export function NewPostButton() {
  if (!canPost(useSignedInPlayer())) return null;
  return (
    <ButtonLink
      href="/community/new"
      variant="primary"
      size="sm"
      className="motion-enter"
    >
      <PenLine aria-hidden />
      New post
    </ButtonLink>
  );
}
