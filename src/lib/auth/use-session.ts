"use client";

import type { Session, User } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";

import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * useSession — auth hook covering magic-link AND email+password (ADR-0034 + ADR-0068).
 *
 * Single React hook that wraps Supabase Auth's session lifecycle. Exposes:
 *  - `status`: "loading" until the first session check resolves, then
 *    "authenticated" or "anonymous". Apps render <AuthGate> based on this.
 *  - `user` / `session`: the live user record + token; null when anonymous.
 *  - `signInWithMagicLink(email)`: sends the OTP email; returns the resolved
 *    state ({ ok, error? }). The actual session lands when the user clicks
 *    the link in their inbox and Supabase's `detectSessionInUrl` picks up
 *    the redirect.
 *  - `signInWithPassword(email, password)`: synchronous credential auth.
 *    Resolves with the session in-band (no email round-trip).
 *  - `setPassword(newPassword)`: sets/changes the password on the currently
 *    authenticated user via `auth.updateUser`. Required once after first
 *    magic-link sign-in to enable password mode going forward; also used
 *    on the `/reset-password` recovery landing.
 *  - `requestPasswordReset(email)`: triggers Supabase's recovery email
 *    flow. Email contains a link to `/reset-password` where the user
 *    lands with a temporary recovery session and can call `setPassword`.
 *  - `signOut()`: clears the local session.
 *
 * The `onAuthStateChange` listener is the canonical source of session
 * updates — covers magic-link callback, refresh, and explicit sign-in/out.
 * We deliberately do NOT poll `getSession()` periodically; the listener
 * fires in <100ms whenever Supabase mutates the session internally.
 *
 * SSR safety: this is a `"use client"` hook. The first render shows
 * `status: "loading"` until `getSession()` resolves on the client, which
 * is correct — we never know who the user is during SSR.
 */

export type AuthStatus = "loading" | "anonymous" | "authenticated";

export interface UseSessionResult {
  status: AuthStatus;
  user: User | null;
  session: Session | null;
  signInWithMagicLink: (email: string) => Promise<SignInResult>;
  signInWithPassword: (email: string, password: string) => Promise<SignInResult>;
  setPassword: (newPassword: string) => Promise<SignInResult>;
  requestPasswordReset: (email: string) => Promise<SignInResult>;
  signOut: () => Promise<void>;
}

export interface SignInResult {
  ok: boolean;
  /** User-readable error from Supabase, when `ok === false`. */
  error?: string;
}

/**
 * Resolve the absolute URL we want Supabase to redirect to after a
 * magic-link click or a password recovery click. Order:
 *   1. `NEXT_PUBLIC_SITE_URL` — pin to production from any surface.
 *   2. `window.location.origin` — works in dev + naive prod.
 * Whichever resolves, Supabase only honors values present in the
 * project's `uri_allow_list` (see supabase/AUTH-CONFIG.md).
 */
function resolveAppUrl(path: string = ""): string | undefined {
  const envSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const origin =
    envSiteUrl && envSiteUrl.length > 0
      ? envSiteUrl
      : typeof window !== "undefined"
        ? window.location.origin
        : undefined;
  if (!origin) return undefined;
  return path.length > 0 ? `${origin}${path}` : origin;
}

export function useSession(): UseSessionResult {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const client = getSupabaseClient();
    let unsubscribed = false;

    // Initial probe — Supabase parses the hash fragment from the magic-link
    // callback (because `detectSessionInUrl: true`) and resolves the session
    // synchronously here when present. If the user has no session, returns
    // null and we settle on "anonymous".
    void client.auth.getSession().then(({ data }) => {
      if (unsubscribed) return;
      const next = data.session;
      setSession(next);
      setStatus(next ? "authenticated" : "anonymous");
    });

    // Subsequent transitions — sign-in, sign-out, refresh, magic-link arrival.
    // We funnel everything through this listener so the in-memory state stays
    // canonical with what Supabase considers the current session.
    const sub = client.auth.onAuthStateChange((_event, nextSession) => {
      if (unsubscribed) return;
      setSession(nextSession);
      setStatus(nextSession ? "authenticated" : "anonymous");
    });

    return () => {
      unsubscribed = true;
      sub.data.subscription.unsubscribe();
    };
  }, []);

  const signInWithMagicLink = useCallback(
    async (email: string): Promise<SignInResult> => {
      const trimmed = email.trim();
      if (trimmed.length === 0) {
        return { ok: false, error: "Email cannot be empty" };
      }
      const client = getSupabaseClient();
      // `emailRedirectTo` lands the user back on the app after they click the
      // link. Whichever resolves, Supabase only honors it if the value is in
      // the project's `uri_allow_list` (see supabase/AUTH-CONFIG.md).
      // Otherwise it falls back to the project's Site URL setting.
      const emailRedirectTo = resolveAppUrl();
      const { error } = await client.auth.signInWithOtp({
        email: trimmed,
        options: emailRedirectTo ? { emailRedirectTo } : undefined,
      });
      if (error) {
        return { ok: false, error: error.message };
      }
      return { ok: true };
    },
    [],
  );

  const signInWithPassword = useCallback(
    async (email: string, password: string): Promise<SignInResult> => {
      const trimmedEmail = email.trim();
      if (trimmedEmail.length === 0) {
        return { ok: false, error: "Email cannot be empty" };
      }
      if (password.length === 0) {
        return { ok: false, error: "Password cannot be empty" };
      }
      const client = getSupabaseClient();
      const { error } = await client.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      if (error) {
        // Map Supabase's terse "Invalid login credentials" to something
        // less ambiguous about which field is wrong (we don't actually
        // know — by design — but a friendlier copy beats the bare string).
        const message =
          error.message === "Invalid login credentials"
            ? "Email or password is incorrect"
            : error.message;
        return { ok: false, error: message };
      }
      return { ok: true };
    },
    [],
  );

  const setPassword = useCallback(
    async (newPassword: string): Promise<SignInResult> => {
      if (newPassword.length < 8) {
        return {
          ok: false,
          error: "Password must be at least 8 characters",
        };
      }
      const client = getSupabaseClient();
      const { error } = await client.auth.updateUser({
        password: newPassword,
      });
      if (error) {
        return { ok: false, error: error.message };
      }
      return { ok: true };
    },
    [],
  );

  const requestPasswordReset = useCallback(
    async (email: string): Promise<SignInResult> => {
      const trimmed = email.trim();
      if (trimmed.length === 0) {
        return { ok: false, error: "Email cannot be empty" };
      }
      const client = getSupabaseClient();
      // Recovery emails contain a link to `/reset-password` where the
      // user lands on a temporary recovery session that authorises a
      // single `auth.updateUser({ password })` call — no extra grant.
      const redirectTo = resolveAppUrl("/reset-password");
      const { error } = await client.auth.resetPasswordForEmail(trimmed, {
        redirectTo,
      });
      if (error) {
        return { ok: false, error: error.message };
      }
      return { ok: true };
    },
    [],
  );

  const signOut = useCallback(async (): Promise<void> => {
    const client = getSupabaseClient();
    await client.auth.signOut();
    // The listener fires `setSession(null)` on its own; don't double-write.
  }, []);

  return {
    status,
    user: session?.user ?? null,
    session,
    signInWithMagicLink,
    signInWithPassword,
    setPassword,
    requestPasswordReset,
    signOut,
  };
}
