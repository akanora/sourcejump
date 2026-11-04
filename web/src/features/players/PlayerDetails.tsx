// The top of a player's profile: their setup as they describe it (mouse, DPI, sensitivity and so on), with a
// way to change it for the player themself and for staff who manage bans. A line sets it apart from runs.
import { api, type Schemas } from "@/api/client";
import type { signedInPlayer } from "@/features/auth/signedInPlayer";
import { detailFields } from "./detailFields";
import { EditDetails } from "./EditDetails";

export async function PlayerDetails({
  player,
  me,
}: {
  player: Schemas["PlayerProfile"];
  me: Awaited<ReturnType<typeof signedInPlayer>>;
}) {
  const own = me?.steamid64 === player.steamid64;
  const staff = !own && (me?.privileges.includes("manage_bans") ?? false);
  const details = player.details;
  const shown = detailFields.filter(({ key }) => details?.[key] != null);
  if (shown.length === 0 && !own && !staff) return null;
  const countries = own || staff ? await countryOptions() : [];

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        {shown.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4 lg:flex lg:flex-wrap lg:gap-x-10">
            {shown.map(({ key, label }) => (
              <div key={key} className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-text-muted text-xs tracking-widest uppercase">
                  {label}
                </dt>
                <dd className="truncate tabular-nums">
                  {String(details?.[key])}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-text-muted text-sm">
            {own
              ? "Add your setup, so others can see what you play with."
              : "No details yet."}
          </p>
        )}
        {(own || staff) && (
          <EditDetails
            player={player}
            countries={countries}
            staff={staff}
            hasDetails={shown.length > 0}
          />
        )}
      </div>
      {player.details_from_old_site && (
        <p className="text-text-subtle -mt-6 text-xs">
          From the old site{own ? ", until you save your own" : ""}.
        </p>
      )}
      <hr className="border-border" />
    </section>
  );
}

/**
 * The countries the API accepts, named and sorted here on the server: the browser's own names can differ
 * from Node's, which would make the page's two renders disagree.
 */
async function countryOptions(): Promise<{ code: string; name: string }[]> {
  const result = await api.GET("/v1/countries").catch(() => undefined);
  const names = new Intl.DisplayNames("en", { type: "region" });
  return (result?.data?.codes ?? [])
    .map((code) => ({ code, name: names.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}
