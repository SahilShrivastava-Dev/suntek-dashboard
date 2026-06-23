/**
 * Supabase database type definitions for the Suntek ERP Dashboard.
 * These correspond exactly to the PostgreSQL tables defined in the plan.
 */

export type UserRole = 'L1' | 'L2' | 'L3' | 'L4';

/**
 * Mirrors Supabase's generated Insert semantics: columns that accept null
 * (nullable / defaulted) are OPTIONAL on insert, while non-null columns stay
 * required. Hand-writing Insert as a plain `Omit<Row, ...>` wrongly makes every
 * column required.
 */
type OptionalNulls<T> =
  { [K in keyof T as null extends T[K] ? never : K]: T[K] } &
  { [K in keyof T as null extends T[K] ? K : never]?: T[K] };

/**
 * NOTE on schema strictness: this is intentionally a "loose" schema (no
 * top-level Views/Functions and no per-table `Relationships`). Making it satisfy
 * supabase-js's strict GenericSchema was tried and rejected: with no
 * relationship metadata, every embedded-join select (`select('*, plants(name)')`)
 * resolves to a `SelectQueryError` type. Proper strictness requires types
 * GENERATED from the live DB (`supabase gen types typescript`), which carry the
 * relationship metadata. Until that codegen is run, the loose schema is correct:
 * reads stay typed via `.returns<T>()` and writes via the helpers in lib/db.ts.
 */
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

      // Directory of real users for the profile switcher + User Management. See migration 0006.
      user_accounts: {
        Row: {
          id: string;
          name: string;
          mobile: string | null;
          email: string | null;
          whatsapp: string | null;
          role_id: string | null;
          role_label: string | null;
          plant_id: string | null;
          plant_name: string | null;
          designation: string | null;
          access_note: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['user_accounts']['Row'], 'id' | 'created_at'>>;
        Update: Partial<Database['public']['Tables']['user_accounts']['Insert']>;
      };

      // Restricted persons/vehicles/vendors registry with resolve workflow. See migration 0006.
      blacklist: {
        Row: {
          id: string;
          type: 'person' | 'vehicle' | 'vendor' | 'other';
          name: string;
          identifier: string | null;
          reason: string;
          severity: 'low' | 'medium' | 'high' | 'critical';
          notes: string | null;
          reference_no: string | null;
          added_by: string | null;
          added_by_role: string | null;
          is_active: boolean;
          resolved_at: string | null;
          resolved_by: string | null;
          resolved_reason: string | null;
          created_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['blacklist']['Row'], 'id' | 'created_at'>>;
        Update: Partial<Database['public']['Tables']['blacklist']['Insert']>;
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
        Insert: OptionalNulls<Omit<Database['public']['Tables']['stock_levels']['Row'], 'id' | 'updated_at'>>;
        Update: Partial<Database['public']['Tables']['stock_levels']['Insert']>;
      };

      // Port + factory storage tanks (replaces the TANKS mock). See migration 0002.
      tanks: {
        Row: {
          id: string;
          name: string;
          location: string | null;
          capacity: number | null;
          unit: string;
          level_pct: number;
          alert: boolean;
          sort_order: number;
          updated_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['tanks']['Row'], 'id' | 'updated_at'>>;
        Update: Partial<Database['public']['Tables']['tanks']['Insert']>;
      };

      // Normalised CP density×location drum counts (replaces CP_MATRIX mock).
      cpm_drum_stock: {
        Row: {
          id: string;
          location: string;
          density: number;
          drums: number;
          updated_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['cpm_drum_stock']['Row'], 'id' | 'updated_at'>>;
        Update: Partial<Database['public']['Tables']['cpm_drum_stock']['Insert']>;
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
          plant_id: string | null;
          batch_no: string;
          recipe: string;
          target_qty: number;
          operator_id: string | null;
          status: 'active' | 'closed' | 'flagged';
          started_at: string;
          closed_at: string | null;
          final_gravity: number | null;
          total_drums: number | null;
          paraffin_weight: number | null;
          hcl_quantity: number | null;
        };
        // started_at has a DB default; treat as optional on insert.
        Insert: OptionalNulls<Omit<Database['public']['Tables']['active_batches']['Row'], 'id' | 'started_at'>> & {
          started_at?: string;
        };
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
        // timestamp has a DB default but may be supplied (e.g. from an OCR'd sheet).
        Insert: OptionalNulls<Omit<Database['public']['Tables']['batch_readings']['Row'], 'id' | 'timestamp'>> & {
          timestamp?: string;
        };
        Update: Partial<Database['public']['Tables']['batch_readings']['Insert']>;
      };

      // Per-device (IP) operator draft cache (BatchLogger). See migration 0004.
      operator_sessions: {
        Row: {
          ip_address: string;
          selected_batch: string | null;
          temp_input: string | null;
          cp_gravity_input: string | null;
          cl2_press_input: string | null;
          active_tab: string | null;
          new_batch_no_input: string | null;
          new_recipe_input: string | null;
          new_target_qty_input: string | null;
          last_active: string;
        };
        Insert: OptionalNulls<Database['public']['Tables']['operator_sessions']['Row']>;
        Update: Partial<Database['public']['Tables']['operator_sessions']['Insert']>;
      };

      // OCR-assisted daily unit monitoring log (DailyLogPage). See migration 0005.
      unit_log_entries: {
        Row: {
          id: string;
          date: string;
          shift: string | null;
          unit_name: string | null;
          operators: string[] | null;
          helper_name: string | null;
          readings: unknown;
          tank_summaries: unknown;
          remarks: string | null;
          notes: unknown;
          uploaded_at: string;
          raw_extraction: unknown;
          created_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['unit_log_entries']['Row'], 'id' | 'created_at'>>;
        Update: Partial<Database['public']['Tables']['unit_log_entries']['Insert']>;
      };

      // Append-only audit trail of operator actions (BatchLogger). See migration 0004.
      batch_edit_logs: {
        Row: {
          id: string;
          ip_address: string | null;
          batch_no: string | null;
          action_type: string;
          details: Record<string, unknown> | null;
          created_at: string;
        };
        // created_at has a DB default but may be supplied by the caller.
        Insert: OptionalNulls<Omit<Database['public']['Tables']['batch_edit_logs']['Row'], 'id' | 'created_at'>> & {
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['batch_edit_logs']['Insert']>;
      };

      // Phase 2: the single feed every anomaly app writes into. See migration 0007.
      anomaly_flags: {
        Row: {
          id: string;
          severity: 'critical' | 'warning' | 'watch';
          source_app: string;
          plant: string | null;
          entity_type: string | null;
          entity_id: string | null;
          entity_label: string | null;
          title: string;
          evidence: string | null;
          recommended_action: string | null;
          value_at_stake: number | null;
          value_unit: string | null;
          confidence: number | null;
          status: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
          assigned_to: string | null;
          resolution_reason: string | null;
          route: string | null;
          created_at: string;
          updated_at: string;
          resolved_at: string | null;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['anomaly_flags']['Row'], 'id' | 'created_at' | 'updated_at'>>;
        Update: Partial<Database['public']['Tables']['anomaly_flags']['Insert']>;
      };

      // Operational alerts feed (replaces ALERTS mock). See migration 0003.
      alerts: {
        Row: {
          id: string;
          severity: 'red' | 'amber' | 'low';
          text: string;
          source: string | null;
          when_label: string | null;
          route: string | null;
          is_resolved: boolean;
          created_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['alerts']['Row'], 'id' | 'created_at'>>;
        Update: Partial<Database['public']['Tables']['alerts']['Insert']>;
      };

      // ── Notifications ─────────────────────────────────────────────────────
      // Role-targeted in-app notifications (also surfaced via NotificationsContext).
      notifications: {
        Row: {
          id: string;
          target_roles: string[];
          title: string;
          body: string | null;
          type: 'info' | 'warning' | 'urgent' | 'critical';
          route: string | null;
          actor_name: string | null;
          actor_role: string | null;
          read_by: string[];
          cleared_by: string[];
          created_at: string;
        };
        // read_by / cleared_by have DB defaults ('{}'), so they're optional on insert.
        Insert: OptionalNulls<Omit<Database['public']['Tables']['notifications']['Row'], 'id' | 'created_at' | 'read_by' | 'cleared_by'>> & {
          read_by?: string[];
          cleared_by?: string[];
        };
        Update: Partial<Database['public']['Tables']['notifications']['Insert']>;
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
        Insert: OptionalNulls<Omit<Database['public']['Tables']['shift_logs']['Row'], 'id' | 'submitted_at'>>;
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
        Insert: OptionalNulls<Omit<Database['public']['Tables']['device_mappings']['Row'], 'created_at'>>;
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
        Insert: OptionalNulls<Omit<Database['public']['Tables']['customers']['Row'], 'id' | 'created_at'>>;
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
        Insert: OptionalNulls<Omit<Database['public']['Tables']['sales_contracts']['Row'], 'id' | 'created_at'>>;
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
        Insert: OptionalNulls<Omit<Database['public']['Tables']['store_requisitions']['Row'], 'id' | 'created_at'>>;
        Update: Partial<Database['public']['Tables']['store_requisitions']['Insert']>;
      };

      fixed_assets: {
        Row: {
          id: string;
          plant_id: string | null;
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
        Insert: OptionalNulls<Omit<Database['public']['Tables']['fixed_assets']['Row'], 'id' | 'created_at'>>;
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

      // Recurring maintenance definitions. A due schedule auto-spawns a periodic
      // ticket. Backs the "schedule" tab of Maintenance.tsx. See migration 0001.
      maintenance_schedules: {
        Row: {
          id: string;
          title: string;
          equipment: string;
          plant_id: string | null;
          frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'biannual' | 'triannual' | 'annual';
          description: string | null;
          assigned_to: string | null;
          is_active: boolean;
          next_due_at: string | null;
          last_completed_at: string | null;
          created_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['maintenance_schedules']['Row'], 'id' | 'created_at'>>;
        Update: Partial<Database['public']['Tables']['maintenance_schedules']['Insert']>;
      };

      // One ticket per maintenance event, moving through the staged workflow.
      maintenance_tickets: {
        Row: {
          id: string;
          type: 'periodic' | 'emergency';
          status:
            | 'open'
            | 'in_progress'
            | 'pending_store'
            | 'pending_unit_head'
            | 'pending_purchase'
            | 'pending_purchase_manager'
            | 'pending_handover'
            | 'pending_defective_return'
            | 'closed';
          title: string;
          equipment: string;
          plant_id: string | null;
          unit: string | null; // 'chlorides' | 'plasticiser' | null — Jharkhand procurement unit
          schedule_id: string | null;
          description: string | null;
          due_date: string | null;
          raised_by: string | null;
          raised_role: string | null;
          assigned_to: string | null;
          completion_photo_url: string | null;
          defective_part_photo_url: string | null;
          defective_part_decision: 'repair' | 'scrap' | null;
          closed_at: string | null;
          created_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['maintenance_tickets']['Row'], 'id' | 'created_at' | 'status'>> & {
          status?: Database['public']['Tables']['maintenance_tickets']['Row']['status'];
        };
        Update: Partial<Database['public']['Tables']['maintenance_tickets']['Insert']>;
      };

      // Spare-part request raised against a ticket: store decision, approval,
      // procurement ref, and handover proof.
      maintenance_store_requests: {
        Row: {
          id: string;
          ticket_id: string;
          part_name: string;
          quantity: number | null;
          specification: string | null;
          plant_id: string | null;
          store_decision: 'available' | 'unavailable' | null;
          purchase_required: boolean | null;
          qty_in_store: number | null;
          shelf_location: string | null;
          part_condition: string | null;
          unit_head_approval: 'approved' | 'rejected' | null;
          busy_transaction_ref: string | null;
          unit_price: number | null;
          total_price: number | null;
          supplier_name: string | null;
          handover_invoice_url: string | null;
          handover_photo_url: string | null;
          handover_notes: string | null;
          handover_confirmed_at: string | null;
          bill_verified: boolean | null;
          created_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['maintenance_store_requests']['Row'], 'id' | 'created_at'>>;
        Update: Partial<Database['public']['Tables']['maintenance_store_requests']['Insert']>;
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
        Insert: OptionalNulls<Omit<Database['public']['Tables']['activity_logs']['Row'], 'id' | 'created_at'>>;
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
        Insert: OptionalNulls<Omit<Database['public']['Tables']['marine_insurance']['Row'], 'id' | 'created_at'>>;
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
          status: string | null;
          created_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['oil_contracts']['Row'], 'id' | 'created_at'>>;
        Update: Partial<Database['public']['Tables']['oil_contracts']['Insert']>;
      };

      // ── @-mentions / tagging ──────────────────────────────────────────────
      // Generic notes attachable to any entity, with @mention ids. See 10_mentions.sql.
      entity_notes: {
        Row: {
          id: string;
          entity_type: string;
          entity_id: string;
          author_id: string;
          author_name: string;
          author_role: string | null;
          body: string;
          mentions: string[];
          created_at: string;
        };
        // mentions has a DB default ('{}'), so it is optional on insert.
        Insert: OptionalNulls<Omit<Database['public']['Tables']['entity_notes']['Row'], 'id' | 'created_at' | 'mentions'>> & {
          mentions?: string[];
        };
        Update: Partial<Database['public']['Tables']['entity_notes']['Insert']>;
      };

      // ── Store inventory (maintenance spare-parts register) ────────────────
      store_inventory: {
        Row: {
          id: string;
          store: string;
          part_name: string;
          quantity: number;
          low_threshold: number;
          updated_at: string;
          created_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['store_inventory']['Row'], 'id' | 'created_at' | 'updated_at'>> & {
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['store_inventory']['Insert']>;
      };

      // ── Blacklist audit trail ─────────────────────────────────────────────
      // Lifecycle + fuzzy-match-detection events for the blacklist. See 12_blacklist_audit.sql.
      blacklist_events: {
        Row: {
          id: string;
          blacklist_id: string | null;
          event_type: string; // 'added' | 'resolved' | 're_added' | 'match_detected'
          entity_name: string;
          entity_type: string | null;
          matched_value: string | null;
          similarity: number | null;
          workflow: string | null;
          source: string | null;
          actor_id: string | null;
          actor_name: string | null;
          actor_role: string | null;
          image_url: string | null;
          details: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['blacklist_events']['Row'], 'id' | 'created_at'>>;
        Update: Partial<Database['public']['Tables']['blacklist_events']['Insert']>;
      };

      // CC / watchers: people who follow an entity and get notified on changes.
      entity_watchers: {
        Row: {
          id: string;
          entity_type: string;
          entity_id: string;
          profile_id: string;
          profile_name: string;
          kind: string; // 'cc' | 'mention' | 'author'
          added_by: string | null;
          created_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['entity_watchers']['Row'], 'id' | 'created_at'>>;
        Update: Partial<Database['public']['Tables']['entity_watchers']['Insert']>;
      };
    };
  };
}
