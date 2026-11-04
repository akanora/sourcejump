// The Players page's Banned tab, for staff who hold manage_bans: every ban in force, and the latest that ended.
import { api } from "@/api/client";
import { Card, Label } from "@/ui/Card";
import { DividedList } from "@/ui/Divided";
import { ReadFailure } from "../ReadFailure";
import { readAsStaff } from "../staffApi";
import { BanItem } from "./BanItem";

export async function BannedPlayers() {
  const bans = await readAsStaff((headers) =>
    api.GET("/v1/staff/bans", { headers }),
  );
  if (!("data" in bans)) return <ReadFailure failure={bans} />;
  const { active, ended } = bans.data;
  return (
    <>
      <Card className="flex flex-col gap-3">
        <Label>Active bans</Label>
        {active.length === 0 ? (
          <p className="text-text-muted text-sm">Nobody is banned.</p>
        ) : (
          <DividedList>
            {active.map((ban) => (
              <BanItem key={ban.id} ban={ban} showPlayer />
            ))}
          </DividedList>
        )}
      </Card>
      {ended.length > 0 && (
        <Card className="flex flex-col gap-3">
          <Label>Recently ended</Label>
          <DividedList>
            {ended.map((ban) => (
              <BanItem key={ban.id} ban={ban} showPlayer />
            ))}
          </DividedList>
        </Card>
      )}
    </>
  );
}
