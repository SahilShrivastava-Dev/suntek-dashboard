"""
ETL Script 02: Import Sales Report 26-27.xlsx → Supabase tables
================================================================
Populates: customers, sales_contracts, sales_ledger, production_stats

Usage:
  pip install pandas openpyxl supabase python-dotenv
  python etl/02_import_sales.py
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
SALES_FILE = DATA_DIR / "Sales Report 26-27.xlsx"
TODAY = date.today().isoformat()


def safe_float(val) -> float | None:
    try:
        if pd.isna(val):
            return None
        return float(str(val).replace(',', '').strip())
    except (ValueError, TypeError):
        return None


def safe_str(val) -> str | None:
    if pd.isna(val):
        return None
    s = str(val).strip()
    return s if s and s != 'nan' else None


def process_sales_ledger(df: pd.DataFrame) -> tuple[list, list]:
    """Extract customers and sales ledger from main sales sheet."""
    customers: dict[str, dict] = {}
    ledger_records = []

    for _, row in df.iterrows():
        # Expected: Company, Date, Invoice No., Party Name, Place, Item, QTY, Invoice Value,
        #           Transporter, Freight, Vehicle No., Receiving date
        try:
            party = safe_str(row.iloc[3]) or safe_str(row.iloc[0])  # Party Name or Company
            if not party or party in ('Party Name', 'Customer', 'PARTY NAME'):
                continue

            # Build customer record
            place = safe_str(row.iloc[4]) if len(row) > 4 else None
            if party not in customers:
                customers[party] = {
                    "name": party,
                    "place": place,
                    "preferred_density": None,
                    "outstanding": 0,
                    "is_active": True,
                }

            # Build ledger record
            date_val = safe_str(row.iloc[1])
            invoice_no = safe_str(row.iloc[2])
            qty = safe_float(row.iloc[6]) if len(row) > 6 else None
            value = safe_float(row.iloc[7]) if len(row) > 7 else None
            transporter = safe_str(row.iloc[8]) if len(row) > 8 else None
            vehicle_no = safe_str(row.iloc[10]) if len(row) > 10 else None

            if qty and value and qty > 0:
                ledger_records.append({
                    "customer_name": party,  # Temp — resolved to customer_id after insert
                    "date": date_val or TODAY,
                    "invoice_no": invoice_no,
                    "qty": qty,
                    "value": value,
                    "transporter": transporter,
                    "vehicle_no": vehicle_no,
                    "density": None,
                    "location": place,
                })
        except (IndexError, Exception):
            pass

    return list(customers.values()), ledger_records


def process_sales_contracts(df: pd.DataFrame) -> list[dict]:
    """Extract sales contracts with booked vs dispatched quantities."""
    contracts = []

    for _, row in df.iterrows():
        try:
            customer = safe_str(row.iloc[0])
            if not customer or customer in ('Customer', 'Party', 'CUSTOMER'):
                continue

            density = safe_float(row.iloc[2] if len(row) > 2 else None)
            locked_price = safe_float(row.iloc[3] if len(row) > 3 else None)
            booked = safe_float(row.iloc[4] if len(row) > 4 else None)
            dispatched = safe_float(row.iloc[5] if len(row) > 5 else None)
            location = safe_str(row.iloc[1] if len(row) > 1 else None)

            if not (booked and booked > 0):
                continue

            dispatched = dispatched or 0
            pending = booked - dispatched
            status = 'fulfilled' if pending <= 0 else ('partial' if dispatched > 0 else 'open')

            contracts.append({
                "customer_name": customer,
                "density": int(density) if density else None,
                "locked_price": locked_price or 0,
                "booked_qty": booked,
                "dispatched_qty": dispatched,
                "status": status,
                "location": location,
            })
        except (IndexError, Exception):
            pass

    return contracts


def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ Missing Supabase credentials in etl/.env")
        sys.exit(1)

    if not SALES_FILE.exists():
        print(f"❌ File not found: {SALES_FILE}")
        sys.exit(1)

    print(f"📂 Reading {SALES_FILE.name}...")
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    xl = pd.ExcelFile(SALES_FILE)
    print(f"   Sheets found: {xl.sheet_names}")

    all_customers = []
    all_contracts = []
    all_ledger = []

    # Process main sales ledger
    if "Sales 26-27" in xl.sheet_names:
        print("\n📋 Processing Sales 26-27...")
        df = pd.read_excel(SALES_FILE, sheet_name="Sales 26-27", header=0)
        customers, ledger = process_sales_ledger(df)
        all_customers.extend(customers)
        all_ledger.extend(ledger)
        print(f"   Found {len(customers)} unique customers, {len(ledger)} ledger entries")

    # Process SHD sales
    for sheet in ["Sales SHD", "Sales Kolkata"]:
        if sheet in xl.sheet_names:
            print(f"\n📋 Processing {sheet}...")
            df = pd.read_excel(SALES_FILE, sheet_name=sheet, header=0)
            customers, ledger = process_sales_ledger(df)
            all_customers.extend(customers)
            all_ledger.extend(ledger)
            print(f"   Found {len(ledger)} additional ledger entries")

    # Process contracts
    if "Sales contract" in xl.sheet_names:
        print("\n📋 Processing Sales contract...")
        df = pd.read_excel(SALES_FILE, sheet_name="Sales contract", header=0)
        contracts = process_sales_contracts(df)
        all_contracts.extend(contracts)
        print(f"   Found {len(contracts)} contracts")

    # ── Deduplicate customers ──────────────────────────────────────────────────
    seen = set()
    unique_customers = []
    for c in all_customers:
        if c["name"] not in seen:
            seen.add(c["name"])
            unique_customers.append(c)

    print(f"\n🔑 Unique customers: {len(unique_customers)}")

    # ── Insert customers ───────────────────────────────────────────────────────
    if unique_customers:
        print(f"⬆️  Inserting {len(unique_customers)} customers...")
        result = supabase.table("customers").insert(unique_customers).execute()
        print("   ✓ Customers inserted")

    # ── Fetch customer ID map ──────────────────────────────────────────────────
    response = supabase.table("customers").select("id, name").execute()
    customer_id_map = {c["name"]: c["id"] for c in response.data}

    # ── Insert sales ledger ────────────────────────────────────────────────────
    if all_ledger:
        # Resolve customer_name → customer_id
        resolved_ledger = []
        for entry in all_ledger:
            customer_name = entry.pop("customer_name")
            customer_id = customer_id_map.get(customer_name)
            if customer_id:
                entry["customer_id"] = customer_id
                resolved_ledger.append(entry)

        print(f"⬆️  Inserting {len(resolved_ledger)} sales ledger entries...")
        for i in range(0, len(resolved_ledger), 500):
            batch = resolved_ledger[i:i + 500]
            supabase.table("sales_ledger").insert(batch).execute()
            print(f"   ✓ Batch {i//500 + 1} ({len(batch)} rows)")

    # ── Insert contracts ───────────────────────────────────────────────────────
    if all_contracts:
        resolved_contracts = []
        for c in all_contracts:
            customer_name = c.pop("customer_name")
            customer_id = customer_id_map.get(customer_name)
            if customer_id:
                c["customer_id"] = customer_id
                resolved_contracts.append(c)

        print(f"⬆️  Inserting {len(resolved_contracts)} sales contracts...")
        supabase.table("sales_contracts").insert(resolved_contracts).execute()
        print("   ✓ Contracts inserted")

    print("\n✅ Sales import complete!")


if __name__ == "__main__":
    main()
