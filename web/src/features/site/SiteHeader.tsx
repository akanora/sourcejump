// The top bar on every page: wordmark, sections, and the account corner.
import { Suspense } from "react";
import { Link } from "@/ui/Link";
import { AccountArea } from "./AccountArea";
import { SiteNav, SiteNavLinks } from "./SiteNav";

export function SiteHeader() {
  return (
    <header
      // Named so page fades leave the header in place (motion.css).
      style={{ viewTransitionName: "site-header" }}
      className="border-border bg-bg/90 sticky top-0 z-10 border-b backdrop-blur"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-1 px-4 lg:gap-6">
        <Link
          href="/"
          className="text-lg font-bold tracking-wider whitespace-nowrap uppercase"
        >
          Source<span className="text-accent">Jump</span>
        </Link>
        <Suspense fallback={<SiteNavLinks pathname={null} />}>
          <SiteNav />
        </Suspense>
        <div className="ml-auto flex items-center">
          {/* Depends on the session cookie, so it streams in per request while the shell stays static. */}
          <Suspense>
            <AccountArea />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
