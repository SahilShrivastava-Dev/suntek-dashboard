-- ============================================================================
-- Suntek Operations Dashboard — Supabase PostgreSQL Schema
-- Run this in Supabase Dashboard → SQL Editor to create all tables.
-- ============================================================================

-- ── Enable UUID extension ────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Core Auth ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS plants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL UNIQUE,
  lat               FLOAT,
  lng               FLOAT,
  geofence_radius_m INT DEFAULT 200,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('L1','L2','L3','L4')) DEFAULT 'L1',
  plant_id    UUID REFERENCES plants(id),
  name        TEXT NOT NULL,
  phone       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── Production & Stock ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_levels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id    UUID REFERENCES plants(id),
  density     INT NOT NULL,
  product     TEXT NOT NULL,
  quantity    FLOAT NOT NULL DEFAULT 0,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS drum_inventory (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id       UUID REFERENCES plants(id),
  density        INT NOT NULL,
  opening        INT NOT NULL DEFAULT 0,
  physical_count INT,
  date           DATE NOT NULL DEFAULT CURRENT_DATE,
  submitted_by   UUID REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS oil_ratio_table (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gravity         INT NOT NULL UNIQUE,
  np_ratio        FLOAT NOT NULL,
  waxol_ratio     FLOAT NOT NULL,
  cl2_consumption FLOAT NOT NULL,
  hcl_output      FLOAT NOT NULL
);

CREATE TABLE IF NOT EXISTS active_batches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id        UUID REFERENCES plants(id),
  batch_no        TEXT NOT NULL,
  recipe          TEXT,
  target_qty      FLOAT,
  operator_id     UUID REFERENCES profiles(id),
  status          TEXT NOT NULL CHECK (status IN ('active','closed','flagged')) DEFAULT 'active',
  started_at      TIMESTAMPTZ DEFAULT now(),
  closed_at       TIMESTAMPTZ,
  final_gravity   INT,
  total_drums     INT,
  paraffin_weight FLOAT,
  hcl_quantity    FLOAT
);

CREATE TABLE IF NOT EXISTS batch_readings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          UUID NOT NULL REFERENCES active_batches(id) ON DELETE CASCADE,
  timestamp         TIMESTAMPTZ NOT NULL DEFAULT now(),
  temp              FLOAT,
  cp_gravity        FLOAT,
  cl2_pressure      FLOAT,
  hcl_gravity       FLOAT,
  cl2_pipe_pressure FLOAT,
  operator_id       UUID REFERENCES profiles(id)
);

