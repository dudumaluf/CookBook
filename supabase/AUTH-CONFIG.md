# Supabase Auth Configuration

Auth config (Site URL, redirect URL allow-list, signup gating) lives **outside Postgres** — it's stored in Supabase's GoTrue config and edited via the dashboard or the [Management API](https://api.supabase.com/api/v1/projects/{ref}/config/auth). SQL migrations cannot capture it.

This file is the authoritative record for the values currently set on the Cookbook production project (`bnstnamdtlveluavjkcy`). When you provision a fresh Supabase project, replicate these.

## Settings

| Key | Value | Reason |
|---|---|---|
| `site_url` | `https://artificial-cookbook.vercel.app` | Default redirect after magic-link auth. Was `http://localhost:3000` (CLI default) — caused magic links to bounce users to a non-existent local server. |
| `uri_allow_list` | `http://localhost:3000,http://localhost:3000/**,https://artificial-cookbook.vercel.app,https://artificial-cookbook.vercel.app/**,https://*-dudumalufs-projects.vercel.app,https://*-dudumalufs-projects.vercel.app/**` | Whitelist accepted by Supabase when client passes `emailRedirectTo`. Includes localhost (dev), production, and Vercel preview deployments. |
| `disable_signup` | `true` | Single-user MVP. Only `ddmaluf@gmail.com` (the existing `auth.users` row) can magic-link in. New users blocked at signup. Flip to `false` when opening to multi-user. |

## How to apply

Via Supabase CLI (which stores its access token in macOS Keychain under `Supabase CLI`):

```bash
TOKEN=$(security find-generic-password -s "Supabase CLI" -w | sed 's/go-keyring-base64://' | base64 -d)

curl -sS -X PATCH "https://api.supabase.com/v1/projects/bnstnamdtlveluavjkcy/config/auth" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "site_url": "https://artificial-cookbook.vercel.app",
    "uri_allow_list": "http://localhost:3000,http://localhost:3000/**,https://artificial-cookbook.vercel.app,https://artificial-cookbook.vercel.app/**,https://*-dudumalufs-projects.vercel.app,https://*-dudumalufs-projects.vercel.app/**"
  }'
```

To verify:

```bash
TOKEN=$(security find-generic-password -s "Supabase CLI" -w | sed 's/go-keyring-base64://' | base64 -d)
curl -s "https://api.supabase.com/v1/projects/bnstnamdtlveluavjkcy/config/auth" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -10
```

## Or via Dashboard

[Authentication → URL Configuration](https://supabase.com/dashboard/project/bnstnamdtlveluavjkcy/auth/url-configuration)

- **Site URL**: `https://artificial-cookbook.vercel.app`
- **Redirect URLs** (one per line):
  - `http://localhost:3000`
  - `http://localhost:3000/**`
  - `https://artificial-cookbook.vercel.app`
  - `https://artificial-cookbook.vercel.app/**`
  - `https://*-dudumalufs-projects.vercel.app`
  - `https://*-dudumalufs-projects.vercel.app/**`

[Authentication → Providers → Email → Disable signup](https://supabase.com/dashboard/project/bnstnamdtlveluavjkcy/auth/providers): toggle **on** for single-user M0a.
