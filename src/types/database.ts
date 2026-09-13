export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      chat_messages: {
        Row: {
          client_id: string
          content: string
          created_at: string
          group_id: string
          id: string
          sender_id: string
        }
        Insert: {
          client_id: string
          content: string
          created_at?: string
          group_id: string
          id?: string
          sender_id: string
        }
        Update: {
          client_id?: string
          content?: string
          created_at?: string
          group_id?: string
          id?: string
          sender_id?: string
        }
        Relationships: [
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
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_reads: {
        Row: {
          group_id: string
          last_read_at: string
          last_read_message_id: string | null
          user_id: string
        }
        Insert: {
          group_id: string
          last_read_at?: string
          last_read_message_id?: string | null
          user_id: string
        }
        Update: {
          group_id?: string
          last_read_at?: string
          last_read_message_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_reads_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_reads_last_read_message_id_fkey"
            columns: ["last_read_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_participants: {
        Row: {
          expense_id: string
          guest_id: string | null
          kind: Database["public"]["Enums"]["participant_kind"]
          paid_cents: number
          participant_index: number
          share_cents: number
          user_id: string | null
        }
        Insert: {
          expense_id: string
          guest_id?: string | null
          kind: Database["public"]["Enums"]["participant_kind"]
          paid_cents?: number
          participant_index: number
          share_cents: number
          user_id?: string | null
        }
        Update: {
          expense_id?: string
          guest_id?: string | null
          kind?: Database["public"]["Enums"]["participant_kind"]
          paid_cents?: number
          participant_index?: number
          share_cents?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_participants_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_participants_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_versions: {
        Row: {
          author_id: string
          change_summary: Json | null
          created_at: string
          expense_id: string
          expense_type: Database["public"]["Enums"]["expense_type"]
          fixed_fee_cents: number
          merchant_name: string | null
          payload: Json
          service_fee_bps: number
          title: string
          total_cents: number
          version_no: number
        }
        Insert: {
          author_id: string
          change_summary?: Json | null
          created_at?: string
          expense_id: string
          expense_type: Database["public"]["Enums"]["expense_type"]
          fixed_fee_cents?: number
          merchant_name?: string | null
          payload: Json
          service_fee_bps?: number
          title: string
          total_cents: number
          version_no: number
        }
        Update: {
          author_id?: string
          change_summary?: Json | null
          created_at?: string
          expense_id?: string
          expense_type?: Database["public"]["Enums"]["expense_type"]
          fixed_fee_cents?: number
          merchant_name?: string | null
          payload?: Json
          service_fee_bps?: number
          title?: string
          total_cents?: number
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "expense_versions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_versions_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          chave_acesso: string | null
          client_id: string
          created_at: string
          creator_id: string
          current_version_no: number
          deleted_at: string | null
          deleted_by: string | null
          group_id: string
          id: string
          occurred_on: string
          status: Database["public"]["Enums"]["expense_status"]
        }
        Insert: {
          chave_acesso?: string | null
          client_id: string
          created_at?: string
          creator_id: string
          current_version_no?: number
          deleted_at?: string | null
          deleted_by?: string | null
          group_id: string
          id?: string
          occurred_on: string
          status?: Database["public"]["Enums"]["expense_status"]
        }
        Update: {
          chave_acesso?: string | null
          client_id?: string
          created_at?: string
          creator_id?: string
          current_version_no?: number
          deleted_at?: string | null
          deleted_by?: string | null
          group_id?: string
          id?: string
          occurred_on?: string
          status?: Database["public"]["Enums"]["expense_status"]
        }
        Relationships: [
          {
            foreignKeyName: "expenses_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_deleted_by_fkey"
            columns: ["deleted_by"]
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
      group_balances: {
        Row: {
          group_id: string
          kind: Database["public"]["Enums"]["participant_kind"]
          net_cents: number
          participant_id: string
        }
        Insert: {
          group_id: string
          kind: Database["public"]["Enums"]["participant_kind"]
          net_cents: number
          participant_id: string
        }
        Update: {
          group_id?: string
          kind?: Database["public"]["Enums"]["participant_kind"]
          net_cents?: number
          participant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_balances_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_events: {
        Row: {
          actor_id: string | null
          created_at: string
          expense_id: string | null
          group_id: string
          id: number
          kind: Database["public"]["Enums"]["event_kind"]
          notified_at: string | null
          payload: Json
          settlement_id: string | null
          subject_user_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          expense_id?: string | null
          group_id: string
          id?: never
          kind: Database["public"]["Enums"]["event_kind"]
          notified_at?: string | null
          payload?: Json
          settlement_id?: string | null
          subject_user_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          expense_id?: string | null
          group_id?: string
          id?: never
          kind?: Database["public"]["Enums"]["event_kind"]
          notified_at?: string | null
          payload?: Json
          settlement_id?: string | null
          subject_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_events_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_events_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_events_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_events_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
          token: string
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
          invited_by: string | null
          status: Database["public"]["Enums"]["member_status"]
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          group_id: string
          invited_by?: string | null
          status?: Database["public"]["Enums"]["member_status"]
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          group_id?: string
          invited_by?: string | null
          status?: Database["public"]["Enums"]["member_status"]
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
            referencedRelation: "users"
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
          dm_user_a: string | null
          dm_user_b: string | null
          id: string
          kind: Database["public"]["Enums"]["group_kind"]
          ledger_version: number
          name: string
        }
        Insert: {
          created_at?: string
          creator_id: string
          dm_user_a?: string | null
          dm_user_b?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["group_kind"]
          ledger_version?: number
          name: string
        }
        Update: {
          created_at?: string
          creator_id?: string
          dm_user_a?: string | null
          dm_user_b?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["group_kind"]
          ledger_version?: number
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_dm_user_a_fkey"
            columns: ["dm_user_a"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_dm_user_b_fkey"
            columns: ["dm_user_b"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      guests: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          display_name: string
          expense_id: string
          id: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          display_name: string
          expense_id: string
          id?: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          display_name?: string
          expense_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guests_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guests_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          channel: string
          created_at: string
          endpoint_digest: string
          id: string
          subscription_encrypted: string
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          endpoint_digest: string
          id?: string
          subscription_encrypted: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          endpoint_digest?: string
          id?: string
          subscription_encrypted?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
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
          count: number
          subject: string
          window_start: string
        }
        Insert: {
          bucket: string
          count: number
          subject: string
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          subject?: string
          window_start?: string
        }
        Relationships: []
      }
      settlements: {
        Row: {
          amount_cents: number
          confirmed_at: string | null
          created_at: string
          created_by: string
          from_user_id: string
          group_id: string
          id: string
          operation_id: string
          status: Database["public"]["Enums"]["settlement_status"]
          to_user_id: string
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount_cents: number
          confirmed_at?: string | null
          created_at?: string
          created_by: string
          from_user_id: string
          group_id: string
          id?: string
          operation_id: string
          status?: Database["public"]["Enums"]["settlement_status"]
          to_user_id: string
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount_cents?: number
          confirmed_at?: string | null
          created_at?: string
          created_by?: string
          from_user_id?: string
          group_id?: string
          id?: string
          operation_id?: string
          status?: Database["public"]["Enums"]["settlement_status"]
          to_user_id?: string
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settlements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
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
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_voided_by_fkey"
            columns: ["voided_by"]
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
          email: string
          handle: string
          id: string
          name: string
          notification_preferences: Json
          onboarded: boolean
          pix_key_encrypted: string | null
          pix_key_hint: string | null
          pix_key_type: Database["public"]["Enums"]["pix_key_type"] | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          handle: string
          id: string
          name: string
          notification_preferences?: Json
          onboarded?: boolean
          pix_key_encrypted?: string | null
          pix_key_hint?: string | null
          pix_key_type?: Database["public"]["Enums"]["pix_key_type"] | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          handle?: string
          id?: string
          name?: string
          notification_preferences?: Json
          onboarded?: boolean
          pix_key_encrypted?: string | null
          pix_key_hint?: string | null
          pix_key_type?: Database["public"]["Enums"]["pix_key_type"] | null
          updated_at?: string
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
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { p_group_id: string }; Returns: Json }
      assert_member: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: undefined
      }
      assert_member_or_invited: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: undefined
      }
      bootstrap: { Args: never; Returns: Json }
      broadcast_group: {
        Args: {
          p_event_id: number
          p_group_id: string
          p_ledger_version: number
        }
        Returns: undefined
      }
      claim_guest: { Args: { p_token: string }; Returns: Json }
      cleanup_expired_rate_limit_counters: { Args: never; Returns: number }
      confirm_vendor_charge: { Args: { p_charge_id: string }; Returns: Json }
      create_expense: {
        Args: {
          p_chave_acesso?: string | null
          p_client_id: string
          p_expense_type: Database["public"]["Enums"]["expense_type"]
          p_fixed_fee_cents: number
          p_group_id: string
          p_merchant_name: string
          p_occurred_on: string
          p_payload: Json
          p_service_fee_bps: number
          p_title: string
          p_total_cents: number
        }
        Returns: Json
      }
      complete_onboarding: {
        Args: {
          p_handle: string
          p_name: string
          p_pix_key_encrypted: string
          p_pix_key_hint: string
          p_pix_key_type: Database["public"]["Enums"]["pix_key_type"]
        }
        Returns: Json
      }
      create_group: {
        Args: { p_member_ids: string[]; p_name: string }
        Returns: Json
      }
      create_guest_claim_token: { Args: { p_guest_id: string }; Returns: Json }
      create_invite_link: {
        Args: { p_expires_at?: string; p_group_id: string; p_max_uses?: number }
        Returns: Json
      }
      current_user_id: { Args: never; Returns: string }
      deactivate_invite_link: { Args: { p_group_id: string }; Returns: Json }
      decline_invitation: { Args: { p_group_id: string }; Returns: Json }
      delete_expense: { Args: { p_expense_id: string }; Returns: Json }
      delete_group: { Args: { p_group_id: string }; Returns: Json }
      edit_expense: {
        Args: {
          p_expected_version_no: number
          p_expense_id: string
          p_expense_type: Database["public"]["Enums"]["expense_type"]
          p_fixed_fee_cents: number
          p_merchant_name: string
          p_occurred_on: string
          p_payload: Json
          p_service_fee_bps: number
          p_title: string
          p_total_cents: number
        }
        Returns: Json
      }
      emit_event: {
        Args: {
          p_actor: string
          p_expense_id?: string
          p_group_id: string
          p_kind: Database["public"]["Enums"]["event_kind"]
          p_payload?: Json
          p_settlement_id?: string
          p_subject_user_id?: string
        }
        Returns: number
      }
      expense_change_summary: {
        Args: { p_expense_id: string; p_from: number; p_to: number }
        Returns: Json
      }
      get_activity: {
        Args: { p_before_id: number; p_limit?: number }
        Returns: Json
      }
      get_conversation: {
        Args: {
          p_event_before_created_at?: string | null
          p_event_before_id?: number | null
          p_group_id: string
          p_limit?: number
          p_message_before_created_at?: string | null
          p_message_before_id?: string | null
        }
        Returns: Json
      }
      get_expense: { Args: { p_expense_id: string }; Returns: Json }
      get_group: { Args: { p_group_id: string }; Returns: Json }
      get_group_expenses: {
        Args: {
          p_before_created_at?: string | null
          p_before_id?: string | null
          p_group_id: string
          p_limit?: number
        }
        Returns: Json
      }
      get_my_expenses: {
        Args: {
          p_before_created_at?: string | null
          p_before_id?: string | null
          p_limit?: number
        }
        Returns: Json
      }
      get_my_profile: { Args: never; Returns: Json }
      get_or_create_dm: { Args: { p_user_id: string }; Returns: Json }
      get_vendor_charges: { Args: { p_limit?: number }; Returns: Json }
      group_transfers: {
        Args: { p_group_id: string }
        Returns: {
          amount_cents: number
          from_id: string
          from_kind: Database["public"]["Enums"]["participant_kind"]
          to_id: string
        }[]
      }
      increment_rate_limit: {
        Args: {
          p_bucket: string
          p_limit: number
          p_subject: string
          p_window_seconds: number
        }
        Returns: boolean
      }
      invite_member: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: Json
      }
      is_member: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: boolean
      }
      join_via_link: { Args: { p_token: string }; Returns: Json }
      leave_group: { Args: { p_group_id: string }; Returns: Json }
      ledger_chat_message_json: {
        Args: { p_message_id: string }
        Returns: Json
      }
      ledger_event_json: { Args: { p_event_id: number }; Returns: Json }
      ledger_expense_summary_json: {
        Args: { p_expense_id: string; p_viewer: string }
        Returns: Json
      }
      ledger_expense_version_json: {
        Args: { p_expense_id: string; p_version_no: number }
        Returns: Json
      }
      ledger_group_snapshot_json: {
        Args: { p_group_id: string; p_viewer: string }
        Returns: Json
      }
      ledger_me_json: { Args: { p_user_id: string }; Returns: Json }
      ledger_settlement_json: {
        Args: { p_settlement_id: string }
        Returns: Json
      }
      ledger_user_profile_json: { Args: { p_user_id: string }; Returns: Json }
      lock_group: { Args: { p_group_id: string }; Returns: undefined }
      lock_receipt_key: {
        Args: { p_chave_acesso: string | null; p_creator_id: string }
        Returns: undefined
      }
      lookup_user_by_handle: { Args: { p_handle: string }; Returns: Json }
      mark_read: {
        Args: { p_group_id: string; p_last_read_message_id: string }
        Returns: undefined
      }
      materialize_participants: {
        Args: { p_author: string; p_expense_id: string; p_payload: Json }
        Returns: Json
      }
      preview_invite_link: { Args: { p_token: string }; Returns: Json }
      recompute_group_balances: {
        Args: { p_group_id: string }
        Returns: number
      }
      record_settlement: {
        Args: {
          p_amount_cents: number
          p_from_user_id: string
          p_group_id: string
          p_operation_id: string
          p_to_user_id: string
          p_allow_overpay?: boolean
        }
        Returns: Json
      }
      cancel_vendor_charge: {
        Args: { p_charge_id: string }
        Returns: undefined
      }
      record_vendor_charge: {
        Args: { p_amount_cents: number; p_description?: string }
        Returns: Json
      }
      remove_member: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: Json
      }
      resolve_guest_claim_token: { Args: { p_token: string }; Returns: Json }
      restore_expense: { Args: { p_expense_id: string }; Returns: Json }
      revoke_guest_claim_token: { Args: { p_guest_id: string }; Returns: Json }
      send_message: {
        Args: { p_client_id: string; p_content: string; p_group_id: string }
        Returns: Json
      }
      send_nudge: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: Json
      }
      update_profile: {
        Args: {
          p_handle?: string
          p_name?: string
          p_notification_preferences?: Json
        }
        Returns: Json
      }
      validate_expense_payload: {
        Args: {
          p: Json
          p_expense_type: Database["public"]["Enums"]["expense_type"]
          p_fee_bps: number
          p_fixed_fee: number
          p_total: number
        }
        Returns: Json
      }
      void_settlement: { Args: { p_settlement_id: string }; Returns: Json }
    }
    Enums: {
      event_kind:
        | "expense_created"
        | "expense_edited"
        | "expense_deleted"
        | "expense_restored"
        | "settlement_recorded"
        | "settlement_voided"
        | "member_invited"
        | "member_joined"
        | "member_left"
        | "member_removed"
        | "guest_claimed"
        | "nudge"
      expense_status: "active" | "deleted"
      expense_type: "itemized" | "single_amount"
      group_kind: "group" | "dm"
      member_status: "invited" | "accepted"
      participant_kind: "user" | "guest"
      pix_key_type: "cpf" | "email" | "phone" | "random"
      settlement_status: "confirmed" | "voided"
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
      event_kind: [
        "expense_created",
        "expense_edited",
        "expense_deleted",
        "expense_restored",
        "settlement_recorded",
        "settlement_voided",
        "member_invited",
        "member_joined",
        "member_left",
        "member_removed",
        "guest_claimed",
        "nudge",
      ],
      expense_status: ["active", "deleted"],
      expense_type: ["itemized", "single_amount"],
      group_kind: ["group", "dm"],
      member_status: ["invited", "accepted"],
      participant_kind: ["user", "guest"],
      pix_key_type: ["cpf", "email", "phone", "random"],
      settlement_status: ["confirmed", "voided"],
    },
  },
} as const

