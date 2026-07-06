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
          role: string; // role_id — matches MockProfile.id ('admin', 'unit_head', …); drives RBAC
          plant_id: string | null;
          name: string;
          phone: string | null;
          preferred_language: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['profiles']['Row'], 'created_at'>;
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
      };

      // Role catalog — the single source of truth for RBAC. Replaces the old
      // hardcoded MOCK_PROFILES role templates. See migration for `roles`.
      roles: {
        Row: {
          id: string;            // text PK, slug ('admin', 'unit_head', …)
          label: string;
          level: string;         // tier id ('L1'…'L5'); see tiers table (29_tiers_and_capabilities.sql)
          description: string | null;
          home_route: string;
          allowed_routes: string[]; // exact route strings; ['*'] = all
          standalone_only: boolean;
          is_admin: boolean;
          is_system: boolean;    // can't be deleted
          capabilities: string[]; // granted special allowances, e.g. ['manage_users']
          avatar_from: string | null;
          avatar_to: string | null;
          sort_order: number | null;
          created_at?: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['roles']['Row'], 'created_at'>>;
        Update: Partial<Database['public']['Tables']['roles']['Insert']>;
      };

      // Admin-managed hierarchy levels. rank (gapped) defines seniority.
      tiers: {
        Row: {
          id: string;            // 'L1'…'L5' (and future admin-made levels)
          label: string;
          rank: number;          // higher = more senior
          description: string | null;
          created_at?: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['tiers']['Row'], 'created_at'>>;
        Update: Partial<Database['public']['Tables']['tiers']['Insert']>;
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

      // Sub-divisions of a plant (e.g. Chlorides / Plasticiser). See 27_plant_unit_scoping.sql.
      units: {
        Row: {
          id: string;
          plant_id: string;
          name: string;
          code: string | null;
          created_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['units']['Row'], 'id' | 'created_at'>>;
        Update: Partial<Database['public']['Tables']['units']['Insert']>;
      };

      // Which plants a user belongs to (many-to-many). See 27_plant_unit_scoping.sql.
      user_plants: {
        Row: {
          user_account_id: string;
          plant_id: string;
        };
        Insert: Database['public']['Tables']['user_plants']['Row'];
        Update: Partial<Database['public']['Tables']['user_plants']['Row']>;
      };

      // Optional narrowing of a user to specific unit(s) within a plant.
      user_units: {
        Row: {
          user_account_id: string;
          unit_id: string;
        };
        Insert: Database['public']['Tables']['user_units']['Row'];
        Update: Partial<Database['public']['Tables']['user_units']['Row']>;
      };

      // Multi-role: which roles a user holds (union of access). See 31_user_roles.sql.
      user_roles: {
        Row: {
          user_account_id: string;
          role_id: string;
        };
        Insert: Database['public']['Tables']['user_roles']['Row'];
        Update: Partial<Database['public']['Tables']['user_roles']['Row']>;
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
          auth_user_id: string | null;   // linked auth.users id once a login is provisioned
          login_enabled: boolean | null; // true when this row has an active login
          login_email: string | null;    // exact email registered in auth.users (may be synthetic)
          mobile_norm: string | null;    // generated: normalized last-10-digit phone, used as login key
          is_global: boolean | null;     // true = sees every plant (Owner/Admin, all-India accountant)
          preferred_language: string | null;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['user_accounts']['Row'], 'id' | 'created_at'>>;
        Update: Partial<Database['public']['Tables']['user_accounts']['Insert']>;
      };

      // Audit history of profile changes (self-service + admin). See migration 21.
      user_account_events: {
        Row: {
          id: string;
          user_account_id: string | null;
          target_name: string | null;
          target_email: string | null;
          action: string;
          details: string | null;
          actor_name: string | null;
          actor_role: string | null;
          created_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['user_account_events']['Row'], 'id' | 'created_at'>>;
        Update: Partial<Database['public']['Tables']['user_account_events']['Insert']>;
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

      // ── Store stock ledger (Excel ingestion + living register) — migration 37 ──
      store_stock_uploads: {
        Row: {
          id: string;
          plant_id: string | null;
          period_month: string;          // date (first of month)
          file_name: string | null;
          file_url: string | null;        // Cloudinary archive
          uploaded_by: string | null;
          uploaded_by_name: string | null;
          row_count: number;
          sheet_count: number;
          notes: string | null;
          created_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['store_stock_uploads']['Row'], 'id' | 'created_at'>>;
        Update: Partial<Database['public']['Tables']['store_stock_uploads']['Insert']>;
      };

      store_stock_months: {
        Row: {
          id: string;
          upload_id: string | null;
          plant_id: string | null;
          period_month: string;           // date
          item_name: string;
          unit: string | null;
          opening: number;
          purchase_opening: number;
          purchased: number;
          used: number;
          computed_closing: number;
          created_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['store_stock_months']['Row'], 'id' | 'created_at'>>;
        Update: Partial<Database['public']['Tables']['store_stock_months']['Insert']>;
      };

      store_items: {
        Row: {
          id: string;
          plant_id: string | null;
          item_name: string;
          unit: string | null;
          equipment: string | null;
          model: string | null;
          baseline_qty: number;
          baseline_month: string | null;  // date
          procured_qty: number;
          issued_qty: number;
          manual_delta: number;
          ticket_procured_qty: number;    // external units bought for tickets (audit only)
          on_hand: number;
          updated_at: string;
          created_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['store_items']['Row'], 'id' | 'created_at' | 'updated_at'>>;
        Update: Partial<Database['public']['Tables']['store_items']['Insert']>;
      };

      pm_schedule_uploads: {
        Row: {
          id: string;
          plant_id: string | null;
          file_name: string | null;
          file_url: string | null;
          uploaded_by_name: string | null;
          sheet_count: number;
          schedule_count: number;
          created_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['pm_schedule_uploads']['Row'], 'id' | 'created_at'>>;
        Update: Partial<Database['public']['Tables']['pm_schedule_uploads']['Insert']>;
      };

      store_stock_events: {
        Row: {
          id: string;
          item_id: string | null;
          plant_id: string | null;
          event_type: 'baseline' | 'issue' | 'procure' | 'manual_edit' | 'rename';
          qty_delta: number;
          on_hand_after: number | null;
          ref: string | null;
          justification: string | null;
          actor: string | null;
          actor_name: string | null;
          created_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['store_stock_events']['Row'], 'id' | 'created_at'>>;
        Update: Partial<Database['public']['Tables']['store_stock_events']['Insert']>;
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
          scope: string; // 'personal' | 'broadcast' — see 24_notification_scope.sql
          plant_id: string | null; // NULL = broadcast; set = "role X at this plant" (27_plant_unit_scoping.sql)
          unit_id: string | null;
          photo_url: string | null; // optional proof image (e.g. night-duty check-in)
          created_at: string;
        };
        // read_by / cleared_by / scope have DB defaults, so they're optional on insert.
        Insert: OptionalNulls<Omit<Database['public']['Tables']['notifications']['Row'], 'id' | 'created_at' | 'read_by' | 'cleared_by' | 'scope'>> & {
          read_by?: string[];
          cleared_by?: string[];
          scope?: string;
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
          night_duty_id: string | null; // links a check-in to its night_duty (33_night_duty.sql)
          submitted_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['shift_logs']['Row'], 'id' | 'submitted_at'>>;
        Update: Partial<Database['public']['Tables']['shift_logs']['Insert']>;
      };

      // Night duty as a scheduled, rotational assignment. See 33_night_duty.sql.
      night_duty: {
        Row: {
          id: string;
          technician_id: string;
          assigned_by: string | null;
          plant_id: string | null;
          unit_id: string | null;
          duty_date: string;
          status: 'scheduled' | 'checked_in' | 'completed' | 'missed';
          checked_in_at: string | null;
          shift_log_id: string | null;
          recurrence_group: string | null;
          notes: string | null;
          created_at?: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['night_duty']['Row'], 'id' | 'created_at'>>;
        Update: Partial<Database['public']['Tables']['night_duty']['Insert']>;
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
          plant_id: string | null; // scoping key (27_plant_unit_scoping.sql)
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
          plant_id: string | null; // scoping key (27_plant_unit_scoping.sql)
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
          unit_id: string | null; // FK to units — scoping key (27_plant_unit_scoping.sql)
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
          make: string | null;
          serial_no: string | null;
          quantity: number | null;
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
          frequency: 'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'bimonthly' | 'quarterly' | 'biannual' | 'triannual' | 'annual';
          description: string | null;
          assigned_to: string | null;
          is_active: boolean;
          next_due_at: string | null;
          last_completed_at: string | null;
          far_asset_id: string | null;
          equipment_mark: string | null;
          start_date: string | null;
          until_date: string | null;
          checklist: { component: string; activity: string }[] | null;
          requires_approval: boolean | null;
          unmatched_justification: string | null;
          source: string | null;
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
          unit: string | null; // 'chlorides' | 'plasticiser' | null — legacy text (kept in sync with unit_id)
          unit_id: string | null; // FK to units — the scoping key (27_plant_unit_scoping.sql)
          schedule_id: string | null;
          description: string | null;
          due_date: string | null;
          raised_by: string | null;
          raised_role: string | null;
          assigned_to: string | null;
          completion_photo_url: string | null;
          defective_part_photo_url: string | null;
          defective_part_decision: 'repair' | 'scrap' | null;
          defective_raise_photo_url: string | null; // optional photo of the broken item at raise
          pm_items_count: number | null;            // Purchase Manager: declared # items
          pm_bill_total: number | null;             // Purchase Manager: declared bill total
          pm_bill_url: string | null;               // supplier bill photo (aggregate)
          pm_billed_by: string | null;              // Purchase Manager who billed
          pm_billed_at: string | null;              // when the bill was uploaded
          checklist: { component: string; activity: string; done?: boolean }[] | null; // PM checkpoints
          requires_approval: boolean | null;        // periodic: needs unit-head verify
          pm_ocr_total: number | null;              // OCR-read total
          pm_ocr_items: number | null;              // OCR-read line-item count
          pm_ocr_status: string | null;             // 'match' | 'mismatch' | 'unread' | null
          pm_ocr_raw: unknown | null;               // raw OCR payload
          pm_mismatch: boolean | null;              // declared vs OCR disagree (advisory, never blocks)
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
          unit: string | null;            // Units | mg | g | kg | mL | L
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
          store_item_id: string | null;
          split_group: string | null;
          purchased_qty: number | null;
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
          note: string | null;
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
          plant_id: string | null; // scoping key (27_plant_unit_scoping.sql)
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
          plant_id: string | null; // scoping key (27_plant_unit_scoping.sql)
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

      // Read / delivery receipts on note mentions (one row per note × tagged
      // person). delivered_at = notification created OK; seen_at = comment
      // scrolled into view. See 23_note_receipts.sql.
      entity_note_receipts: {
        Row: {
          id: string;
          note_id: string;
          entity_type: string;
          entity_id: string;
          profile_id: string;
          delivered_at: string | null;
          seen_at: string | null;
          created_at: string;
        };
        Insert: OptionalNulls<Omit<Database['public']['Tables']['entity_note_receipts']['Row'], 'id' | 'created_at'>>;
        Update: Partial<Database['public']['Tables']['entity_note_receipts']['Insert']>;
      };
    };
  };
}
