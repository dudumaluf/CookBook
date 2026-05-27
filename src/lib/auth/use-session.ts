"use client";

import type { Session, User } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";

import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * useSession — Slice 6.1 magic-link auth hook (ADR-0034).
 *
 * Single React hook that wraps Supabase Auth's session lifecycle. Exposes:
 *  - `status`: "loading" until the first session check resolves, then
 *    "authenticated" or "anonymous". Apps render <AuthGate> based on this.
 *  - `user` / `session`: the live user record + token; null when anonymous.
 *  - `signInWithMagicLink(email)`: sends the OTP email; returns the resolved
 *    state ({ ok, error? }). The actual session lands when the user clicks
 *    the link in their inbox and Supabase's `detectSessionInUrl` picks up
 *    the redirect.
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
  signOut: () => Promise<void>;
}

export interface SignInResult {
  ok: boolean;
  /** User-readable error from Supabase, when `ok === false`. */
  error?: string;
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
      // link. Resolution order:
      //   1. `NEXT_PUBLIC_SITE_URL` env var — pin to production from any
      //      surface (Vercel preview, dev server, embedded webview).
      //   2. `window.location.origin` — works in dev (localhost) + naive
      //      production deploys.
      //
      // Whichever resolves, Supabase only honors it if the value is in the
      // project's `uri_allow_list` (see supabase/AUTH-CONFIG.md). Otherwise
      // it falls back to the project's Site URL setting.
      const envSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
      const emailRedirectTo =
        envSiteUrl && envSiteUrl.length > 0
          ? envSiteUrl
          : typeof window !== "undefined"
            ? window.location.origin
            : undefined;
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
    signOut,
  };
}
