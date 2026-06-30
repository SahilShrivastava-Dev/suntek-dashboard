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

### 1.2 Create the schema — one paste
- ☐ Dashboard → **SQL Editor** → New query.
- ☐ Paste the entire contents of **`supabase-queries/00_full_setup.sql`** → **Run**.
- ☐ Confirm "Success". This creates **38 tables**, all foreign keys, RLS policies,
  indexes, realtime, and seeds `plants`, `detector_config`, `tanks`, `cpm_drum_stock`.

> `00_full_setup.sql` is the reconciliation of all 24 `supabase-queries/` files
> **plus** 5 tables that previously lived only in `supabase/migrations/`
> (`tanks`, `cpm_drum_stock`, `alerts`, `operator_sessions`, `anomaly_flags`).
> It is idempotent — safe to re-run. Do **not** also run the individual files.

### 1.3 Verify realtime
- ☐ Database → **Replication** → `supabase_realtime`. Confirm these are ON
  (the script adds them, but verify): `notifications`, `anomaly_log`,
  `entity_notes`, `entity_note_receipts`, `entity_watchers`, `blacklist_events`,
  `tanks`, `cpm_drum_stock`, `alerts`, `anomaly_flags`.

### 1.4 Deploy the 6 Edge Functions
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

### 1.5 Set Edge Function secrets
```bash
supabase secrets set NVIDIA_API_KEY=<new client NVIDIA key>
# SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are injected
# automatically by Supabase — only set them manually if a function errors.
```
- ☐ `supabase secrets list` shows `NVIDIA_API_KEY`.

### 1.6 Bootstrap the first admin login
Real logins are provisioned in-app by an admin, but the **first** admin must be
seeded by hand (the `admin-users` function only lets an existing admin create others):
- ☐ Authentication → Users → **Add user** (set a password, `email_confirm = true`).
- ☐ Copy that user's UUID, then in SQL Editor:
  ```sql
  insert into profiles (id, name, role, plant_id)
  values ('<auth-user-uuid>', '<Admin Name>', 'admin', null)
  on conflict (id) do update set role = 'admin', name = excluded.name;
  ```
- ☐ Log in as that admin → provision everyone else from the **User Management** page.

### 1.7 Grab the new keys (for step 4)
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
  - Supabase Edge Function secret `NVIDIA_API_KEY` (step 1.5) ✅ secure.
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