-- ── Night Manager ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shift_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID REFERENCES profiles(id),
  plant_id     UUID REFERENCES plants(id),
  photo_url    TEXT,
  lat          FLOAT,
  lng          FLOAT,
  is_on_site   BOOLEAN NOT NULL DEFAULT false,
  distance_m   INT,
  ip_address   TEXT,
  submitted_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_mappings (
  ip_address TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  department TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Sales ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL UNIQUE,
  place             TEXT,
  preferred_density INT,
  outstanding       FLOAT DEFAULT 0,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_contracts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID NOT NULL REFERENCES customers(id),
  density        INT,
  locked_price   FLOAT NOT NULL DEFAULT 0,
  booked_qty     FLOAT NOT NULL DEFAULT 0,
  dispatched_qty FLOAT NOT NULL DEFAULT 0,
  status         TEXT NOT NULL CHECK (status IN ('open','fulfilled','partial')) DEFAULT 'open',
  location       TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_ledger (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID NOT NULL REFERENCES customers(id),
  date         DATE NOT NULL,
  invoice_no   TEXT,
  qty          FLOAT,
  value        FLOAT,
  transporter  TEXT,
  vehicle_no   TEXT,
  density      INT,
  location     TEXT
);

-- ── Purchase ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS store_requisitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item        TEXT NOT NULL,
  plant_id    UUID REFERENCES plants(id),
  qty         FLOAT NOT NULL DEFAULT 1,
  urgency     TEXT CHECK (urgency IN ('low','medium','high','plant_stopper')) DEFAULT 'medium',
  status      TEXT CHECK (status IN ('pending','approved','dispatched','received','rejected')) DEFAULT 'pending',
  raised_by   UUID REFERENCES profiles(id),
  approved_by UUID REFERENCES profiles(id),
  photo_url   TEXT,
  remarks     TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fixed_assets (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id             UUID REFERENCES plants(id),
  name                 TEXT NOT NULL,
  identification_mark  TEXT,
  model                TEXT,
  capacity             TEXT,
  origin               TEXT,
  year                 INT,
  value                FLOAT,
  invoice_no           TEXT,
  purchase_date        DATE,
  account_head         TEXT,
  photo_url            TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS maintenance_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id   UUID REFERENCES plants(id),
  asset_id   UUID REFERENCES fixed_assets(id),
  date       DATE NOT NULL DEFAULT CURRENT_DATE,
  equipment  TEXT NOT NULL,
  issue      TEXT,
  action     TEXT,
  type       TEXT CHECK (type IN ('regular','repair','scrap')) DEFAULT 'regular',
  status     TEXT CHECK (status IN ('open','closed')) DEFAULT 'open',
  done_by    TEXT,
  photo_url  TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id    UUID REFERENCES plants(id),
  type        TEXT,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  done_by     TEXT,
  verified_by TEXT,
  photo_url   TEXT,
  equipment   TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marine_insurance (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date       DATE NOT NULL DEFAULT CURRENT_DATE,
  type       TEXT CHECK (type IN ('top_up','deduction')),
  reference  TEXT,
  amount     FLOAT NOT NULL,
  balance    FLOAT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dispatch_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination   TEXT,
  date          DATE,
  item          TEXT,
  document_ref  TEXT,
  vehicle_no    TEXT,
  sender        TEXT,
  receiver      TEXT,
  from_location TEXT,
  supplier      TEXT,
  receive_date  DATE,
  remarks       TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_stock_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id     UUID REFERENCES plants(id),
  date         DATE NOT NULL DEFAULT CURRENT_DATE,
  tank_name    TEXT NOT NULL,
  level_pct    FLOAT NOT NULL,
  submitted_by UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS labour_costs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id       UUID REFERENCES plants(id),
  date           DATE NOT NULL DEFAULT CURRENT_DATE,
  purchased_qty  FLOAT NOT NULL DEFAULT 0,
  sales_qty      FLOAT NOT NULL DEFAULT 0,
  computed_cost  FLOAT NOT NULL DEFAULT 0,
  target_cost    FLOAT NOT NULL DEFAULT 0,
  per_mt_cost    FLOAT NOT NULL DEFAULT 0,
  variance_pct   FLOAT NOT NULL DEFAULT 0,
  is_flagged     BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS oil_contracts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oil_type       TEXT,
  date           DATE,
  company        TEXT,
  paraffin_type  TEXT,
  port           TEXT,
  lifting_cycle  TEXT,
  price          FLOAT,
  book_qty_mt    FLOAT,
  dispatched_qty FLOAT,
  pending_qty    FLOAT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- ── Row Level Security (RLS) ──────────────────────────────────────────────────

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE plants ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE drum_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE oil_ratio_table ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE marine_insurance ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_stock_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE oil_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_mappings ENABLE ROW LEVEL SECURITY;

-- Helper function to get the current user's role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER;

-- ── RLS Policies ──────────────────────────────────────────────────────────────

-- PROFILES: Users can read their own profile; L4 can read all
CREATE POLICY "Users see own profile" ON profiles
  FOR SELECT USING (id = auth.uid() OR get_user_role() IN ('L3','L4'));

CREATE POLICY "L4 can manage all profiles" ON profiles
  FOR ALL USING (get_user_role() = 'L4');

-- PLANTS: All authenticated users can read; only L4 can modify
CREATE POLICY "All authenticated users can read plants" ON plants
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "L4 can manage plants" ON plants
  FOR ALL USING (get_user_role() = 'L4');

-- STOCK LEVELS: All authenticated users can read; L2+ can write
CREATE POLICY "All can read stock" ON stock_levels
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "L2+ can write stock" ON stock_levels
  FOR INSERT WITH CHECK (get_user_role() IN ('L2','L3','L4'));

-- OIL RATIO TABLE: All authenticated users can read; L4 manages
CREATE POLICY "All can read oil ratios" ON oil_ratio_table
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ACTIVE BATCHES: L1 operators can see their own plant's batches; L2+ see all
CREATE POLICY "L1 sees own plant batches" ON active_batches
  FOR SELECT USING (true); -- Relaxed for prototyping

CREATE POLICY "L1 can insert batch readings" ON active_batches
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- BATCH READINGS: Same scoping as batches
CREATE POLICY "L1 can log readings" ON batch_readings
  FOR INSERT WITH CHECK (true); -- Relaxed for prototyping (originally: auth.uid() IS NOT NULL)

CREATE POLICY "All can read batch readings" ON batch_readings
  FOR SELECT USING (true); -- Relaxed for prototyping

-- SHIFT LOGS: L1 inserts their own; L2+ read all
CREATE POLICY "L1 can log own check-in" ON shift_logs
  FOR INSERT WITH CHECK (true); -- Relaxed for prototyping (originally: employee_id = auth.uid())

CREATE POLICY "L2+ can view all check-ins" ON shift_logs
  FOR SELECT USING (true); -- Relaxed for prototyping

-- DEVICE MAPPINGS: All can read and write for prototyping
CREATE POLICY "All can read device mappings" ON device_mappings
  FOR SELECT USING (true);
CREATE POLICY "All can write device mappings" ON device_mappings
  FOR INSERT WITH CHECK (true);
CREATE POLICY "All can update device mappings" ON device_mappings
  FOR UPDATE USING (true);

-- SALES & CUSTOMERS: All authenticated can read; L3+ can modify
CREATE POLICY "All can read customers" ON customers
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "All can read sales contracts" ON sales_contracts
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "All can read sales ledger" ON sales_ledger
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- STORE REQUISITIONS: L1 can create; L2+ can approve; all can read
CREATE POLICY "L1 can raise requisitions" ON store_requisitions
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "All can read requisitions" ON store_requisitions
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "L2+ can update requisitions" ON store_requisitions
  FOR UPDATE USING (get_user_role() IN ('L2','L3','L4'));

-- MARINE INSURANCE: L4 only (financial)
CREATE POLICY "L4 only sees marine insurance" ON marine_insurance
  FOR ALL USING (get_user_role() = 'L4');

-- DAILY STOCK: L1 can insert for their plant; L2+ read all
CREATE POLICY "L1 can submit daily stock" ON daily_stock_entries
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "L2+ can read all stock entries" ON daily_stock_entries
  FOR SELECT USING (
    submitted_by = auth.uid() OR get_user_role() IN ('L2','L3','L4')
  );

-- LABOUR COSTS: L3+ financial data
CREATE POLICY "L3+ can read labour costs" ON labour_costs
  FOR SELECT USING (get_user_role() IN ('L3','L4'));

-- All other tables: authenticated read, L4 manage
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['fixed_assets','maintenance_logs','activity_logs','dispatch_logs','oil_contracts']
  LOOP
    EXECUTE format('CREATE POLICY "All auth can read %I" ON %I FOR SELECT USING (auth.uid() IS NOT NULL)', t, t);
    EXECUTE format('CREATE POLICY "L2+ can manage %I" ON %I FOR ALL USING (get_user_role() IN (''L2'',''L3'',''L4''))', t, t);
  END LOOP;
END $$;

-- ── Seed Plants ───────────────────────────────────────────────────────────────
-- Update GPS coordinates after getting them from Sagar / ground team
INSERT INTO plants (name, lat, lng, geofence_radius_m) VALUES
  ('SCPL Delhi',  28.7041, 77.1025, 300),   -- TODO: replace with actual coordinates
  ('SPPL',        23.0225, 72.5714, 200),   -- TODO: replace with actual coordinates
  ('K.G',         25.5941, 85.1376, 200),   -- TODO: replace with actual coordinates
  ('Madan',       28.4089, 77.3178, 200),   -- TODO: replace with actual coordinates
  ('SCPL Odisha', 20.2961, 85.8245, 300)    -- TODO: replace with actual coordinates
ON CONFLICT (name) DO NOTHING;

-- ── Indexes for performance ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_stock_levels_plant_density ON stock_levels(plant_id, density);
CREATE INDEX IF NOT EXISTS idx_stock_levels_date ON stock_levels(date DESC);
CREATE INDEX IF NOT EXISTS idx_batch_readings_batch ON batch_readings(batch_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_shift_logs_employee ON shift_logs(employee_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_ledger_customer ON sales_ledger(customer_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_store_req_status ON store_requisitions(status, created_at DESC);

-- ── Batch Logger Caching & Auditing ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS operator_sessions (
  ip_address           TEXT PRIMARY KEY,
  selected_batch       TEXT,
  temp_input           TEXT,
  cp_gravity_input     TEXT,
  cl2_press_input      TEXT,
  active_tab           TEXT,
  new_batch_no_input   TEXT,
  new_recipe_input     TEXT,
  new_target_qty_input TEXT,
  last_active          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batch_edit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address  TEXT,
  batch_no    TEXT NOT NULL,
  action_type TEXT NOT NULL, -- 'create_batch', 'log_reading'
  details     JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE operator_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_edit_logs ENABLE ROW LEVEL SECURITY;

-- Add RLS Policies so all clients can read and write for prototyping
CREATE POLICY "All can read sessions" ON operator_sessions FOR SELECT USING (true);
CREATE POLICY "All can insert sessions" ON operator_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "All can update sessions" ON operator_sessions FOR UPDATE USING (true);

CREATE POLICY "All can read edit logs" ON batch_edit_logs FOR SELECT USING (true);
CREATE POLICY "All can insert edit logs" ON batch_edit_logs FOR INSERT WITH CHECK (true);

