"use client";

import { Eye, EyeOff, Key, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authedFetch } from "@/lib/auth/authed-fetch";
import {
  BYOK_PROVIDERS,
  type BYOKKeyRecord,
  type BYOKProvider,
} from "@/lib/byok/types";

/**
 * BYOKPanel — "API Keys" tab inside `AccountSettingsDialog`.
 *
 * Lets a signed-in user paste their own provider API keys. Each row
 * collapses to either:
 *
 *   - "Not set" → a paste-and-save form, validated live against the
 *     provider before persisting.
 *   - "Saved (••••abc1, Enabled)" → toggle / replace / remove controls.
 *
 * The component never sees ciphertext, never sees a previously-saved
 * full key, and never sends a key over the wire to the browser; it
 * only POSTs new keys to `/api/byok/keys` and renders fingerprints
 * the server hands back. That's the entire BYOK security model from
 * the UI's perspective.
 */

const PROVIDER_LABEL: Record<BYOKProvider, string> = {
  fal: "Fal",
  higgsfield: "Higgsfield",
  openai: "OpenAI",
  anthropic: "Anthropic",
  replicate: "Replicate",
  google: "Google",
};

const PROVIDER_HINT: Record<BYOKProvider, string> = {
  fal: "Used for image, video, audio, and 3D generation. Get one at fal.ai/dashboard/keys.",
  higgsfield: "Used for Soul ID + Soul Image. Both Key and Secret required.",
  openai: "Reserved — UI surfaces will land in a future slice.",
  anthropic: "Reserved — UI surfaces will land in a future slice.",
  replicate: "Reserved — UI surfaces will land in a future slice.",
  google: "Reserved — UI surfaces will land in a future slice.",
};

// Providers that are actually wired into the UI today. The schema
// supports more (so we can backfill rows without a migration), but
// surfacing a half-working tab would just confuse users.
const VISIBLE_PROVIDERS: readonly BYOKProvider[] = ["fal", "higgsfield"];

interface ApiListResponse {
  keys: BYOKKeyRecord[];
  supportedProviders: readonly BYOKProvider[];
}

export function BYOKPanel() {
  const [rows, setRows] = useState<BYOKKeyRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch("/api/byok/keys", { method: "GET" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as ApiListResponse;
      setRows(body.keys);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load. The lint rule flags setState-in-effect because the
  // refresh callback eventually calls setRows/setLoading; here it's
  // exactly the right shape — we DO synchronize React with an
  // external system (the server). Disable for this effect only.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void refresh();
  }, [refresh]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <section className="flex flex-col gap-3" data-testid="byok-panel">
      <header className="flex items-center gap-2">
        <Key className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          API Keys (BYOK)
        </h2>
      </header>
      <p className="text-[11px] leading-relaxed text-muted-foreground/70">
        Bring your own provider API keys. When a key is enabled, runs
        bill against your upstream account instead of the platform&apos;s.
        Disable to fall back to the platform key.
      </p>

      {error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Loading…
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {VISIBLE_PROVIDERS.map((provider) => {
            const row = rows?.find((r) => r.provider === provider) ?? null;
            return (
              <ProviderRow
                key={provider}
                provider={provider}
                row={row}
                onChanged={refresh}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

interface ProviderRowProps {
  provider: BYOKProvider;
  row: BYOKKeyRecord | null;
  onChanged: () => Promise<void>;
}

function ProviderRow({ provider, row, onChanged }: ProviderRowProps) {
  const [editing, setEditing] = useState(row === null);
  // Reflect server state when the parent refreshes (e.g. after save).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setEditing(row === null);
  }, [row]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const label = PROVIDER_LABEL[provider];
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border/40 bg-background/40 p-3"
      data-testid={`byok-row-${provider}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold">{label}</span>
          {row ? (
            <span className="font-mono text-[10px] text-muted-foreground">
              ••••{row.fingerprint}
            </span>
          ) : (
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
              Not set
            </span>
          )}
        </div>
        {row ? (
          <RowControls
            provider={provider}
            row={row}
            onChanged={onChanged}
            onEdit={() => setEditing(true)}
          />
        ) : null}
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground/60">
        {PROVIDER_HINT[provider]}
      </p>
      {editing ? (
        <ProviderForm
          provider={provider}
          onSaved={async () => {
            await onChanged();
            setEditing(false);
          }}
          onCancel={row ? () => setEditing(false) : undefined}
        />
      ) : null}
    </div>
  );
}

interface RowControlsProps {
  provider: BYOKProvider;
  row: BYOKKeyRecord;
  onChanged: () => Promise<void>;
  onEdit: () => void;
}

function RowControls({
  provider,
  row,
  onChanged,
  onEdit,
}: RowControlsProps) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      const res = await authedFetch(
        `/api/byok/keys?provider=${encodeURIComponent(provider)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !row.enabled }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success(
        row.enabled ? "Key disabled (platform fallback)." : "Key enabled.",
      );
      await onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Remove your saved ${PROVIDER_LABEL[provider]} key? You'll need to paste it again to use it.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await authedFetch(
        `/api/byok/keys?provider=${encodeURIComponent(provider)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success("Key removed.");
      await onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => void toggle()}
        disabled={busy}
        data-testid={`byok-toggle-${provider}`}
      >
        {row.enabled ? (
          <>
            <Eye className="mr-1 h-3 w-3" aria-hidden /> Enabled
          </>
        ) : (
          <>
            <EyeOff className="mr-1 h-3 w-3" aria-hidden /> Disabled
          </>
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onEdit}
        disabled={busy}
        data-testid={`byok-replace-${provider}`}
      >
        Replace
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => void remove()}
        disabled={busy}
        data-testid={`byok-remove-${provider}`}
      >
        <Trash2 className="h-3 w-3" aria-hidden />
      </Button>
    </div>
  );
}

interface ProviderFormProps {
  provider: BYOKProvider;
  onSaved: () => Promise<void>;
  onCancel?: () => void;
}

function ProviderForm({ provider, onSaved, onCancel }: ProviderFormProps) {
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPair = provider === "higgsfield";

  async function submit() {
    setError(null);
    if (key.trim().length < 8) {
      setError("Key looks too short — paste the full value.");
      return;
    }
    if (isPair && secret.trim().length < 8) {
      setError("Secret looks too short — paste the full value.");
      return;
    }
    setBusy(true);
    try {
      const payload = isPair
        ? { key: key.trim(), secret: secret.trim() }
        : { key: key.trim() };
      const res = await authedFetch("/api/byok/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, payload }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success(`${PROVIDER_LABEL[provider]} key saved.`);
      setKey("");
      setSecret("");
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="password"
        autoComplete="off"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder={isPair ? `${PROVIDER_LABEL[provider]} Key` : "API key"}
        disabled={busy}
        data-testid={`byok-input-key-${provider}`}
      />
      {isPair ? (
        <Input
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={`${PROVIDER_LABEL[provider]} Secret`}
          disabled={busy}
          data-testid={`byok-input-secret-${provider}`}
        />
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-[11px] text-destructive"
        >
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          disabled={busy}
          data-testid={`byok-save-${provider}`}
        >
          {busy ? (
            <Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden />
          ) : null}
          Save
        </Button>
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// Re-export so tests can list providers without re-importing types.
export { BYOK_PROVIDERS };
