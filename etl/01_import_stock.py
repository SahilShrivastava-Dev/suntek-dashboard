"""
ETL Script 01: Import CP and Stock 2026-27.xlsx → Supabase stock_levels table
=============================================================================
Run this script once to seed the database with real stock data from Excel.

Usage:
  pip install openpyxl supabase pandas
  python etl/01_import_stock.py

Configure your Supabase credentials in etl/.env before running.
"""

import os
import sys
import json
from datetime import date
from pathlib import Path

try:
    import pandas as pd
    from supabase import create_client
    from dotenv import load_dotenv
except ImportError:
    print("Missing dependencies. Run: pip install pandas openpyxl supabase python-dotenv")
    sys.exit(1)

# ── Configuration ──────────────────────────────────────────────────────────────

load_dotenv(Path(__file__).parent / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")  # Use service key for ETL
DATA_DIR = Path(__file__).parent.parent.parent / "Data"
STOCK_FILE = DATA_DIR / "CP and Stock 2026-27.xlsx"

# Mapping: Excel sheet name → plant name in our database
PLANT_SHEET_MAP = {
    "SCPL":       "SCPL Delhi",
    "SPPL":       "SPPL",
    "K.G":        "K.G",
    "Madan":      "Madan",
    "Madan 2":    "Madan",       # Merges into Madan
    "Scpl Odisha": "SCPL Odisha",
    "DRUM PLANT": "SCPL Delhi",  # Drum plant associated with SCPL Delhi
}

# Densities to look for in column headers
DENSITY_COLUMNS = [
    1100, 1150, 1190, 1200, 1210, 1240, 1250,
    1280, 1290, 1300, 1320, 1330, 1340, 1350,
    1380, 1390, 1400, 1410, 1420, 1450, 1480, 1500
]

TODAY = date.today().isoformat()


def extract_densities_from_row(df: pd.DataFrame) -> dict[str, int]:
    """Find columns that represent density grades."""
    density_cols = {}
    for col in df.columns:
        col_str = str(col).strip().replace(',', '').replace(' ', '')
        try:
            val = int(float(col_str))
            if 1000 <= val <= 2000:  # Reasonable density range
                density_cols[col] = val
        except (ValueError, TypeError):
            pass
    return density_cols


def process_stock_sheet(df: pd.DataFrame, plant_name: str) -> list[dict]:
    """Extract stock records from a sheet."""
    records = []
    density_cols = extract_densities_from_row(df)

    if not density_cols:
        print(f"  ⚠ No density columns found for {plant_name}")
        return records

    # Find data rows (skip header rows, look for numeric date values or product names)
    product_col = df.columns[0] if len(df.columns) > 0 else None

    for _, row in df.iterrows():
        if product_col is None:
            continue

        product_name = str(row[product_col]).strip()

        # Skip empty rows and header rows
        if not product_name or product_name in ('nan', 'None', 'Total', 'TOTAL'):
            continue

        # Skip rows that are clearly header labels
        if product_name.upper() in ('DATE', 'DENSITY', 'PRODUCT', 'ITEM'):
            continue

        for col, density in density_cols.items():
            try:
                qty_raw = row[col]
                if pd.isna(qty_raw):
                    continue
                qty = float(str(qty_raw).replace(',', '').strip())
                if qty > 0:
                    records.append({
                        "plant_id": None,       # Will be resolved to UUID after plants are seeded
                        "plant_name": plant_name,  # Temp field for reference
                        "density": density,
                        "product": product_name,
                        "quantity": qty,
                        "date": TODAY,
                    })
            except (ValueError, TypeError):
                pass

    return records


def process_oil_contracts(df: pd.DataFrame) -> list[dict]:
    """Extract oil contract records."""
    records = []

    # Expected columns: OIL, Date, Company, Paraffin Type, PORT, LIFTING CYCLE,
    #                   BREAKDOWN, Price, Book Qty (MT), Dispatched Qty, Pending Qty (MT)
    for _, row in df.iterrows():
        try:
            record = {
                "oil_type": str(row.iloc[0]).strip() if not pd.isna(row.iloc[0]) else None,
                "date": str(row.iloc[1]).strip() if not pd.isna(row.iloc[1]) else None,
                "company": str(row.iloc[2]).strip() if not pd.isna(row.iloc[2]) else None,
                "paraffin_type": str(row.iloc[3]).strip() if not pd.isna(row.iloc[3]) else None,
                "port": str(row.iloc[4]).strip() if not pd.isna(row.iloc[4]) else None,
                "lifting_cycle": str(row.iloc[5]).strip() if not pd.isna(row.iloc[5]) else None,
                "price": float(row.iloc[7]) if not pd.isna(row.iloc[7]) else None,
                "book_qty_mt": float(row.iloc[8]) if not pd.isna(row.iloc[8]) else None,
                "dispatched_qty": float(row.iloc[9]) if not pd.isna(row.iloc[9]) else None,
                "pending_qty": float(row.iloc[10]) if not pd.isna(row.iloc[10]) else None,
            }
            # Skip empty rows
            if record["company"] and record["company"] not in ('nan', 'None', 'Company'):
                records.append(record)
        except (IndexError, ValueError):
            pass

    return records


def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in etl/.env")
        print("   Create etl/.env with:\n   SUPABASE_URL=https://xxx.supabase.co")
        print("   SUPABASE_SERVICE_KEY=your-service-role-key")
        sys.exit(1)

    if not STOCK_FILE.exists():
        print(f"❌ File not found: {STOCK_FILE}")
        sys.exit(1)

    print(f"📂 Reading {STOCK_FILE.name}...")
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    all_stock_records = []
    oil_contract_records = []

    xl = pd.ExcelFile(STOCK_FILE)
    print(f"   Sheets found: {xl.sheet_names}")

    for sheet_name in xl.sheet_names:
        if sheet_name in PLANT_SHEET_MAP:
            plant_name = PLANT_SHEET_MAP[sheet_name]
            print(f"\n📋 Processing sheet: {sheet_name} → {plant_name}")
            df = pd.read_excel(STOCK_FILE, sheet_name=sheet_name, header=0)
            records = process_stock_sheet(df, plant_name)
            print(f"   Found {len(records)} stock entries")
            all_stock_records.extend(records)

        elif sheet_name == "Oil Contracts":
            print(f"\n📋 Processing sheet: {sheet_name}")
            df = pd.read_excel(STOCK_FILE, sheet_name=sheet_name, header=0)
            oil_contract_records = process_oil_contracts(df)
            print(f"   Found {len(oil_contract_records)} oil contracts")

    # ── Insert stock_levels ────────────────────────────────────────────────────
    if all_stock_records:
        print(f"\n⬆️  Inserting {len(all_stock_records)} stock records into Supabase...")

        # Remove temp plant_name field before insert
        for r in all_stock_records:
            r.pop("plant_name", None)

        # Batch insert (Supabase has 1000 row limit per request)
        batch_size = 500
        for i in range(0, len(all_stock_records), batch_size):
            batch = all_stock_records[i:i + batch_size]
            result = supabase.table("stock_levels").insert(batch).execute()
            print(f"   ✓ Inserted batch {i//batch_size + 1} ({len(batch)} rows)")

    # ── Insert oil_contracts ───────────────────────────────────────────────────
    if oil_contract_records:
        print(f"\n⬆️  Inserting {len(oil_contract_records)} oil contracts...")
        result = supabase.table("oil_contracts").insert(oil_contract_records).execute()
        print(f"   ✓ Inserted {len(oil_contract_records)} oil contracts")

    print("\n✅ Stock import complete!")
    print(f"   Total stock records: {len(all_stock_records)}")
    print(f"   Total oil contracts: {len(oil_contract_records)}")


if __name__ == "__main__":
    main()
