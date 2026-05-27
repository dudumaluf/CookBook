"use client";

import { Loader2 } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { useSession } from "@/lib/auth/use-session";

/**
 * AuthGate — Slice 6.1 (ADR-0034).
 *
 * Wraps the entire AppShell. Three states:
 *   - `loading`: initial session probe is in-flight; render a tiny
 *     centered spinner so the page doesn't flash content.
 *   - `anonymous`: redirect to `/login`. Children never render.
 *   - `authenticated`: render children (the app).
 *
 * The app layout (`src/app/layout.tsx`) wraps `{children}` in this gate so
 * every route is protected. The `/login` route is the only exception —
 * it's a sibling page that doesn't go through this gate (it handles its
 * own anonymous-friendly UI).
 *
 * No flicker: the loading state guarantees we never paint authenticated
 * UI for a millisecond before redirecting. SSR HTML matches the loading
 * skeleton on first paint, then the client hydrates the real session.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div
        data-testid="auth-gate-loading"
        className="flex min-h-screen items-center justify-center bg-background"
      >
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  if (status === "anonymous") {
    // Redirect is in-flight — render nothing rather than flashing the app.
    return null;
  }

  return <>{children}</>;
}
