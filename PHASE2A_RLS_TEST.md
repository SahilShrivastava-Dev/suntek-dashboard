# Phase 2a — RLS enforcement. How to apply + test

**What this does:** the database now *refuses* to return or accept rows outside a
user's plant/unit scope, for the 8 operational tables (maintenance_tickets,
maintenance_store_requests, store_requisitions, maintenance_schedules,
stock_levels, activity_logs, fixed_assets, labour_costs). This is the real
security boundary — it can't be bypassed via the API.

> No frontend changes are needed. The app already sends each logged-in user's
> token (RLS keys off it) and already filters with the same scope, so behaviour
> stays consistent — RLS just makes it unbypassable.

## Apply (staged, recommended)

1. **Back up nothing needed** — the rollback file restores the old behaviour instantly.
2. Run `supabase-queries/28_rls_phase2a_operational.sql` in the SQL editor. It:
   - creates the scope helper functions,
   - applies policies to **Group 1** (maintenance + store req) then **Group 2**
     (schedules, stock, activity, FAR, labour),
   - reloads the PostgREST schema cache.
   *(If you want to go one group at a time, run the functions + Group 1 block
   first, test, then run the Group 2 block.)*
3. **If anything misbehaves**, run `supabase-queries/28_rollback_rls_phase2a.sql`
   to restore full access immediately, and tell me.

## ⚠️ Test with REAL logins, not the dev bypass

RLS keys off `auth.uid()`. The dev "Enter dashboard directly" bypass has **no
session**, so under RLS it will see **empty** operational tables. That's expected
— always test by logging in as a real provisioned user.

## Test matrix (log in as each, on the deployed app or a real login)

Set up a few users in User Management first (Owner is global; give others plants/units):

| Logged in as | Maintenance / Stock / etc. should show | Create (raise a ticket / requisition) |
|---|---|---|
| **Owner / Admin** (global) | **All** plants' rows | Any plant allowed |
| **Rehla unit head** (plant = Rehla) | **Only Rehla** rows | Only Rehla; picker shows only Rehla |
| **Ganjam user** (plant = Ganjam) | **Only Ganjam** rows; **no Rehla rows at all** | Only Ganjam |
| **Chlorides store manager** (Rehla + unit=Chlorides) | Rehla rows tagged Chlorides **or** unit-less; **not** Plasticiser rows | Only Rehla/Chlorides |
| **Multi-plant user** (Rehla + Ganjam) | Rows from **both**, nothing else | Rehla or Ganjam |
| **User with no plant, not global** | **Nothing** (fail-closed) | Blocked |

### The two proofs that RLS (not just the UI) is working
1. **API bypass test:** as the Ganjam user, open DevTools → Network, find a
   `maintenance_tickets` request → its response should contain **only Ganjam
   rows**. Even hand-editing the request to drop the `plant_id` filter returns
   only Ganjam rows — because the *database* is filtering now, not the app.
2. **Cross-plant write test:** as the Rehla unit head, if a write were somehow
   sent with another plant's `plant_id`, the DB **rejects it** (WITH CHECK) — a
   store manager cannot create/import data for a store that isn't theirs.

## Verify policies are applied (SQL)
```sql
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('maintenance_tickets','maintenance_store_requests',
    'store_requisitions','maintenance_schedules','stock_levels',
    'activity_logs','fixed_assets','labour_costs')
order by tablename;
-- Expect policyname = 'scope_all' on each (NOT 'anon_all').
```

## Not in this phase (unchanged / still open)
- `notifications` + L1 shop-floor tables (batches/shifts/sessions) → Phase 2b (needs L1 login first).
- Financial tables (sales/customers/oil/marine) → Phase 2c (after back-tagging plant_id).
- Staff directory tables (user_accounts/user_plants/user_units/profiles) stay readable (needed for scope resolution + @-mentions).
