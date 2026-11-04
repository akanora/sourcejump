// What the site says at an address it doesn't have, including unknown players and removed posts.
import { ButtonLink } from "@/ui/Button";

export function NotFoundMessage() {
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="text-text-muted">
        Nothing is at this address. If you followed a link to a player, they may
        not have played on a SourceJump server yet.
      </p>
      <ButtonLink href="/">Go to the home page</ButtonLink>
    </div>
  );
}
