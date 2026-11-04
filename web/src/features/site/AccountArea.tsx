// The header's account corner: the signed-in player's menu, or a sign-in button. Rendered per request.
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { AccountMenu } from "./AccountMenu";
import { SignInButton } from "./SignInButton";

export async function AccountArea() {
  const me = await signedInPlayer();
  return me ? <AccountMenu me={me} /> : <SignInButton />;
}
