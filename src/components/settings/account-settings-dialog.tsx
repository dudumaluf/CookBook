"use client";

import { Loader2, LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/auth/use-session";

/**
 * AccountSettingsDialog — account-level settings surface (ADR-0068).
 *
 * Reachable from `ProjectMenu → Workspace → Settings`. Two responsibilities:
 *
 *   1. **Identity readout** — show the signed-in email so the user has a
 *      clear "you are here" before changing anything.
 *   2. **Password set/change** — the canonical place to enable email+password
 *      auth on top of the magic-link account, or to rotate the password
 *      later. Wraps `useSession.setPassword` (which calls
 *      `auth.updateUser({ password })`); Supabase trusts the active session
 *      so we don't ask for the current password — the form is identical
 *      whether the user is setting one for the first time or changing it.
 *
 * The dialog also exposes a "Sign out" affordance for symmetry with the
 * existing menu item; primary consumers (ProjectMenu, ProjectsDashboard)
 * already have a sign-out, but having one here means a user who opens
 * Settings to switch accounts doesn't have to close the dialog first.
 *
 * On a successful password update we close the dialog and toast — the
 * session itself doesn't change (same `auth.users` row), so no navigation
 * or state churn is needed.
 */

export interface AccountSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccountSettingsDialog({
  open,
  onOpenChange,
}: AccountSettingsDialogProps) {
  const { user, setPassword, signOut } = useSession();
  const [password, setPasswordValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form state every time the dialog is reopened so a closed-and-
  // reopened dialog never starts with stale field values or a stale error.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setPasswordValue("");
    setConfirm("");
    setError(null);
    setBusy(false);
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleSetPassword() {
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
    toast.success("Password updated");
    setPasswordValue("");
    setConfirm("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="account-settings-dialog"
        className="sm:max-w-[460px]"
      >
        <DialogHeader>
          <DialogTitle>Account</DialogTitle>
          <DialogDescription>
            {user?.email ? (
              <>
                Signed in as{" "}
                <span className="font-mono text-foreground/80">
                  {user.email}
                </span>
              </>
            ) : (
              "Manage your account."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-1">
          <section className="flex flex-col gap-2">
            <header className="flex items-center gap-2">
              <ShieldCheck
                className="h-3.5 w-3.5 text-muted-foreground"
                aria-hidden
              />
              <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Password
              </h2>
            </header>
            <p className="text-[11px] leading-relaxed text-muted-foreground/70">
              Set a password to sign in without a magic link. Already have one?
              Use this to change it.
            </p>
            <label htmlFor="account-password" className="mt-1 text-xs">
              New password
            </label>
            <Input
              id="account-password"
              type="password"
              value={password}
              onChange={(e) => setPasswordValue(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              disabled={busy}
              data-testid="account-password"
            />
            <label htmlFor="account-password-confirm" className="text-xs">
              Confirm
            </label>
            <Input
              id="account-password-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              disabled={busy}
              data-testid="account-password-confirm"
            />
            {error ? (
              <p
                role="alert"
                data-testid="account-error"
                className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {error}
              </p>
            ) : null}
            <Button
              size="sm"
              onClick={() => void handleSetPassword()}
              disabled={
                busy || password.length === 0 || confirm.length === 0
              }
              data-testid="account-set-password"
            >
              {busy ? (
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              ) : null}
              Save password
            </Button>
          </section>

          <section className="flex flex-col gap-2 border-t border-border/40 pt-4">
            <header className="flex items-center gap-2">
              <LogOut
                className="h-3.5 w-3.5 text-muted-foreground"
                aria-hidden
              />
              <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Session
              </h2>
            </header>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void signOut()}
              data-testid="account-signout"
              className="self-start"
            >
              Sign out
            </Button>
          </section>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
