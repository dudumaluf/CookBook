"use client";

import { Mail } from "lucide-react";
import { useState } from "react";

import { useSession } from "@/lib/auth/use-session";

/**
 * Login page — Slice 6.1 (ADR-0034).
 *
 * Single email input + "Send magic link" button. Tells the user what to expect
 * after submit (check inbox, click link, redirect back). Stays minimal on
 * purpose — no signup distinction (Supabase magic link auto-creates the
 * account on first use), no password field, no social providers in this
 * slice. Future auth providers (GitHub, Apple) would land as alternative
 * actions on this same page.
 *
 * Flow:
 *   1. User types email + submits.
 *   2. We call `signInWithMagicLink` → Supabase sends an OTP email with a
 *      link back to the app's origin.
 *   3. UI flips to "Check your inbox" success state.
 *   4. User clicks the link → bounces to `/` with a hash fragment →
 *      `detectSessionInUrl` consumes it → `useSession` sees the new session
 *      → `<AuthGate>` swaps anonymous-screen for authenticated app.
 *
 * If the user is already authenticated (refresh after click), the AuthGate
 * never mounts this page, so no redirect needed here.
 */
export default function LoginPage() {
  const { signInWithMagicLink } = useSession();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    setError(null);
    const result = await signInWithMagicLink(email);
    if (result.ok) {
      setStatus("sent");
    } else {
      setStatus("idle");
      setError(result.error ?? "Could not send magic link. Please try again.");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border/70 bg-popover/95 p-8 shadow-md shadow-black/40 backdrop-blur">
        <div className="mb-6 flex flex-col items-start gap-2">
          <h1 className="text-xl font-semibold text-foreground">Cookbook</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to continue. We&apos;ll email you a one-tap link.
          </p>
        </div>

        {status === "sent" ? (
          <div
            data-testid="login-sent"
            className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent/10 p-4 text-sm text-foreground/90"
          >
            <Mail className="h-5 w-5 text-accent" />
            <div>
              <p className="font-medium">Check your inbox</p>
              <p className="mt-1 text-xs text-muted-foreground">
                We sent a sign-in link to{" "}
                <span className="font-mono text-foreground/80">{email}</span>.
                Click it and you&apos;ll land back here signed in.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setStatus("idle");
                setEmail("");
              }}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={onSubmit}>
            <label
              htmlFor="login-email"
              className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
            >
              Email
            </label>
            <input
              id="login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              disabled={status === "sending"}
              className="rounded-md border border-border/60 bg-background/40 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-accent/60 disabled:opacity-60"
            />

            {error ? (
              <p
                role="alert"
                data-testid="login-error"
                className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={status === "sending" || email.length === 0}
              data-testid="login-submit"
              className="mt-1 inline-flex h-9 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "sending" ? "Sending…" : "Send magic link"}
            </button>
          </form>
        )}

        <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground/70">
          By continuing you agree this is a personal-use tool. M0a is single-user
          and your data lives in your own Supabase project.
        </p>
      </div>
    </main>
  );
}
