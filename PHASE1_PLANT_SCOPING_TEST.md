# Phase 1 — Plant → Unit Scoping (app-layer). Test guide

**What this is:** the visible/testable half of data isolation. The app now carries
each user's plant/unit scope and filters what they see, where records get stamped,
and who gets notified. **Security note:** this is NOT yet enforced in the DB (Phase 2
/ RLS). Until then a technical user could bypass the UI via the API — Phase 2 closes
that. Phase 1 is for demoing correct behaviour.

## 0. One-time setup (run these first)

1. **Run the migration** in the Supabase SQL editor:
   `supabase-queries/27_plant_unit_scoping.sql`
   - Adds `units`, `user_plants`, `user_units`, `user_accounts.is_global`,
     `notifications.plant_id/unit_id`, `unit_id` on maintenance_tickets +
     store_requisitions, `plant_id` on the financial tables, and backfills.
   - Seeds Rehla's **Chlorides** + **Plasticiser** units. Add/rename units for your
     real org via SQL or the User Management scope picker's plant selection.
2. Log in as a **real admin** (not the dev "Enter dashboard" bypass — global users
   see everything, which hides scoping).
3. In **User Management**, create/edit a few test users and assign scope:
   - A **plant-only** user (e.g. tick only *Ganjam*).
   - A **multi-plant** user (tick *Rehla* + *Ganjam*) — the "Pankaj" case.
   - A **unit-restricted** user (tick *Rehla*, then tick only *Chlorides*).
   - A **global** user (flip the *All plants* toggle) — e.g. Delhi accountant.

## 1. Data isolation (read scoping)

| Test | Expected |
|---|---|
| Log in as the *Ganjam* user → Maintenance, Store Req, Stock, Activity Log, FAR, Labour | Only **Ganjam** rows appear; Rehla/SHD rows are absent |
| Log in as the multi-plant user | Rows from **both** their plants, nothing else |
| Unit-restricted (Chlorides) user → Maintenance | Only Rehla tickets tagged **Chlorides** (plus unit-less Rehla tickets); Plasticiser tickets hidden |
| Global user | Sees **all** plants everywhere (unchanged from today) |

## 2. Create stamping / picker restriction

| Test | Expected |
|---|---|
| Ganjam user raises a maintenance ticket | Plant dropdown offers **only Ganjam**; ticket saved with its plant (and unit_id if a unit chosen) |
| Ganjam user raises a store requisition | Plant dropdown offers **only Ganjam** |
| Global user creates either | All plants selectable |

## 3. Routing / notifications (the "goes to that plant only" rule)

| Test | Expected |
|---|---|
| Rehla worker raises a ticket → check the two **unit heads** (one Rehla, one other plant) | Only the **Rehla** unit head is notified; the other plant's unit head is **not** |
| Chlorides ticket needs a part → store request | Only the **Chlorides** store manager (same plant) is notified, not Plasticiser |
| Any mid-workflow step (store decision, unit-head approve/reject, procurement, bill, handover, close) | Notifications reach only same-plant/unit people + global (admin) |

## Known Phase-1 limits (by design; addressed later)

- **Not secure yet** — enforcement is app-layer only; Phase 2 adds RLS.
- **Sales / Customers KPIs come from the external BUSY database**, not Supabase, so
  plant-scoping those figures needs the BUSY query layer (separate task). The
  Supabase financial tables now have `plant_id` (schema-ready) but existing rows are
  untagged → visible to global accountants only until tagged.
- **Other create forms** (Activity Log, CPM Stock, FAR, Labour, Purchase Orders,
  Marine Insurance) are **read-scoped**, but their plant pickers are not yet
  restricted to the user's plants — quick follow-up.
- **"View as" preview** doesn't simulate plant scope (admins are global and see all).
