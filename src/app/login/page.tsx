"use client";

import { Mail } from "lucide-react";
import { useState } from "react";

import { useSession } from "@/lib/auth/use-session";

/**
 * Login page — magic link + password (ADR-0034 + ADR-0068).
 *
 * Three modes the user can flip between with no page navigation:
 *
 *   1. **magic** (default) — email + "Send magic link". The lowest-friction
 *      flow that ADR-0034 chose for first launch. Stays the front door.
 *   2. **password** — email + password + "Sign in". Activated from the
 *      "Use password instead" link on the magic mode. Required by ADR-0068
 *      so smoke-test automation (and the user's day-to-day muscle memory)
 *      doesn't have to round-trip an email every session.
 *   3. **reset** — email + "Send reset email". Reached from the "Forgot
 *      password?" link on password mode. Kicks off Supabase's recovery
 *      email; the link in that email lands on `/reset-password` where
 *      `setPassword` finishes the job.
 *
 * Each mode has its own success ("check your inbox") screen for the email
 * flows; password mode resolves in-band — on a successful sign-in the
 * `<AuthGate>` mounted on the protected pages picks up the session and
 * unmounts this page.
 *
 * Single email field across all modes (typed once, persists when toggling).
 * Errors render inline above the active submit button; submitting clears
 * any prior error so a retry isn't visually polluted by stale state.
 */

type Mode = "magic" | "password" | "reset";
type Status = "idle" | "sending" | "sent";

export default function LoginPage() {
  const {
    signInWithMagicLink,
    signInWithPassword,
    requestPasswordReset,
  } = useSession();
  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  function flipMode(next: Mode) {
    setMode(next);
    setStatus("idle");
    setError(null);
    if (next !== "password") setPassword("");
  }

  async function onSubmitMagic(event: React.FormEvent) {
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

  async function onSubmitPassword(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    setError(null);
    const result = await signInWithPassword(email, password);
    if (result.ok) {
      // No success state — onAuthStateChange will fire SIGNED_IN, the
      // <AuthGate> on the destination page picks it up and renders the
      // app. We DON'T navigate here ourselves — letting the auth state
      // drive routing matches the magic-link flow exactly and keeps a
      // single source of truth (the session listener) for "where the
      // user lands after auth".
      setStatus("idle");
      setPassword("");
    } else {
      setStatus("idle");
      setError(result.error ?? "Sign in failed. Please try again.");
    }
  }

  async function onSubmitReset(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    setError(null);
    const result = await requestPasswordReset(email);
    if (result.ok) {
      setStatus("sent");
    } else {
      setStatus("idle");
      setError(
        result.error ?? "Could not send reset email. Please try again.",
      );
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border/70 bg-popover/95 p-8 shadow-md shadow-black/40 backdrop-blur">
        <div className="mb-6 flex flex-col items-start gap-2">
          <h1 className="text-xl font-semibold text-foreground">Cookbook</h1>
          <p className="text-sm text-muted-foreground">
            {mode === "magic"
              ? "Sign in to continue. We'll email you a one-tap link."
              : mode === "password"
                ? "Sign in with your email and password."
                : "We'll email you a link to reset your password."}
          </p>
        </div>

        {status === "sent" ? (
          <SentConfirmation
            email={email}
            kind={mode === "reset" ? "reset" : "magic"}
            onUseDifferentEmail={() => {
              setStatus("idle");
              setEmail("");
              setPassword("");
            }}
          />
        ) : mode === "magic" ? (
          <MagicForm
            email={email}
            setEmail={setEmail}
            status={status}
            error={error}
            onSubmit={onSubmitMagic}
            onUsePassword={() => flipMode("password")}
          />
        ) : mode === "password" ? (
          <PasswordForm
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            status={status}
            error={error}
            onSubmit={onSubmitPassword}
            onUseMagic={() => flipMode("magic")}
            onForgot={() => flipMode("reset")}
          />
        ) : (
          <ResetForm
            email={email}
            setEmail={setEmail}
            status={status}
            error={error}
            onSubmit={onSubmitReset}
            onBack={() => flipMode("password")}
          />
        )}

        <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground/70">
          By continuing you agree this is a personal-use tool. M0a is single-user
          and your data lives in your own Supabase project.
        </p>
      </div>
    </main>
  );
}

/* ─────────────────────────── form variants ────────────────────────────── */

function MagicForm({
  email,
  setEmail,
  status,
  error,
  onSubmit,
  onUsePassword,
}: {
  email: string;
  setEmail: (v: string) => void;
  status: Status;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onUsePassword: () => void;
}) {
  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit}>
      <EmailField email={email} setEmail={setEmail} disabled={status === "sending"} />
      {error ? <ErrorRow message={error} /> : null}
      <button
        type="submit"
        disabled={status === "sending" || email.length === 0}
        data-testid="login-submit"
        className="mt-1 inline-flex h-9 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "sending" ? "Sending…" : "Send magic link"}
      </button>
      <button
        type="button"
        onClick={onUsePassword}
        data-testid="login-mode-password"
        className="mt-1 self-center text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        Use password instead
      </button>
    </form>
  );
}

