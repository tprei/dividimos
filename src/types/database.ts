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
          operationName?: string
          query?: string
          variables?: Json
          extensions?: Json
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
      assignment_room_claims: {
        Row: {
          item_id: string
          participant_id: string
          room_id: string
          ticks: number
        }
        Insert: {
          item_id: string
          participant_id: string
          room_id: string
          ticks: number
        }
        Update: {
          item_id?: string
          participant_id?: string
          room_id?: string
          ticks?: number
        }
        Relationships: [
          {
            foreignKeyName: "assignment_room_claims_room_id_item_id_fkey"
            columns: ["room_id", "item_id"]
            isOneToOne: false
            referencedRelation: "assignment_room_items"
            referencedColumns: ["room_id", "id"]
          },
          {
            foreignKeyName: "assignment_room_claims_room_id_participant_id_fkey"
            columns: ["room_id", "participant_id"]
            isOneToOne: false
            referencedRelation: "assignment_room_participants"
            referencedColumns: ["room_id", "id"]
          },
        ]
      }
      assignment_room_items: {
        Row: {
          description: string
          id: string
          ordinal: number
          quantity_milliunits: number
          revision: number
          room_id: string
          total_price_cents: number
          unit_price_cents: number
        }
        Insert: {
          description: string
          id: string
          ordinal: number
          quantity_milliunits: number
          revision?: number
          room_id: string
          total_price_cents: number
          unit_price_cents: number
        }
        Update: {
          description?: string
          id?: string
          ordinal?: number
          quantity_milliunits?: number
          revision?: number
          room_id?: string
          total_price_cents?: number
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "assignment_room_items_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "assignment_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_room_participants: {
        Row: {
          display_name: string
          expense_participant_index: number | null
          id: string
          ordinal: number
          removed_at: string | null
          room_id: string
          user_id: string | null
        }
        Insert: {
          display_name: string
          expense_participant_index?: number | null
          id: string
          ordinal: number
          removed_at?: string | null
          room_id: string
          user_id?: string | null
        }
        Update: {
          display_name?: string
          expense_participant_index?: number | null
          id?: string
          ordinal?: number
          removed_at?: string | null
          room_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assignment_room_participants_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "assignment_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_room_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_rooms: {
        Row: {
          closed_at: string | null
          created_at: string
          expense_id: string | null
          group_target: Json
          header: Json
          host_user_id: string
          id: string
          revision: number
          status: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          expense_id?: string | null
          group_target: Json
          header: Json
          host_user_id: string
          id: string
          revision?: number
          status?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          expense_id?: string | null
          group_target?: Json
          header?: Json
          host_user_id?: string
          id?: string
          revision?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_rooms_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: true
            referencedRelation: "current_expense_participants"
            referencedColumns: ["expense_id"]
          },
          {
            foreignKeyName: "assignment_rooms_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: true
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_rooms_host_user_id_fkey"
            columns: ["host_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
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
      expense_versions: {
        Row: {
          author_id: string
          change_summary: Json | null
          created_at: string
          expense_id: string
          expense_type: Database["public"]["Enums"]["expense_type"]
          fixed_fee_cents: number
          merchant_name: string | null
          occurred_on: string
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
          occurred_on: string
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
          occurred_on?: string
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
            referencedRelation: "current_expense_participants"
            referencedColumns: ["expense_id"]
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
          declined_user_ids: string[]
          deleted_at: string | null
          deleted_by: string | null
          group_id: string
          id: string
          status: Database["public"]["Enums"]["expense_status"]
        }
        Insert: {
          chave_acesso?: string | null
          client_id: string
          created_at?: string
          creator_id: string
          current_version_no?: number
          declined_user_ids?: string[]
          deleted_at?: string | null
          deleted_by?: string | null
          group_id: string
          id?: string
          status?: Database["public"]["Enums"]["expense_status"]
        }
        Update: {
          chave_acesso?: string | null
          client_id?: string
          created_at?: string
          creator_id?: string
          current_version_no?: number
          declined_user_ids?: string[]
          deleted_at?: string | null
          deleted_by?: string | null
          group_id?: string
          id?: string
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
            foreignKeyName: "expenses_current_version_fk"
            columns: ["id", "current_version_no"]
            isOneToOne: false
            referencedRelation: "expense_versions"
            referencedColumns: ["expense_id", "version_no"]
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
            referencedRelation: "current_expense_participants"
            referencedColumns: ["expense_id"]
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
      group_member_exclusions: {
        Row: {
          excluded_at: string
          excluded_by: string
          group_id: string
          user_id: string
        }
        Insert: {
          excluded_at?: string
          excluded_by: string
          group_id: string
          user_id: string
        }
        Update: {
          excluded_at?: string
          excluded_by?: string
          group_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_member_exclusions_excluded_by_fkey"
            columns: ["excluded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_member_exclusions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_member_exclusions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
          avatar_emoji: string | null
          avatar_photo_id: string | null
          created_at: string
          creator_id: string
          dm_user_a: string | null
          dm_user_b: string | null
          financial_history_shared_at: string | null
          id: string
          kind: Database["public"]["Enums"]["group_kind"]
          ledger_version: number
          name: string
        }
        Insert: {
          avatar_emoji?: string | null
          avatar_photo_id?: string | null
          created_at?: string
          creator_id: string
          dm_user_a?: string | null
          dm_user_b?: string | null
          financial_history_shared_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["group_kind"]
          ledger_version?: number
          name: string
        }
        Update: {
          avatar_emoji?: string | null
          avatar_photo_id?: string | null
          created_at?: string
          creator_id?: string
          dm_user_a?: string | null
          dm_user_b?: string | null
          financial_history_shared_at?: string | null
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
          claimed_version_no: number | null
          created_at: string
          display_name: string
          expense_id: string
          id: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          claimed_version_no?: number | null
          created_at?: string
          display_name: string
          expense_id: string
          id?: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          claimed_version_no?: number | null
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
            foreignKeyName: "guests_claimed_version_fk"
            columns: ["expense_id", "claimed_version_no"]
            isOneToOne: false
            referencedRelation: "expense_versions"
            referencedColumns: ["expense_id", "version_no"]
          },
          {
            foreignKeyName: "guests_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "current_expense_participants"
            referencedColumns: ["expense_id"]
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
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          endpoint_digest: string
          id?: string
          subscription_encrypted: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          endpoint_digest?: string
          id?: string
          subscription_encrypted?: string
          updated_at?: string
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
          is_bot: boolean
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
          is_bot?: boolean
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
          is_bot?: boolean
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
      current_expense_participants: {
        Row: {
          expense_id: string | null
          guest_id: string | null
          kind: Database["public"]["Enums"]["participant_kind"] | null
          paid_cents: number | null
          participant_index: number | null
          share_cents: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_invitation: {
        Args: {
          p_group_id: string
        }
        Returns: Json
      }
      announce_assignment_room: {
        Args: {
          p_room_id: string
        }
        Returns: Json
      }
      assert_dm_pair_allowed: {
        Args: {
          p_group_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      assert_member: {
        Args: {
          p_group_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      assert_member_or_invited: {
        Args: {
          p_group_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      assignment_room_bill_breakdown: {
        Args: {
          p_expense_id: string
        }
        Returns: Json
      }
      assignment_room_expense_payload: {
        Args: {
          p_room_id: string
          p_group_id: string
          p_payers: Json
        }
        Returns: Json
      }
      assignment_room_topic_allowed: {
        Args: {
          p_topic: string
        }
        Returns: boolean
      }
      assignment_room_view: {
        Args: {
          p_room_id: string
          p_self_participant_id: string
          p_host: boolean
        }
        Returns: Json
      }
      bootstrap: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      bootstrap_overview: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      broadcast_assignment_room: {
        Args: {
          p_room_id: string
          p_event?: string
          p_topic?: string
        }
        Returns: undefined
      }
      broadcast_group: {
        Args: {
          p_group_id: string
          p_ledger_version: number
          p_event_id: number
        }
        Returns: undefined
      }
      broadcast_user: {
        Args: {
          p_user_id: string
          p_group_id: string
        }
        Returns: undefined
      }
      cancel_assignment_room: {
        Args: {
          p_room_id: string
          p_expected_revision: number
        }
        Returns: Json
      }
      cancel_vendor_charge: {
        Args: {
          p_charge_id: string
        }
        Returns: undefined
      }
      claim_assignment_room_guest: {
        Args: {
          p_room_id: string
          p_member_token: string
        }
        Returns: Json
      }
      claim_guest: {
        Args: {
          p_token: string
        }
        Returns: Json
      }
      claim_guest_participant: {
        Args: {
          p_guest_id: string
        }
        Returns: Json
      }
      claim_push_subscription: {
        Args: {
          p_user_id: string
          p_channel: string
          p_endpoint_digest: string
          p_subscription_encrypted: string
        }
        Returns: Json
      }
      cleanup_expired_rate_limit_counters: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      close_assignment_room: {
        Args: {
          p_room_id: string
          p_expected_revision: number
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
      confirm_vendor_charge: {
        Args: {
          p_charge_id: string
        }
        Returns: Json
      }
      create_assignment_room: {
        Args: {
          p_room_id: string
          p_group_target: Json
          p_header: Json
          p_items: Json
          p_participants: Json
          p_join_token: string
        }
        Returns: Json
      }
      create_expense: {
        Args: {
          p_client_id: string
          p_group_id: string
          p_occurred_on: string
          p_title: string
          p_merchant_name: string
          p_expense_type: Database["public"]["Enums"]["expense_type"]
          p_total_cents: number
          p_service_fee_bps: number
          p_fixed_fee_cents: number
          p_payload: Json
          p_chave_acesso?: string
        }
        Returns: Json
      }
      create_expense_with_group: {
        Args: {
          p_client_id: string
          p_group_name: string
          p_member_ids: string[]
          p_occurred_on: string
          p_title: string
          p_merchant_name: string
          p_expense_type: Database["public"]["Enums"]["expense_type"]
          p_total_cents: number
          p_service_fee_bps: number
          p_fixed_fee_cents: number
          p_payload: Json
          p_chave_acesso?: string
        }
        Returns: Json
      }
      create_group: {
        Args: {
          p_name: string
          p_member_ids: string[]
        }
        Returns: Json
      }
      create_guest_claim_token: {
        Args: {
          p_guest_id: string
        }
        Returns: Json
      }
      create_invite_link: {
        Args: {
          p_group_id: string
          p_expires_at?: string
          p_max_uses?: number
        }
        Returns: Json
      }
      current_user_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      current_user_is_member: {
        Args: {
          p_group_id: string
        }
        Returns: boolean
      }
      deactivate_invite_link: {
        Args: {
          p_group_id: string
        }
        Returns: Json
      }
      decline_invitation: {
        Args: {
          p_group_id: string
        }
        Returns: Json
      }
      delete_expense: {
        Args: {
          p_expense_id: string
        }
        Returns: Json
      }
      delete_group: {
        Args: {
          p_group_id: string
        }
        Returns: Json
      }
      edit_expense: {
        Args: {
          p_expense_id: string
          p_expected_version_no: number
          p_occurred_on: string
          p_title: string
          p_merchant_name: string
          p_expense_type: Database["public"]["Enums"]["expense_type"]
          p_total_cents: number
          p_service_fee_bps: number
          p_fixed_fee_cents: number
          p_payload: Json
        }
        Returns: Json
      }
      effective_expense_payload: {
        Args: {
          p_expense_id: string
          p_version_no: number
        }
        Returns: Json
      }
      emit_event: {
        Args: {
          p_group_id: string
          p_kind: Database["public"]["Enums"]["event_kind"]
          p_actor: string
          p_expense_id?: string
          p_settlement_id?: string
          p_subject_user_id?: string
          p_payload?: Json
        }
        Returns: number
      }
      enter_group_assignment_room: {
        Args: {
          p_room_id: string
          p_member_token: string
        }
        Returns: Json
      }
      expense_change_summary: {
        Args: {
          p_expense_id: string
          p_from: number
          p_to: number
        }
        Returns: Json
      }
      finalize_assignment_room: {
        Args: {
          p_room_id: string
          p_expected_revision: number
          p_payload: Json
        }
        Returns: Json
      }
      get_activity: {
        Args: {
          p_before_id: number
          p_limit?: number
        }
        Returns: Json
      }
      get_assignment_room: {
        Args: {
          p_room_id: string
          p_member_token: string
        }
        Returns: Json
      }
      get_assignment_room_completion: {
        Args: {
          p_room_id: string
          p_member_token?: string
        }
        Returns: Json
      }
      get_conversation: {
        Args: {
          p_group_id: string
          p_message_before_created_at?: string
          p_message_before_id?: string
          p_event_before_created_at?: string
          p_event_before_id?: number
          p_limit?: number
        }
        Returns: Json
      }
      get_expense: {
        Args: {
          p_expense_id: string
        }
        Returns: Json
      }
      get_expense_context: {
        Args: {
          p_expense_id: string
        }
        Returns: Json
      }
      get_group: {
        Args: {
          p_group_id: string
        }
        Returns: Json
      }
      get_group_avatar: {
        Args: {
          p_group_id: string
        }
        Returns: Json
      }
      get_group_expenses: {
        Args: {
          p_group_id: string
          p_before_created_at?: string
          p_before_id?: string
          p_limit?: number
        }
        Returns: Json
      }
      get_group_overview: {
        Args: {
          p_group_id: string
        }
        Returns: Json
      }
      get_my_expenses: {
        Args: {
          p_before_created_at?: string
          p_before_id?: string
          p_limit?: number
        }
        Returns: Json
      }
      get_my_profile: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_or_create_dm: {
        Args: {
          p_user_id: string
        }
        Returns: Json
      }
      get_settlement: {
        Args: {
          p_settlement_id: string
        }
        Returns: Json
      }
      get_vendor_charges: {
        Args: {
          p_before_created_at?: string
          p_before_id?: string
          p_limit?: number
        }
        Returns: Json
      }
      group_pairwise_edges: {
        Args: {
          p_group_id: string
        }
        Returns: {
          from_kind: Database["public"]["Enums"]["participant_kind"]
          from_id: string
          to_id: string
          amount_cents: number
        }[]
      }
      group_transfers: {
        Args: {
          p_group_id: string
        }
        Returns: {
          from_kind: Database["public"]["Enums"]["participant_kind"]
          from_id: string
          to_id: string
          amount_cents: number
        }[]
      }
      increment_rate_limit: {
        Args: {
          p_bucket: string
          p_subject: string
          p_limit: number
          p_window_seconds: number
        }
        Returns: boolean
      }
      invite_member: {
        Args: {
          p_group_id: string
          p_user_id: string
        }
        Returns: Json
      }
      is_member: {
        Args: {
          p_group_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      is_member_or_invited: {
        Args: {
          p_group_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      join_assignment_room: {
        Args: {
          p_room_id: string
          p_join_token: string
          p_member_token: string
          p_display_name: string
        }
        Returns: Json
      }
      join_via_link: {
        Args: {
          p_token: string
        }
        Returns: Json
      }
      leave_group: {
        Args: {
          p_group_id: string
        }
        Returns: Json
      }
      ledger_chat_message_json: {
        Args: {
          p_message_id: string
        }
        Returns: Json
      }
      ledger_event_json: {
        Args: {
          p_event_id: number
        }
        Returns: Json
      }
      ledger_expense_summary_json: {
        Args: {
          p_expense_id: string
          p_viewer: string
        }
        Returns: Json
      }
      ledger_expense_version_json: {
        Args: {
          p_expense_id: string
          p_version_no: number
        }
        Returns: Json
      }
      ledger_group_overview_json: {
        Args: {
          p_group_id: string
          p_viewer: string
        }
        Returns: Json
      }
      ledger_group_snapshot_json: {
        Args: {
          p_group_id: string
          p_viewer: string
        }
        Returns: Json
      }
      ledger_me_json: {
        Args: {
          p_user_id: string
        }
        Returns: Json
      }
      ledger_settlement_json: {
        Args: {
          p_settlement_id: string
        }
        Returns: Json
      }
      ledger_user_profile_json: {
        Args: {
          p_user_id: string
        }
        Returns: Json
      }
      list_open_assignment_rooms: {
        Args: {
          p_group_id: string
        }
        Returns: Json
      }
      lock_group: {
        Args: {
          p_group_id: string
        }
        Returns: undefined
      }
      lock_receipt_key: {
        Args: {
          p_creator_id: string
          p_chave_acesso: string
        }
        Returns: undefined
      }
      lookup_user_by_handle: {
        Args: {
          p_handle: string
        }
        Returns: Json
      }
      mark_read: {
        Args: {
          p_group_id: string
          p_last_read_message_id: string
        }
        Returns: undefined
      }
      pairwise_from_nets: {
        Args: {
          p_kinds: Database["public"]["Enums"]["participant_kind"][]
          p_ids: string[]
          p_nets: number[]
        }
        Returns: {
          from_kind: Database["public"]["Enums"]["participant_kind"]
          from_id: string
          to_id: string
          amount_cents: number
        }[]
      }
      preview_invite_link: {
        Args: {
          p_token: string
        }
        Returns: Json
      }
      recompute_group_balances: {
        Args: {
          p_group_id: string
        }
        Returns: number
      }
      record_settlement: {
        Args: {
          p_operation_id: string
          p_group_id: string
          p_from_user_id: string
          p_to_user_id: string
          p_amount_cents: number
          p_allow_overpay?: boolean
        }
        Returns: Json
      }
      record_vendor_charge: {
        Args: {
          p_amount_cents: number
          p_description?: string
        }
        Returns: Json
      }
      refresh_assignment_room_member: {
        Args: {
          p_room_id: string
          p_member_token: string
        }
        Returns: Json
      }
      remove_assignment_room_participant: {
        Args: {
          p_room_id: string
          p_participant_id: string
          p_expected_revision: number
          p_join_token: string
        }
        Returns: Json
      }
      remove_member: {
        Args: {
          p_group_id: string
          p_user_id: string
        }
        Returns: Json
      }
      resolve_expense_participants: {
        Args: {
          p_expense_id: string
          p_payload: Json
        }
        Returns: Json
      }
      resolve_guest_claim_token: {
        Args: {
          p_token: string
        }
        Returns: Json
      }
      restore_expense: {
        Args: {
          p_expense_id: string
        }
        Returns: Json
      }
      revoke_guest_claim_token: {
        Args: {
          p_guest_id: string
        }
        Returns: Json
      }
      rotate_assignment_room_join: {
        Args: {
          p_room_id: string
          p_join_token: string
        }
        Returns: Json
      }
      send_message: {
        Args: {
          p_client_id: string
          p_group_id: string
          p_content: string
        }
        Returns: Json
      }
      send_nudge: {
        Args: {
          p_group_id: string
          p_user_id: string
        }
        Returns: Json
      }
      set_assignment_room_claim: {
        Args: {
          p_room_id: string
          p_member_token: string
          p_item_id: string
          p_participant_id: string
          p_expected_item_revision: number
          p_ticks: number
        }
        Returns: Json
      }
      set_group_avatar: {
        Args: {
          p_group_id: string
          p_actor_id: string
          p_emoji: string
          p_photo_id: string
        }
        Returns: Json
      }
      update_profile: {
        Args: {
          p_name?: string
          p_handle?: string
          p_notification_preferences?: Json
        }
        Returns: Json
      }
      validate_assignment_room_receipt: {
        Args: {
          p_header: Json
          p_items: Json
        }
        Returns: Json
      }
      validate_expense_payload: {
        Args: {
          p: Json
          p_expense_type: Database["public"]["Enums"]["expense_type"]
          p_total: number
          p_fee_bps: number
          p_fixed_fee: number
        }
        Returns: Json
      }
      void_settlement: {
        Args: {
          p_settlement_id: string
        }
        Returns: Json
      }
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
        | "assignment_room_opened"
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

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

