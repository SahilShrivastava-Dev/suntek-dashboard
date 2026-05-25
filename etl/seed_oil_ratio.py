"""
ETL Script 04: Seed oil_ratio_table with values from Oil Ratio Suntek.pdf
=========================================================================
These values are manually transcribed from the PDF (the PDF cannot be parsed
automatically). Update the OIL_RATIO_DATA list below with values from the PDF.

Usage:
  python etl/seed_oil_ratio.py
"""

import os
import sys
from pathlib import Path

try:
    from supabase import create_client
    from dotenv import load_dotenv
except ImportError:
    print("Missing dependencies. Run: pip install supabase python-dotenv")
    sys.exit(1)

load_dotenv(Path(__file__).parent / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

# ── Oil Ratio Table Data ────────────────────────────────────────────────────────
#
# Source: Oil Ratio Suntek.pdf
# Columns: gravity, np_ratio, waxol_ratio, cl2_consumption, hcl_output
#
# np_ratio:       Fraction of Normal Paraffin input that becomes CP
# waxol_ratio:    Waxol fraction
# cl2_consumption: Cl2 consumed per kg of NP
# hcl_output:     HCL byproduct output per unit
#
# UPDATE THESE VALUES FROM THE ACTUAL PDF:
OIL_RATIO_DATA = [
    {"gravity": 1100, "np_ratio": 0.82, "waxol_ratio": 0.18, "cl2_consumption": 0.42, "hcl_output": 0.31},
    {"gravity": 1150, "np_ratio": 0.78, "waxol_ratio": 0.22, "cl2_consumption": 0.48, "hcl_output": 0.36},
    {"gravity": 1200, "np_ratio": 0.74, "waxol_ratio": 0.26, "cl2_consumption": 0.54, "hcl_output": 0.41},
    {"gravity": 1250, "np_ratio": 0.70, "waxol_ratio": 0.30, "cl2_consumption": 0.60, "hcl_output": 0.45},
    {"gravity": 1300, "np_ratio": 0.66, "waxol_ratio": 0.34, "cl2_consumption": 0.66, "hcl_output": 0.50},
    {"gravity": 1320, "np_ratio": 0.63, "waxol_ratio": 0.37, "cl2_consumption": 0.70, "hcl_output": 0.53},
    {"gravity": 1350, "np_ratio": 0.60, "waxol_ratio": 0.40, "cl2_consumption": 0.74, "hcl_output": 0.56},
    {"gravity": 1390, "np_ratio": 0.56, "waxol_ratio": 0.44, "cl2_consumption": 0.80, "hcl_output": 0.61},
    {"gravity": 1400, "np_ratio": 0.55, "waxol_ratio": 0.45, "cl2_consumption": 0.82, "hcl_output": 0.62},
    {"gravity": 1420, "np_ratio": 0.52, "waxol_ratio": 0.48, "cl2_consumption": 0.86, "hcl_output": 0.65},
    {"gravity": 1450, "np_ratio": 0.49, "waxol_ratio": 0.51, "cl2_consumption": 0.91, "hcl_output": 0.69},
    {"gravity": 1480, "np_ratio": 0.46, "waxol_ratio": 0.54, "cl2_consumption": 0.96, "hcl_output": 0.73},
    {"gravity": 1500, "np_ratio": 0.44, "waxol_ratio": 0.56, "cl2_consumption": 1.00, "hcl_output": 0.76},
]


def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ Missing Supabase credentials in etl/.env")
        sys.exit(1)

    print(f"📊 Seeding oil_ratio_table with {len(OIL_RATIO_DATA)} entries...")
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Clear existing data first
    supabase.table("oil_ratio_table").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

    result = supabase.table("oil_ratio_table").insert(OIL_RATIO_DATA).execute()
    print(f"✅ Inserted {len(OIL_RATIO_DATA)} oil ratio entries")
    print("\n⚠️  IMPORTANT: Verify these values against the actual Oil Ratio Suntek.pdf")
    print("   Update OIL_RATIO_DATA in this file with the correct values before using in production.")


if __name__ == "__main__":
    main()