function PasswordForm({
  email,
  setEmail,
  password,
  setPassword,
  status,
  error,
  onSubmit,
  onUseMagic,
  onForgot,
}: {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  status: Status;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onUseMagic: () => void;
  onForgot: () => void;
}) {
  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit}>
      <EmailField email={email} setEmail={setEmail} disabled={status === "sending"} />
      <label
        htmlFor="login-password"
        className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
      >
        Password
      </label>
      <input
        id="login-password"
        type="password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        placeholder="••••••••"
        disabled={status === "sending"}
        data-testid="login-password"
        className="rounded-md border border-border/60 bg-background/40 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-accent/60 disabled:opacity-60"
      />
      {error ? <ErrorRow message={error} /> : null}
      <button
        type="submit"
        disabled={
          status === "sending" || email.length === 0 || password.length === 0
        }
        data-testid="login-submit-password"
        className="mt-1 inline-flex h-9 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "sending" ? "Signing in…" : "Sign in"}
      </button>
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <button
          type="button"
          onClick={onUseMagic}
          data-testid="login-mode-magic"
          className="transition-colors hover:text-foreground"
        >
          Use magic link instead
        </button>
        <button
          type="button"
          onClick={onForgot}
          data-testid="login-mode-reset"
          className="transition-colors hover:text-foreground"
        >
          Forgot password?
        </button>
      </div>
    </form>
  );
}

function ResetForm({
  email,
  setEmail,
  status,
  error,
  onSubmit,
  onBack,
}: {
  email: string;
  setEmail: (v: string) => void;
  status: Status;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
}) {
  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit}>
      <EmailField email={email} setEmail={setEmail} disabled={status === "sending"} />
      {error ? <ErrorRow message={error} /> : null}
      <button
        type="submit"
        disabled={status === "sending" || email.length === 0}
        data-testid="login-submit-reset"
        className="mt-1 inline-flex h-9 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "sending" ? "Sending…" : "Send reset email"}
      </button>
      <button
        type="button"
        onClick={onBack}
        data-testid="login-mode-password-back"
        className="mt-1 self-center text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        Back to sign in
      </button>
    </form>
  );
}

function SentConfirmation({
  email,
  kind,
  onUseDifferentEmail,
}: {
  email: string;
  kind: "magic" | "reset";
  onUseDifferentEmail: () => void;
}) {
  return (
    <div
      data-testid={kind === "magic" ? "login-sent" : "login-reset-sent"}
      className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent/10 p-4 text-sm text-foreground/90"
    >
      <Mail className="h-5 w-5 text-accent" />
      <div>
        <p className="font-medium">Check your inbox</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {kind === "magic"
            ? "We sent a sign-in link to "
            : "We sent a password reset link to "}
          <span className="font-mono text-foreground/80">{email}</span>.
          {kind === "magic"
            ? " Click it and you'll land back here signed in."
            : " Click it to choose a new password."}
        </p>
      </div>
      <button
        type="button"
        onClick={onUseDifferentEmail}
        className="text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        Use a different email
      </button>
    </div>
  );
}

function EmailField({
  email,
  setEmail,
  disabled,
}: {
  email: string;
  setEmail: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <>
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
        disabled={disabled}
        className="rounded-md border border-border/60 bg-background/40 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-accent/60 disabled:opacity-60"
      />
    </>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <p
      role="alert"
      data-testid="login-error"
      className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      {message}
    </p>
  );
}
