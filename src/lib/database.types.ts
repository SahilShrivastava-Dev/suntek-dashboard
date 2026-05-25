/**
 * Supabase database type definitions for the Suntek ERP Dashboard.
 * These correspond exactly to the PostgreSQL tables defined in the plan.
 */

export type UserRole = 'L1' | 'L2' | 'L3' | 'L4';

export interface Database {
  public: {
    Tables: {
      // ── Auth / Users ─────────────────────────────────────────────────────
      profiles: {
        Row: {
          id: string; // uuid FK auth.users
          role: UserRole;
          plant_id: string | null;
          name: string;
          phone: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['profiles']['Row'], 'created_at'>;
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
      };

      plants: {
        Row: {
          id: string;
          name: string;
          lat: number;
          lng: number;
          geofence_radius_m: number;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['plants']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['plants']['Insert']>;
      };

      // ── Production & Stock ────────────────────────────────────────────────
      stock_levels: {
        Row: {
          id: string;
          plant_id: string;
          density: number;
          product: string;
          quantity: number;
          date: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['stock_levels']['Row'], 'id' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['stock_levels']['Insert']>;
      };

      drum_inventory: {
        Row: {
          id: string;
          plant_id: string;
          density: number;
          opening: number;
          physical_count: number | null;
          date: string;
          submitted_by: string | null;
        };
        Insert: Omit<Database['public']['Tables']['drum_inventory']['Row'], 'id'>;
        Update: Partial<Database['public']['Tables']['drum_inventory']['Insert']>;
      };

      oil_ratio_table: {
        Row: {
          id: string;
          gravity: number;
          np_ratio: number;
          waxol_ratio: number;
          cl2_consumption: number;
          hcl_output: number;
        };
        Insert: Omit<Database['public']['Tables']['oil_ratio_table']['Row'], 'id'>;
        Update: Partial<Database['public']['Tables']['oil_ratio_table']['Insert']>;
      };

      active_batches: {
        Row: {
          id: string;
          plant_id: string;
          batch_no: string;
          recipe: string;
          target_qty: number;
          operator_id: string;
          status: 'active' | 'closed' | 'flagged';
          started_at: string;
          closed_at: string | null;
          final_gravity: number | null;
          total_drums: number | null;
          paraffin_weight: number | null;
          hcl_quantity: number | null;
        };
        Insert: Omit<Database['public']['Tables']['active_batches']['Row'], 'id'>;
        Update: Partial<Database['public']['Tables']['active_batches']['Insert']>;
      };

      batch_readings: {
        Row: {
          id: string;
          batch_id: string;
          timestamp: string;
          temp: number | null;
          cp_gravity: number | null;
          cl2_pressure: number | null;
          hcl_gravity: number | null;
          cl2_pipe_pressure: number | null;
          operator_id: string | null;
        };
        Insert: Omit<Database['public']['Tables']['batch_readings']['Row'], 'id' | 'timestamp'>;
        Update: Partial<Database['public']['Tables']['batch_readings']['Insert']>;
      };

      // ── Night Manager ─────────────────────────────────────────────────────
      shift_logs: {
        Row: {
          id: string;
          employee_id: string | null;
          plant_id: string | null;
          photo_url: string | null;
          lat: number | null;
          lng: number | null;
          is_on_site: boolean;
          distance_m: number | null;
          ip_address: string | null;
          submitted_at: string;
        };
        Insert: Omit<Database['public']['Tables']['shift_logs']['Row'], 'id' | 'submitted_at'>;
        Update: Partial<Database['public']['Tables']['shift_logs']['Insert']>;
      };

      device_mappings: {
        Row: {
          ip_address: string;
          name: string;
          department: string | null;
          phone: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['device_mappings']['Row'], 'created_at'>;
        Update: Partial<Database['public']['Tables']['device_mappings']['Insert']>;
      };

      // ── Sales ─────────────────────────────────────────────────────────────
      customers: {
        Row: {
          id: string;
          name: string;
          place: string | null;
          preferred_density: number | null;
          outstanding: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['customers']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['customers']['Insert']>;
      };

      sales_contracts: {
        Row: {
          id: string;
          customer_id: string;
          density: number;
          locked_price: number;
          booked_qty: number;
          dispatched_qty: number;
          status: 'open' | 'fulfilled' | 'partial';
          created_at: string;
          location: string | null;
        };
        Insert: Omit<Database['public']['Tables']['sales_contracts']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['sales_contracts']['Insert']>;
      };

      sales_ledger: {
        Row: {
          id: string;
          customer_id: string;
          date: string;
          invoice_no: string | null;
          qty: number;
          value: number;
          transporter: string | null;
          vehicle_no: string | null;
          density: number | null;
          location: string | null;
        };
        Insert: Omit<Database['public']['Tables']['sales_ledger']['Row'], 'id'>;
        Update: Partial<Database['public']['Tables']['sales_ledger']['Insert']>;
      };

      // ── Purchase ──────────────────────────────────────────────────────────
      store_requisitions: {
        Row: {
          id: string;
          item: string;
          plant_id: string | null;
          qty: number;
          urgency: 'low' | 'medium' | 'high' | 'plant_stopper';
          status: 'pending' | 'approved' | 'dispatched' | 'received' | 'rejected';
          raised_by: string | null;
          approved_by: string | null;
          photo_url: string | null;
          remarks: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['store_requisitions']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['store_requisitions']['Insert']>;
      };

      fixed_assets: {
        Row: {
          id: string;
          plant_id: string;
          name: string;
          identification_mark: string | null;
          model: string | null;
          capacity: string | null;
          origin: string | null;
          year: number | null;
          value: number | null;
          invoice_no: string | null;
          purchase_date: string | null;
          account_head: string | null;
          photo_url: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['fixed_assets']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['fixed_assets']['Insert']>;
      };

      maintenance_logs: {
        Row: {
          id: string;
          plant_id: string | null;
          asset_id: string | null;
          date: string;
          equipment: string;
          issue: string;
          action: string | null;
          type: 'regular' | 'repair' | 'scrap';
          status: 'open' | 'closed';
          done_by: string | null;
          photo_url: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['maintenance_logs']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['maintenance_logs']['Insert']>;
      };

      activity_logs: {
        Row: {
          id: string;
          plant_id: string | null;
          type: string;
          date: string;
          done_by: string | null;
          verified_by: string | null;
          photo_url: string | null;
          equipment: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['activity_logs']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['activity_logs']['Insert']>;
      };

      marine_insurance: {
        Row: {
          id: string;
          date: string;
          type: 'top_up' | 'deduction';
          reference: string | null;
          amount: number;
          balance: number;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['marine_insurance']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['marine_insurance']['Insert']>;
      };

      dispatch_logs: {
        Row: {
          id: string;
          destination: string | null;
          date: string;
          item: string | null;
          document_ref: string | null;
          vehicle_no: string | null;
          sender: string | null;
          receiver: string | null;
          from_location: string | null;
          supplier: string | null;
          receive_date: string | null;
          remarks: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['dispatch_logs']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['dispatch_logs']['Insert']>;
      };

      daily_stock_entries: {
        Row: {
          id: string;
          plant_id: string;
          date: string;
          tank_name: string;
          level_pct: number;
          submitted_by: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['daily_stock_entries']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['daily_stock_entries']['Insert']>;
      };

      labour_costs: {
        Row: {
          id: string;
          plant_id: string;
          date: string;
          purchased_qty: number;
          sales_qty: number;
          computed_cost: number;
          target_cost: number;
          per_mt_cost: number;
          variance_pct: number;
          is_flagged: boolean;
        };
        Insert: Omit<Database['public']['Tables']['labour_costs']['Row'], 'id'>;
        Update: Partial<Database['public']['Tables']['labour_costs']['Insert']>;
      };

      oil_contracts: {
        Row: {
          id: string;
          oil_type: string | null;
          date: string | null;
          company: string | null;
          paraffin_type: string | null;
          port: string | null;
          lifting_cycle: string | null;
          price: number | null;
          book_qty_mt: number | null;
          dispatched_qty: number | null;
          pending_qty: number | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['oil_contracts']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['oil_contracts']['Insert']>;
      };
    };
  };
}
