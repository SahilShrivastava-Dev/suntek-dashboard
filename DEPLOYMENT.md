# Suntek Dashboard — Client Handover & Deployment Guide

Goal: stand up the entire app under **client-owned accounts** so no service runs on
a personal account's quota/billing. Do these in order. ☐ = check off as you go.

> The single most important principle: create every cloud account below using a
> **client-owned email** (e.g. a Google account Suntek controls). Add yourself as
> a collaborator. The client owns and pays; you operate.

---

## 0. What the app is made of

| Layer | Service | Account to create |
|-------|---------|-------------------|
| Database + auth + edge functions | **Supabase** | new client project |
| Image uploads | **Cloudinary** | new client account |
| OCR (server-side) | **NVIDIA API** | new client key |
| Hosting (static SPA) | **Firebase Hosting** (or Vercel) | new client project |

The `server/` Express + MSSQL backend is **not deployed** — BUSY data reaches
Supabase via a separate sync script on the BUSY VM (out of scope here).

---

## 1. Supabase (the hard part)

### 1.1 Create the project
- ☐ Sign in to supabase.com with the **client email**, create a new project.
- ☐ Save the project's **DB password** (you set it at creation) somewhere safe.

### 1.2 Replicate the database — EXACT clone (primary method)

> **Goal: a byte-identical copy** — every table, column, relationship, constraint,
> index, and RLS policy exactly as in the source DB. The only method that
> *guarantees* this is to dump the live database and restore it (Supabase is plain
> Postgres). There is **no dashboard button** to copy a project across accounts;
> "Transfer project" only moves the *same* project between orgs. So we dump/restore.
>
> Pick **Option A** (Supabase CLI — recommended) or **Option B** (raw `pg_dump`).
> Both produce an exact clone; A is tuned for Supabase, B uses only the standard
> Postgres client.

#### Both options need: the two database connection strings
- ☐ **Source (your) DB URI** — old project → Dashboard → **Project Settings →
  Database → Connection string → URI**. Copy it; it already contains the password.
  (If it shows `[YOUR-PASSWORD]`, paste in the DB password you set at project creation.)
- ☐ **Target (client) DB URI** — same place in the **new** client project.
- ☐ Keep both handy; below they're referred to as `$OLD` and `$NEW`:
  ```bash
  OLD="postgresql://postgres:[OLD_PW]@db.<old-ref>.supabase.co:5432/postgres"
  NEW="postgresql://postgres:[NEW_PW]@db.<new-ref>.supabase.co:5432/postgres"
  ```
  > If a direct connection refuses, use the **Session pooler** URI shown on the same
  > page (port `5432`, host `aws-0-<region>.pooler.supabase.com`). Works the same.

---

#### Option A — Supabase CLI (recommended)

**What you need + how to get it**
- ☐ **Supabase CLI installed** — `brew install supabase/tap/supabase`
  (macOS) or `npm i -g supabase`. Verify: `supabase --version`.
- ☐ **`psql`** (Postgres client) to load the dumps — `brew install libpq`
  then `brew link --force libpq` (macOS), or install the PostgreSQL package.
  Verify: `psql --version`.
- ☐ The `$OLD` and `$NEW` URIs from above.

**Steps**
```bash
# 1. Structure: tables, relations, constraints, indexes, RLS, functions
supabase db dump --db-url "$OLD" -f schema.sql

# 2. Auth logins (so the exact same users exist) — restore BEFORE data,
#    because profiles refers to auth.users
supabase db dump --db-url "$OLD" --schema auth --data-only --use-copy -f auth_users.sql

# 3. App data, exactly as-is
supabase db dump --db-url "$OLD" --data-only --use-copy -f data.sql

# 4. Restore into the client project IN THIS ORDER
psql "$NEW" -f schema.sql
psql "$NEW" -f auth_users.sql
psql "$NEW" -f data.sql
```
- ☐ Each command finishes without error (a few "already exists" notices on
  Supabase-managed objects are normal and harmless).

---

#### Option B — raw `pg_dump` (no CLI install)

**What you need + how to get it**
- ☐ **PostgreSQL client tools** (`pg_dump` + `psql`) — `brew install libpq &&
  brew link --force libpq` (macOS), or install PostgreSQL. The client major
  version should be **≥** the server's (Supabase runs PG 15). Verify:
  `pg_dump --version`.
- ☐ The `$OLD` and `$NEW` URIs from above.

**Steps**
```bash
# 1. Structure + app data of the public schema in one file
pg_dump "$OLD" --schema=public --no-owner --no-privileges -f clone.sql

# 2. Auth logins (optional but needed for the same users to exist)
pg_dump "$OLD" --schema=auth --data-only --no-owner --no-privileges -f auth_users.sql

# 3. Restore into the client project — auth users first, then everything else
psql "$NEW" -f auth_users.sql
psql "$NEW" -f clone.sql
```
- ☐ Completes without fatal errors.

> **Note:** `--schema=public` includes your tables, foreign keys, indexes, and RLS
> policies. It does **not** include the 6 edge functions (those aren't in the DB —
> see 1.4) or Supabase-managed `storage` config (you use Cloudinary, so N/A).

---

### 1.3 Fallback only — rebuild from the consolidated script
Use this **only** if you cannot get the DB connection strings (e.g. no DB
password). It is a hand-reconstruction, not a guaranteed-identical clone.
- ☐ Dashboard → **SQL Editor** → paste all of **`supabase-queries/00_full_setup.sql`**
  → **Run**. Creates 38 tables + RLS + realtime + seed (`plants`, `detector_config`,
  `tanks`, `cpm_drum_stock`). Idempotent. Then do the 1.6 admin bootstrap manually
  (no auth users are migrated in this path).

