"""
ETL Script 03: Import Purchase 2026-27.xlsx → Supabase tables
=============================================================
Populates: store_requisitions, dispatch_logs

Usage:
  pip install pandas openpyxl supabase python-dotenv
  python etl/03_import_purchase.py
"""

import os
import sys
from pathlib import Path
from datetime import date

try:
    import pandas as pd
    from supabase import create_client
    from dotenv import load_dotenv
except ImportError:
    print("Missing dependencies. Run: pip install pandas openpyxl supabase python-dotenv")
    sys.exit(1)

load_dotenv(Path(__file__).parent / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
DATA_DIR = Path(__file__).parent.parent.parent / "Data"
PURCHASE_FILE = DATA_DIR / "Purchase 2026-27.xlsx"
TODAY = date.today().isoformat()


def safe_str(val) -> str | None:
    if pd.isna(val):
        return None
    s = str(val).strip()
    return s if s and s != 'nan' else None


def safe_float(val) -> float | None:
    try:
        if pd.isna(val):
            return None
        return float(str(val).replace(',', '').strip())
    except (ValueError, TypeError):
        return None


def map_urgency(text: str | None) -> str:
    if not text:
        return 'medium'
    t = text.lower()
    if 'plant stopper' in t or 'urgent' in t:
        return 'plant_stopper'
    if 'high' in t:
        return 'high'
    if 'low' in t:
        return 'low'
    return 'medium'


def map_status(text: str | None) -> str:
    if not text:
        return 'pending'
    t = text.lower()
    if 'received' in t or 'receipt' in t:
        return 'received'
    if 'dispatch' in t:
        return 'dispatched'
    if 'approv' in t:
        return 'approved'
    return 'pending'


def process_requirements(df: pd.DataFrame) -> list[dict]:
    """Extract store requisitions from the Requirements sheet."""
    records = []

    for _, row in df.iterrows():
        try:
            item = safe_str(row.iloc[0])
            if not item or item in ('Item', 'Requirement', 'Material', 'ITEM'):
                continue

            qty = safe_float(row.iloc[2] if len(row) > 2 else None)
            plant = safe_str(row.iloc[1] if len(row) > 1 else None)

            # Look for status columns
            status_text = safe_str(row.iloc[3] if len(row) > 3 else None)
            remarks = safe_str(row.iloc[-1]) if len(row) > 4 else None

            records.append({
                "item": item,
                "plant_id": None,       # Resolve after plants are seeded
                "plant_name": plant,    # Temp
                "qty": qty or 1,
                "urgency": map_urgency(status_text),
                "status": map_status(status_text),
                "raised_by": None,
                "approved_by": None,
                "photo_url": None,
                "remarks": remarks,
            })
        except (IndexError, Exception):
            pass

    return records


def process_dispatch(df: pd.DataFrame) -> list[dict]:
    """Extract dispatch log records."""
    records = []

    for _, row in df.iterrows():
        try:
            destination = safe_str(row.iloc[0])
            if not destination or destination in ('Destination', 'To', 'DESTINATION'):
                continue

            records.append({
                "destination": destination,
                "date": safe_str(row.iloc[1]) or TODAY,
                "item": safe_str(row.iloc[2] if len(row) > 2 else None),
                "document_ref": safe_str(row.iloc[3] if len(row) > 3 else None),
                "from_location": safe_str(row.iloc[4] if len(row) > 4 else None),
                "supplier": safe_str(row.iloc[5] if len(row) > 5 else None),
                "vehicle_no": safe_str(row.iloc[7] if len(row) > 7 else None),
                "sender": safe_str(row.iloc[6] if len(row) > 6 else None),
                "receiver": safe_str(row.iloc[8] if len(row) > 8 else None),
                "receive_date": safe_str(row.iloc[9] if len(row) > 9 else None),
                "remarks": safe_str(row.iloc[10] if len(row) > 10 else None),
            })
        except (IndexError, Exception):
            pass

    return records


def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ Missing Supabase credentials in etl/.env")
        sys.exit(1)

    if not PURCHASE_FILE.exists():
        print(f"❌ File not found: {PURCHASE_FILE}")
        sys.exit(1)

    print(f"📂 Reading {PURCHASE_FILE.name}...")
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    xl = pd.ExcelFile(PURCHASE_FILE)
    print(f"   Sheets found: {xl.sheet_names}")

    # ── Requirements → store_requisitions ─────────────────────────────────────
    if "Requirements" in xl.sheet_names:
        print("\n📋 Processing Requirements sheet...")
        df = pd.read_excel(PURCHASE_FILE, sheet_name="Requirements", header=0)
        reqs = process_requirements(df)
        # Remove temp fields
        for r in reqs:
            r.pop("plant_name", None)
        print(f"   Found {len(reqs)} requisitions")

        if reqs:
            print(f"⬆️  Inserting {len(reqs)} store requisitions...")
            for i in range(0, len(reqs), 500):
                batch = reqs[i:i + 500]
                supabase.table("store_requisitions").insert(batch).execute()
                print(f"   ✓ Batch {i//500 + 1}")

    # ── Dispatch → dispatch_logs ───────────────────────────────────────────────
    if "Dispatch" in xl.sheet_names:
        print("\n📋 Processing Dispatch sheet...")
        df = pd.read_excel(PURCHASE_FILE, sheet_name="Dispatch", header=0)
        dispatches = process_dispatch(df)
        print(f"   Found {len(dispatches)} dispatch records")

        if dispatches:
            print(f"⬆️  Inserting {len(dispatches)} dispatch logs...")
            for i in range(0, len(dispatches), 500):
                batch = dispatches[i:i + 500]
                supabase.table("dispatch_logs").insert(batch).execute()
                print(f"   ✓ Batch {i//500 + 1}")

    print("\n✅ Purchase import complete!")


if __name__ == "__main__":
    main()
