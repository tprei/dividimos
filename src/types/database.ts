export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      balances: {
        Row: {
          amount_cents: number
          group_id: string
          updated_at: string
          user_a: string
          user_b: string
        }
        Insert: {
          amount_cents?: number
          group_id: string
          updated_at?: string
          user_a: string
          user_b: string
        }
        Update: {
          amount_cents?: number
          group_id?: string
          updated_at?: string
          user_a?: string
          user_b?: string
        }
        Relationships: [
          {
            foreignKeyName: "balances_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balances_user_a_fkey"
            columns: ["user_a"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balances_user_a_fkey"
            columns: ["user_a"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balances_user_b_fkey"
            columns: ["user_b"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balances_user_b_fkey"
            columns: ["user_b"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          expense_id: string | null
          group_id: string
          id: string
          message_type: Database["public"]["Enums"]["chat_message_type"]
          sender_id: string
          settlement_id: string | null
        }
        Insert: {
          content?: string
          created_at?: string
          expense_id?: string | null
          group_id: string
          id?: string
          message_type?: Database["public"]["Enums"]["chat_message_type"]
          sender_id: string
          settlement_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          expense_id?: string | null
          group_id?: string
          id?: string
          message_type?: Database["public"]["Enums"]["chat_message_type"]
          sender_id?: string
          settlement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_read_receipts: {
        Row: {
          group_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          group_id: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          group_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_read_receipts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_read_receipts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_read_receipts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_pairs: {
        Row: {
          group_id: string
          user_a: string
          user_b: string
        }
        Insert: {
          group_id: string
          user_a: string
          user_b: string
        }
        Update: {
          group_id?: string
          user_a?: string
          user_b?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_pairs_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: true
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_pairs_user_a_fkey"
            columns: ["user_a"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_pairs_user_a_fkey"
            columns: ["user_a"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_pairs_user_b_fkey"
            columns: ["user_b"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_pairs_user_b_fkey"
            columns: ["user_b"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_guest_shares: {
        Row: {
          expense_id: string
          guest_id: string
          id: string
          share_amount_cents: number
        }
        Insert: {
          expense_id: string
          guest_id: string
          id?: string
          share_amount_cents: number
        }
        Update: {
          expense_id?: string
          guest_id?: string
          id?: string
          share_amount_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "expense_guest_shares_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_guest_shares_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "expense_guests"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_guests: {
        Row: {
          claim_token: string
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          display_name: string
          expense_id: string
          id: string
        }
        Insert: {
          claim_token?: string
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          display_name: string
          expense_id: string
          id?: string
        }
        Update: {
          claim_token?: string
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          display_name?: string
          expense_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_guests_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_guests_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_guests_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_items: {
        Row: {
          created_at: string
          description: string
          expense_id: string
          id: string
          quantity: number
          total_price_cents: number
          unit_price_cents: number
        }
        Insert: {
          created_at?: string
          description: string
          expense_id: string
          id?: string
          quantity?: number
          total_price_cents: number
          unit_price_cents: number
        }
        Update: {
          created_at?: string
          description?: string
          expense_id?: string
          id?: string
          quantity?: number
          total_price_cents?: number
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "expense_items_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_payers: {
        Row: {
          amount_cents: number
          expense_id: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          expense_id: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          expense_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_payers_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_payers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_payers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_shares: {
        Row: {
          expense_id: string
          id: string
          share_amount_cents: number
          user_id: string
        }
        Insert: {
          expense_id: string
          id?: string
          share_amount_cents: number
          user_id: string
        }
        Update: {
          expense_id?: string
          id?: string
          share_amount_cents?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_shares_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_shares_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_shares_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          created_at: string
          creator_id: string
          expense_type: Database["public"]["Enums"]["expense_type"]
          fixed_fees: number
          group_id: string
          id: string
          merchant_name: string | null
          service_fee_percent: number
          status: Database["public"]["Enums"]["expense_status"]
          title: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          creator_id: string
          expense_type?: Database["public"]["Enums"]["expense_type"]
          fixed_fees?: number
          group_id: string
          id?: string
          merchant_name?: string | null
          service_fee_percent?: number
          status?: Database["public"]["Enums"]["expense_status"]
          title: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          creator_id?: string
          expense_type?: Database["public"]["Enums"]["expense_type"]
          fixed_fees?: number
          group_id?: string
          id?: string
          merchant_name?: string | null
          service_fee_percent?: number
          status?: Database["public"]["Enums"]["expense_status"]
          title?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_invite_links: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          group_id: string
          id: string
          is_active: boolean
          max_uses: number | null
          token: string
          use_count: number
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          group_id: string
          id?: string
          is_active?: boolean
          max_uses?: number | null
          token?: string
          use_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          group_id?: string
          id?: string
          is_active?: boolean
          max_uses?: number | null
          token?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "group_invite_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_invite_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_invite_links_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          accepted_at: string | null
          created_at: string
          group_id: string
          invited_by: string
          status: Database["public"]["Enums"]["group_member_status"]
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          group_id: string
          invited_by: string
          status?: Database["public"]["Enums"]["group_member_status"]
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          group_id?: string
          invited_by?: string
          status?: Database["public"]["Enums"]["group_member_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          creator_id: string
          id: string
          is_dm: boolean
          name: string
        }
        Insert: {
          created_at?: string
          creator_id: string
          id?: string
          is_dm?: boolean
          name: string
        }
        Update: {
          created_at?: string
          creator_id?: string
          id?: string
          is_dm?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          channel: string
          created_at: string
          id: string
          subscription: string
          user_id: string
        }
        Insert: {
          channel?: string
          created_at?: string
          id?: string
          subscription: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          subscription?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          amount_cents: number
          confirmed_at: string | null
          created_at: string
          from_user_id: string
          group_id: string
          id: string
          status: Database["public"]["Enums"]["settlement_status"]
          to_user_id: string
        }
        Insert: {
          amount_cents: number
          confirmed_at?: string | null
          created_at?: string
          from_user_id: string
          group_id: string
          id?: string
          status?: Database["public"]["Enums"]["settlement_status"]
          to_user_id: string
        }
        Update: {
          amount_cents?: number
          confirmed_at?: string | null
          created_at?: string
          from_user_id?: string
          group_id?: string
          id?: string
          status?: Database["public"]["Enums"]["settlement_status"]
          to_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlements_from_user_id_fkey"
            columns: ["from_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_from_user_id_fkey"
            columns: ["from_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_to_user_id_fkey"
            columns: ["to_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_to_user_id_fkey"
            columns: ["to_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          handle: string | null
          id: string
          name: string
          notification_preferences: Json
          onboarded: boolean
          pix_key_encrypted: string
          pix_key_hint: string
          pix_key_type: Database["public"]["Enums"]["pix_key_type"]
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          handle?: string | null
          id?: string
          name: string
          notification_preferences?: Json
          onboarded?: boolean
          pix_key_encrypted: string
          pix_key_hint?: string
          pix_key_type?: Database["public"]["Enums"]["pix_key_type"]
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          handle?: string | null
          id?: string
          name?: string
          notification_preferences?: Json
          onboarded?: boolean
          pix_key_encrypted?: string
          pix_key_hint?: string
          pix_key_type?: Database["public"]["Enums"]["pix_key_type"]
        }
        Relationships: []
      }
      vendor_charges: {
        Row: {
          amount_cents: number
          confirmed_at: string | null
          created_at: string
          description: string | null
          id: string
          status: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          confirmed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          status?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          confirmed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_charges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_charges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_counters: {
        Row: {
          bucket: string
          subject: string
          window_start: string
          count: number
        }
        Insert: {
          bucket: string
          subject: string
          window_start: string
          count: number
        }
        Update: {
          bucket?: string
          subject?: string
          window_start?: string
          count?: number
        }
        Relationships: []
      }
    }
    Views: {
      user_profiles: {
        Row: {
          avatar_url: string | null
          handle: string | null
          id: string | null
          name: string | null
        }
        Insert: {
          avatar_url?: string | null
          handle?: string | null
          id?: string | null
          name?: string | null
        }
        Update: {
          avatar_url?: string | null
          handle?: string | null
          id?: string | null
          name?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      increment_rate_limit: {
        Args: {
          p_bucket: string
          p_subject: string
          p_limit: number
          p_window_seconds: number
        }
        Returns: number
      }
      activate_expense: { Args: { p_expense_id: string }; Returns: undefined }
      claim_guest_spot: { Args: { p_claim_token: string }; Returns: Json }
      confirm_settlement: {
        Args: { p_settlement_id: string }
        Returns: undefined
      }
      confirm_vendor_charge: {
        Args: { p_charge_id: string }
        Returns: undefined
      }
      get_dm_previews: {
        Args: { p_group_ids: string[] }
        Returns: {
          group_id: string
          content: string
          message_type: string
          created_at: string
        }[]
      }
      get_or_create_dm_group: {
        Args: { p_other_user_id: string }
        Returns: string
      }
      get_unread_counts: {
        Args: { p_group_ids: string[] }
        Returns: {
          group_id: string
          unread_count: number
        }[]
      }
      has_outstanding_balance: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: boolean
      }
      join_group_via_link: { Args: { p_token: string }; Returns: Json }
      leave_group: { Args: { p_group_id: string }; Returns: undefined }
      lookup_user_by_handle: {
        Args: { p_handle: string }
        Returns: {
          avatar_url: string
          handle: string
          id: string
          name: string
        }[]
      }
      my_accepted_group_ids: { Args: never; Returns: string[] }
      my_group_ids: { Args: never; Returns: string[] }
      record_and_settle: {
        Args: {
          p_amount_cents: number
          p_from_user_id: string
          p_group_id: string
          p_to_user_id: string
        }
        Returns: string
      }
      remove_group_member: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      chat_message_type: "text" | "system_expense" | "system_settlement"
      expense_status: "draft" | "active" | "settled"
      expense_type: "itemized" | "single_amount"
      group_member_status: "invited" | "accepted"
      pix_key_type: "cpf" | "email" | "random" | "phone"
      settlement_status: "pending" | "confirmed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      chat_message_type: ["text", "system_expense", "system_settlement"],
      expense_status: ["draft", "active", "settled"],
      expense_type: ["itemized", "single_amount"],
      group_member_status: ["invited", "accepted"],
      pix_key_type: ["cpf", "email", "random", "phone"],
      settlement_status: ["pending", "confirmed"],
    },
  },
} as const