### 1.4 Verify realtime
- ☐ Database → **Replication** → `supabase_realtime`. Confirm these are ON
  (a clone usually carries publication membership, but verify): `notifications`,
  `anomaly_log`, `entity_notes`, `entity_note_receipts`, `entity_watchers`,
  `blacklist_events`, `tanks`, `cpm_drum_stock`, `alerts`, `anomaly_flags`.

### 1.5 Deploy the 6 Edge Functions
These power OCR + admin user provisioning. From the repo root:
```bash
supabase login                                  # client account
supabase link --project-ref <NEW_PROJECT_REF>
supabase functions deploy extract-daily-log
supabase functions deploy extract-sales-sheet
supabase functions deploy extract-batch-sheet
supabase functions deploy extract-supplier-bill
supabase functions deploy extract-purchase-sheet
supabase functions deploy admin-users
```
- ☐ All 6 deploy without error.

### 1.6 Set Edge Function secrets
```bash
supabase secrets set NVIDIA_API_KEY=<new client NVIDIA key>
# SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are injected
# automatically by Supabase — only set them manually if a function errors.
```
- ☐ `supabase secrets list` shows `NVIDIA_API_KEY`.

### 1.7 Bootstrap the first admin login  ·  *skip if you cloned auth users (1.2 A/B)*
If you used the **exact clone** (Option A or B), the logins already exist — skip this.
Only needed on the **fallback** path (1.3): the **first** admin must be seeded by
hand (the `admin-users` function only lets an existing admin create others):
- ☐ Authentication → Users → **Add user** (set a password, `email_confirm = true`).
- ☐ Copy that user's UUID, then in SQL Editor:
  ```sql
  insert into profiles (id, name, role, plant_id)
  values ('<auth-user-uuid>', '<Admin Name>', 'admin', null)
  on conflict (id) do update set role = 'admin', name = excluded.name;
  ```
- ☐ Log in as that admin → provision everyone else from the **User Management** page.

### 1.8 Grab the new keys (for step 4)
- ☐ Settings → API → copy **Project URL** and **anon public key**.

---

## 2. Cloudinary (simple)
- ☐ Create a Cloudinary account with the client email.
- ☐ Settings → Upload → create an **unsigned upload preset** (matches current setup).
- ☐ Note the **Cloud name** and **preset name** (for step 4).

> Folders/filenames are set in code (`uploadWorkflowImage`) — no extra config.

---

## 3. NVIDIA API (simple)
- ☐ Create an NVIDIA API key under the client account.
- ☐ It's used in **two** places — set it in both:
  - Supabase Edge Function secret `NVIDIA_API_KEY` (step 1.6) ✅ secure.
  - The frontend env `VITE_NVIDIA_API_KEY` (step 4) ⚠️ **see security note below**.

> ⚠️ **`VITE_NVIDIA_API_KEY` is bundled into the public JS** — anyone can extract it
> and spend the client's OCR credits. Recommended hardening (post-handover): route
> that one client-side OCR call through an edge function so the key stays server-side,
> then delete `VITE_NVIDIA_API_KEY`. The edge functions already do OCR securely.

---

## 4. Frontend env vars
Set these to the **new** client values, then build. (Local: `.env.production`;
on Firebase they're baked into the build; on Vercel add them in the dashboard.)

| Var | Source |
|-----|--------|
| `VITE_SUPABASE_URL` | Supabase step 1.7 |
| `VITE_SUPABASE_ANON_KEY` | Supabase step 1.7 |
| `VITE_CLOUDINARY_CLOUD_NAME` | Cloudinary step 2 |
| `VITE_CLOUDINARY_UPLOAD_PRESET` | Cloudinary step 2 |
| `VITE_NVIDIA_API_KEY` | NVIDIA step 3 |
| `VITE_BUSY_API_URL` | not needed (BUSY backend on hold) — leave unset |

- ☐ All vars point to client-owned services.

---

## 5. Hosting (Firebase — already configured)
- ☐ Create a new Firebase project under the **client** Google account.
- ☐ `firebase use --add` → select the new project (or edit `.firebaserc`).
- ☐ `npm run build`
- ☐ `firebase deploy` ← **only with explicit permission.**

> Free Spark tier covers an internal dashboard and allows commercial use.
> Alternative: Vercel (root dir `suntek-dashboard`, framework Vite, output `dist`,
> needs `vercel.json` SPA rewrite). Hobby tier is non-commercial only → Pro for prod.

---

## 6. Smoke test (functionality didn't break)
- ☐ Log in as the bootstrapped admin.
- ☐ Overview renders (tanks, CP drum stock, alerts panel) → confirms migration-origin tables.
- ☐ CPM Stock page loads the tank + drum grids.
- ☐ Create a maintenance ticket → moves through stages → confirms `maintenance_*`.
- ☐ Upload a batch/daily-log photo → OCR returns → confirms edge functions + NVIDIA secret.
- ☐ Notification bell + an @-mention update live → confirms realtime.
- ☐ Provision a second user in User Management → confirms `admin-users` function.

---

## Quick reference — what moved
| Item | Old (personal) | New (client) |
|------|----------------|--------------|
| Supabase project | — | ☐ |
| Cloudinary | — | ☐ |
| NVIDIA key | — | ☐ |
| Firebase hosting | — | ☐ |
| First admin login seeded | — | ☐ |
