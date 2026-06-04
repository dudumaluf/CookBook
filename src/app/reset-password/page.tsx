"use client";

import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useSession } from "@/lib/auth/use-session";

/**
 * /reset-password — landing for Supabase recovery emails (ADR-0068).
 *
 * Flow:
 *   1. User clicks "Forgot password?" on /login → request recovery email.
 *   2. Email contains a link to this route. Supabase JS v2 with
 *      `detectSessionInUrl: true` parses the recovery hash fragment
 *      synchronously when the page mounts, which authenticates the user
 *      with a short-lived recovery session.
 *   3. This page reads `useSession`:
 *        - `loading`  → spinner (initial probe still running)
 *        - `anonymous` → link expired / never had a recovery session.
 *          Render an error CTA back to /login.
 *        - `authenticated` → show the "Set new password" form, gated by
 *          a confirmation field so a typo doesn't lock the user out.
 *   4. Submit calls `setPassword(newPassword)` → on success, navigate
 *      to /projetos. The session promotes from "recovery" to a normal
 *      one in-band; no extra sign-in needed.
 *
 * The same form is the target for first-time password setup from the
 * Account dialog (ADR-0068), but that path renders a different wrapper
 * — this page is the public recovery surface only.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const { status, setPassword } = useSession();
  const [password, setPasswordValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    const result = await setPassword(password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not set password");
      return;
    }
    setDone(true);
    setTimeout(() => router.replace("/projetos"), 1200);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border/70 bg-popover/95 p-8 shadow-md shadow-black/40 backdrop-blur">
        <div className="mb-6 flex flex-col items-start gap-2">
          <KeyRound className="h-5 w-5 text-accent" />
          <h1 className="text-xl font-semibold text-foreground">
            Choose a new password
          </h1>
          <p className="text-sm text-muted-foreground">
            Pick something at least 8 characters. You&apos;ll use this with
            your email to sign in.
          </p>
        </div>

        {status === "loading" ? (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            data-testid="reset-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Verifying recovery link…
          </div>
        ) : status === "anonymous" ? (
          <div
            data-testid="reset-expired"
            className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground/90"
          >
            <p className="font-medium">This recovery link is no longer valid.</p>
            <p className="text-xs text-muted-foreground">
              Reset links are single-use and expire after a short window. Open
              another reset email to continue.
            </p>
            <Link
              href="/login"
              className="text-xs text-accent transition-colors hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        ) : done ? (
          <div
            data-testid="reset-done"
            className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent/10 p-4 text-sm text-foreground/90"
          >
            <CheckCircle2 className="h-5 w-5 text-accent" />
            <p className="font-medium">Password updated. Taking you in…</p>
          </div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={onSubmit}>
            <label
              htmlFor="reset-password"
              className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
            >
              New password
            </label>
            <input
              id="reset-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPasswordValue(e.target.value)}
              autoComplete="new-password"
              autoFocus
              placeholder="••••••••"
              disabled={busy}
              data-testid="reset-password"
              className="rounded-md border border-border/60 bg-background/40 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-accent/60 disabled:opacity-60"
            />

            <label
              htmlFor="reset-confirm"
              className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
            >
              Confirm
            </label>
            <input
              id="reset-confirm"
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              placeholder="••••••••"
              disabled={busy}
              data-testid="reset-confirm"
              className="rounded-md border border-border/60 bg-background/40 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-accent/60 disabled:opacity-60"
            />

            {error ? (
              <p
                role="alert"
                data-testid="reset-error"
                className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={
                busy || password.length === 0 || confirm.length === 0
              }
              data-testid="reset-submit"
              className="mt-1 inline-flex h-9 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              ) : null}
              Update password
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
