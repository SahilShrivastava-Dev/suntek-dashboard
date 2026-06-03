-- ── unit_log_entries ─────────────────────────────────────────────────────────
-- Run this once in the Supabase Dashboard SQL Editor:
--   https://supabase.com/dashboard/project/heiimxqyxthxtnxqozap/sql/new
--
-- Stores hourly Unit Daily Monitoring Log uploads (temperature, pressure,
-- density, CPW transfer, blower, flow meter readings per hour).

CREATE TABLE IF NOT EXISTS unit_log_entries (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id        UUID        REFERENCES plants(id),
  unit_name       TEXT,
  date            DATE        NOT NULL,
  shift           TEXT        DEFAULT 'Morning',    -- 'Morning' | 'Evening' | 'Night'
  operators       TEXT[],                            -- array of operator names
  helper_name     TEXT,
  readings        JSONB       NOT NULL DEFAULT '[]', -- array of DailyLogReading objects
  tank_summaries  JSONB       NOT NULL DEFAULT '[]', -- array of DailyLogTankSummary objects
  remarks         TEXT,
  notes           JSONB       DEFAULT '{}',          -- { hnpTank, hclTank, other }
  uploaded_by     TEXT,
  uploaded_at     TIMESTAMPTZ DEFAULT now(),
  raw_extraction  JSONB                              -- full AI output (for audit / re-processing)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_unit_log_date   ON unit_log_entries(date DESC);
CREATE INDEX IF NOT EXISTS idx_unit_log_plant  ON unit_log_entries(plant_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_unit_log_shift  ON unit_log_entries(shift);

-- RLS
ALTER TABLE unit_log_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All can read unit logs"
  ON unit_log_entries FOR SELECT USING (true);

CREATE POLICY "All can insert unit logs"
  ON unit_log_entries FOR INSERT WITH CHECK (true);

CREATE POLICY "All can update unit logs"
  ON unit_log_entries FOR UPDATE USING (true);
