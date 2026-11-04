// The page for any address SourceJump doesn't have, including unknown players.
import { NotFoundMessage } from "@/features/site/NotFoundMessage";
import { Page } from "@/ui/Page";

export default function NotFound() {
  return (
    <Page width="narrow">
      <NotFoundMessage />
    </Page>
  );
}
