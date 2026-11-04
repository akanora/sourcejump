// What a staff page shows instead of its data: a sign-in prompt, the API's refusal, or a retry hint.
import { SignInButton } from "@/features/site/SignInButton";
import { Card } from "@/ui/Card";
import type { StaffFailure } from "./staffApi";

export function ReadFailure({ failure }: { failure: StaffFailure }) {
  if (failure.failure === "signed_out") {
    return (
      <Card className="flex flex-col items-start gap-4 self-start">
        <p className="text-text-muted">
          Sign in with Steam to use the staff tools.
        </p>
        <SignInButton />
      </Card>
    );
  }
  return (
    <Card className="text-text-muted">
      {failure.failure === "forbidden"
        ? `${failure.message.replace(/\.?$/, ".")}`
        : "This couldn't be loaded. Try again in a moment."}
    </Card>
  );
}
