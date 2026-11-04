"use client";
// Sends a staff change to the API and refreshes the page's data after it, keeping the error to show if it fails.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { failureMessage } from "@/api/client";

type Outcome<T> =
  { data?: T; error?: { error: string }; response: Response } | undefined;

export function useStaffAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Resolves to the response's data (or true for an empty answer) when it worked, else null. */
  async function run<T>(
    send: () => Promise<Outcome<T>>,
    fallback: string,
  ): Promise<T | true | null> {
    setBusy(true);
    setError(null);
    const result = await send().catch(() => undefined);
    setBusy(false);
    if (!result?.response.ok) {
      setError(failureMessage(result?.error, fallback));
      return null;
    }
    router.refresh();
    return result.data ?? true;
  }

  return { busy, error, clearError: () => setError(null), run };
}
