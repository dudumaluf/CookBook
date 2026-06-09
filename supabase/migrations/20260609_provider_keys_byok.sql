-- Slice 7.7 (ADR-0073) — Bring Your Own Key (BYOK).
--
-- Per-user encrypted storage for AI provider API keys. The user can
-- save their own Fal / Higgsfield / OpenAI / Anthropic / Replicate
-- credentials and switch the runtime to bill against THEIR upstream
-- credit pool instead of the platform's. When `enabled = false` (or
-- when no row exists for a given provider), the system falls back to
-- the platform-level env var (FAL_KEY, HIGGSFIELD_API_KEY, …) — same
-- behavior as today.
--
-- ## Schema choice — single row per (owner_id, provider)
--
-- Composite primary key. Each user can store at most one key per
-- provider. Saving a new key for the same provider UPSERTs (replace).
-- This keeps the UX trivially predictable ("my Fal key" is unambiguous)
-- and avoids needing a "which key is active" flag — `enabled` is the
-- only state on the row.
--
-- ## Schema choice — encrypted_payload as TEXT, not JSONB
--
-- The decrypted plaintext is JSON shaped per-provider (Higgsfield is a
-- {key, secret} pair; Fal is just {key}; future providers may have
-- their own shape). We encrypt the WHOLE JSON blob app-side with
-- AES-256-GCM (see `src/lib/byok/crypto.ts`) and store the ciphertext
-- as base64 TEXT. The DB never sees plaintext keys — not in logs, not
-- in snapshots, not in support tooling. Rotating BYOK_MASTER_KEY is
-- the only way to access stored keys; losing it bricks them
-- (intentionally — that's the security model).
--
-- ## `key_fingerprint` — short non-sensitive identifier
--
-- Last 4 chars of the underlying key, stored separately so the UI can
-- render "Fal key (••••abc1)" without needing to decrypt. The 4-char
-- prefix is short enough that it can't be reverse-engineered into the
-- full key but long enough for the user to confirm "yes that's the
-- key I set."
--
-- ## RLS — same template as cookbook_user_preferences
--
-- Owner-only CRUD. The encryption is the second wall (RLS + at-rest
-- encryption); even a misconfigured RLS policy would only expose
-- ciphertext.

create table if not exists public.cookbook_provider_keys (
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in (
    'fal',
    'higgsfield',
    'openai',
    'anthropic',
    'replicate',
    'google'
  )),
  encrypted_payload text not null,
  key_fingerprint text not null check (char_length(key_fingerprint) <= 12),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, provider)
);

create or replace function public.touch_provider_keys_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_cookbook_provider_keys
  on public.cookbook_provider_keys;
create trigger touch_cookbook_provider_keys
  before update on public.cookbook_provider_keys
  for each row
  execute function public.touch_provider_keys_updated_at();

alter table public.cookbook_provider_keys enable row level security;

drop policy if exists "owner can crud own cookbook_provider_keys"
  on public.cookbook_provider_keys;
create policy "owner can crud own cookbook_provider_keys"
  on public.cookbook_provider_keys
  for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Helpful index for the assistant + repo queries that fetch all of a
-- user's keys at once ("which providers does this user have BYOK
-- enabled for?"). owner_id alone is good for this; the PK already
-- covers (owner_id, provider) for single-key lookups.
create index if not exists cookbook_provider_keys_owner_enabled_idx
  on public.cookbook_provider_keys (owner_id)
  where enabled = true;
