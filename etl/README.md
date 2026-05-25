# Suntek ETL Pipeline

Python scripts to import Excel data into Supabase (Phase 2).

## Setup

```bash
# Create a virtual environment
python -m venv venv
source venv/bin/activate  # Mac/Linux

# Install dependencies
pip install pandas openpyxl supabase python-dotenv
```

## Configuration

Create `etl/.env` (never commit this file):

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key-here
```

Get these from: Supabase Dashboard → Project Settings → API
Use the **service_role** key (not anon key) for ETL operations.

## Running the scripts

Run in order:

```bash
cd etl/

# 1. Import CP Stock data
python 01_import_stock.py

# 2. Import Sales data  
python 02_import_sales.py

# 3. Import Purchase data
python 03_import_purchase.py

# 4. Seed Oil Ratio table (verify values from PDF first!)
python seed_oil_ratio.py
```

## Data Sources

| Script | Source File | Target Tables |
|--------|------------|--------------|
| `01_import_stock.py` | `CP and Stock 2026-27.xlsx` | `stock_levels`, `oil_contracts` |
| `02_import_sales.py` | `Sales Report 26-27.xlsx` | `customers`, `sales_contracts`, `sales_ledger` |
| `03_import_purchase.py` | `Purchase 2026-27.xlsx` | `store_requisitions`, `dispatch_logs` |
| `seed_oil_ratio.py` | `Oil Ratio Suntek.pdf` (manual) | `oil_ratio_table` |

## Notes

- **Idempotency**: Scripts are NOT idempotent by default — running twice will create duplicate records. Add `upsert` logic or truncate tables first.
- **Plant IDs**: Stock records need `plant_id` resolved against the `plants` table. Seed plants first via the Supabase dashboard or a seed script.
- **Oil Ratio**: The `seed_oil_ratio.py` values are approximations. Verify against the actual PDF and update before production use.
