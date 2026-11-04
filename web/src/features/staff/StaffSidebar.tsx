// The staff area's sections for the signed-in player, or nothing for anyone who isn't staff.
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { isStaff } from "./sections";
import { StaffNav } from "./StaffNav";

/**
 * Loads beside the page rather than around it, so a staff page's heading shows the moment it's opened.
 * It only decides what to show: each page's data read, and every staff endpoint, refuses on its own.
 */
export async function StaffSidebar() {
  const me = await signedInPlayer();
  if (!me || !isStaff(me.privileges)) return null;
  return <StaffNav privileges={me.privileges} />;
}
