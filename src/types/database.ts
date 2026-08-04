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
      chat_expense_confirmation_operations: {
        Row: {
          cancelled_at: string | null
          canonical_request: Json | null
          committed_at: string | null
          created_at: string
          expense_id: string | null
          group_id: string | null
          id: string
          initiated_by_user_id: string | null
          outcome: string
          retired_at: string | null
          system_message_id: string | null
          terminal_code: string | null
        }
        Insert: {
          cancelled_at?: string | null
          canonical_request?: Json | null
          committed_at?: string | null
          created_at?: string
          expense_id?: string | null
          group_id?: string | null
          id: string
          initiated_by_user_id?: string | null
          outcome: string
          retired_at?: string | null
          system_message_id?: string | null
          terminal_code?: string | null
        }
        Update: {
          cancelled_at?: string | null
          canonical_request?: Json | null
          committed_at?: string | null
          created_at?: string
          expense_id?: string | null
          group_id?: string | null
          id?: string
          initiated_by_user_id?: string | null
          outcome?: string
          retired_at?: string | null
          system_message_id?: string | null
          terminal_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_expense_confirmation_operations_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: true
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_expense_confirmation_operations_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_expense_confirmation_operations_initiated_by_user_id_fkey"
            columns: ["initiated_by_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_expense_confirmation_operations_initiated_by_user_id_fkey"
            columns: ["initiated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_expense_confirmation_operations_system_message_id_fkey"
            columns: ["system_message_id"]
            isOneToOne: true
            referencedRelation: "chat_messages"
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
      expense_allocation_entities: {
        Row: {
          entity_kind: string
          expense_id: string
          guest_id: string | null
          net_amount_cents: number
          participant_index: number
          payer_amount_cents: number
          share_amount_cents: number
          user_id: string | null
        }
        Insert: {
          entity_kind: string
          expense_id: string
          guest_id?: string | null
          net_amount_cents: number
          participant_index: number
          payer_amount_cents: number
          share_amount_cents: number
          user_id?: string | null
        }
        Update: {
          entity_kind?: string
          expense_id?: string
          guest_id?: string | null
          net_amount_cents?: number
          participant_index?: number
          payer_amount_cents?: number
          share_amount_cents?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_allocation_entities_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_balance_allocation_plans: {
        Row: {
          algorithm_version: number
          created_at: string
          edge_count: number
          entity_count: number
          expense_id: string
          source_digest: string
          total_cents: number
        }
        Insert: {
          algorithm_version: number
          created_at?: string
          edge_count: number
          entity_count: number
          expense_id: string
          source_digest: string
          total_cents: number
        }
        Update: {
          algorithm_version?: number
          created_at?: string
          edge_count?: number
          entity_count?: number
          expense_id?: string
          source_digest?: string
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "expense_balance_allocation_plans_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: true
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_balance_allocations: {
        Row: {
          allocation_index: number
          amount_cents: number
          applied_at: string | null
          applied_to_user_id: string | null
          creditor_index: number
          debtor_index: number
          expense_id: string
        }
        Insert: {
          allocation_index: number
          amount_cents: number
          applied_at?: string | null
          applied_to_user_id?: string | null
          creditor_index: number
          debtor_index: number
          expense_id: string
        }
        Update: {
          allocation_index?: number
          amount_cents?: number
          applied_at?: string | null
          applied_to_user_id?: string | null
          creditor_index?: number
          debtor_index?: number
          expense_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_balance_allocations_creditor_entity_fkey"
            columns: ["expense_id", "creditor_index"]
            isOneToOne: false
            referencedRelation: "expense_allocation_entities"
            referencedColumns: ["expense_id", "participant_index"]
          },
          {
            foreignKeyName: "expense_balance_allocations_debtor_entity_fkey"
            columns: ["expense_id", "debtor_index"]
            isOneToOne: false
            referencedRelation: "expense_allocation_entities"
            referencedColumns: ["expense_id", "participant_index"]
          },
          {
            foreignKeyName: "expense_balance_allocations_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expense_balance_allocation_plans"
            referencedColumns: ["expense_id"]
          },
        ]
      }
      expense_graph_save_operations: {
        Row: {
          caller_id: string | null
          canonical_request: Json | null
          created_at: string
          expense_id: string | null
          graph_revision: number | null
          group_id: string | null
          operation_id: string
          outcome: string
          request_digest: string | null
          result: Json | null
          result_created_at: string | null
          retired_at: string | null
          retired_reason: string | null
        }
        Insert: {
          caller_id?: string | null
          canonical_request?: Json | null
          created_at?: string
          expense_id?: string | null
          graph_revision?: number | null
          group_id?: string | null
          operation_id: string
          outcome: string
          request_digest?: string | null
          result?: Json | null
          result_created_at?: string | null
          retired_at?: string | null
          retired_reason?: string | null
        }
        Update: {
          caller_id?: string | null
          canonical_request?: Json | null
          created_at?: string
          expense_id?: string | null
          graph_revision?: number | null
          group_id?: string | null
          operation_id?: string
          outcome?: string
          request_digest?: string | null
          result?: Json | null
          result_created_at?: string | null
          retired_at?: string | null
          retired_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_graph_save_operations_caller_id_fkey"
            columns: ["caller_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_graph_save_operations_caller_id_fkey"
            columns: ["caller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_graph_save_operations_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_graph_save_operations_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
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
            foreignKeyName: "expense_payers_participant_fkey"
            columns: ["expense_id", "user_id"]
            isOneToOne: true
            referencedRelation: "expense_shares"
            referencedColumns: ["expense_id", "user_id"]
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
          activation_notified_at: string | null
          created_at: string
          creator_id: string
          expense_type: Database["public"]["Enums"]["expense_type"]
          fixed_fees: number
          graph_revision: number
          group_id: string
          id: string
          merchant_name: string | null
          service_fee_basis_points: number
          status: Database["public"]["Enums"]["expense_status"]
          title: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          activation_notified_at?: string | null
          created_at?: string
          creator_id: string
          expense_type?: Database["public"]["Enums"]["expense_type"]
          fixed_fees?: number
          graph_revision?: number
          group_id: string
          id?: string
          merchant_name?: string | null
          service_fee_basis_points?: number
          status?: Database["public"]["Enums"]["expense_status"]
          title: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          activation_notified_at?: string | null
          created_at?: string
          creator_id?: string
          expense_type?: Database["public"]["Enums"]["expense_type"]
          fixed_fees?: number
          graph_revision?: number
          group_id?: string
          id?: string
          merchant_name?: string | null
          service_fee_basis_points?: number
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
          created_by?: string
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
      settlement_operation_items: {
        Row: {
          allocation_index: number
          operation_id: string
          settlement_id: string
        }
        Insert: {
          allocation_index: number
          operation_id: string
          settlement_id: string
        }
        Update: {
          allocation_index?: number
          operation_id?: string
          settlement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_operation_items_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "settlement_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_operation_items_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: true
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_operations: {
        Row: {
          canonical_request: Json
          created_at: string
          id: string
          initiated_by: string
        }
        Insert: {
          canonical_request: Json
          created_at?: string
          id: string
          initiated_by: string
        }
        Update: {
          canonical_request?: Json
          created_at?: string
          id?: string
          initiated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_operations_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_operations_initiated_by_fkey"
            columns: ["initiated_by"]
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
          notification_sent_at: string | null
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
          notification_sent_at?: string | null
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
          notification_sent_at?: string | null
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
      accept_group_invitation: {
        Args: { p_group_id: string }
        Returns: undefined
      }
      activate_expense: { Args: { p_expense_id: string }; Returns: undefined }
      activate_saved_expense: {
        Args: { p_expected_graph_revision: number; p_expense_id: string }
        Returns: Json
      }
      assert_dm_actor: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: undefined
      }
      assert_dm_group_shape: {
        Args: { p_allow_missing: boolean; p_group_id: string }
        Returns: undefined
      }
      assert_dm_participants: {
        Args: { p_group_id: string; p_user_ids: string[] }
        Returns: undefined
      }
      begin_expense_graph_direct_mutation: {
        Args: { p_expense_ids: string[] }
        Returns: string
      }
      build_expense_allocation_plan_edges: {
        Args: { p_expense_id: string }
        Returns: {
          allocation_index: number
          amount_cents: number
          creditor_index: number
          debtor_index: number
        }[]
      }
      calculate_service_fee_cents: {
        Args: { p_basis_points: number; p_subtotal: number }
        Returns: number
      }
      cancel_chat_expense_confirmation: {
        Args: {
          p_operation_id: string
          p_request: Json
          p_terminal_code: string
        }
        Returns: Json
      }
      claim_guest_spot: { Args: { p_claim_token: string }; Returns: Json }
      cleanup_expired_rate_limit_counters: { Args: never; Returns: number }
      compute_expense_line_total_cents: {
        Args: { p_quantity_milliunits: number; p_unit_price_cents: number }
        Returns: number
      }
      confirm_chat_expense: {
        Args: { p_operation_id: string; p_request: Json }
        Returns: Json
      }
      confirm_settlement: {
        Args: { p_settlement_id: string }
        Returns: undefined
      }
      confirm_vendor_charge: {
        Args: { p_charge_id: string }
        Returns: undefined
      }
      deactivate_group_invite_link: {
        Args: { p_link_id: string }
        Returns: undefined
      }
      decline_group_invitation: {
        Args: { p_group_id: string }
        Returns: undefined
      }
      delete_draft_expense: {
        Args: { p_expense_id: string }
        Returns: undefined
      }
      delete_group: { Args: { p_group_id: string }; Returns: undefined }
      expense_money_max_cents: { Args: never; Returns: number }
      get_chat_expense_confirmation: {
        Args: { p_operation_id: string }
        Returns: Json
      }
      get_dm_previews: {
        Args: { p_group_ids: string[] }
        Returns: {
          content: string
          created_at: string
          group_id: string
          message_type: string
        }[]
      }
      get_or_create_dm_group: {
        Args: { p_other_user_id: string }
        Returns: string
      }
      get_settlement_operation: {
        Args: { p_operation_id: string }
        Returns: {
          allocation_index: number
          amount_cents: number
          confirmed_at: string
          created_at: string
          from_user_id: string
          group_id: string
          settlement_id: string
          status: Database["public"]["Enums"]["settlement_status"]
          to_user_id: string
        }[]
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
      increment_rate_limit: {
        Args: {
          p_bucket: string
          p_limit: number
          p_subject: string
          p_window_seconds: number
        }
        Returns: boolean
      }
      issue_guest_claim_token: {
        Args: {
          p_expected_generation: number
          p_guest_id: string
          p_rotate: boolean
        }
        Returns: Json
      }
      join_group_via_link: { Args: { p_token: string }; Returns: Json }
      leave_group: { Args: { p_group_id: string }; Returns: undefined }
      load_expense_graph_snapshot: {
        Args: { p_expense_id: string }
        Returns: Json
      }
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
      record_settlements: {
        Args: { p_allocations: Json; p_operation_id: string }
        Returns: {
          allocation_index: number
          amount_cents: number
          confirmed_at: string
          created_at: string
          from_user_id: string
          group_id: string
          settlement_id: string
          status: Database["public"]["Enums"]["settlement_status"]
          to_user_id: string
          was_replay: boolean
        }[]
      }
      remove_group_member: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: undefined
      }
      resolve_expense_graph_save_result: {
        Args: { p_group_id: string; p_save_operation_id: string }
        Returns: Json
      }
      resolve_guest_claim_token: {
        Args: { p_claim_token: string }
        Returns: {
          expense_id: string
          group_id: string
          guest_id: string
        }[]
      }
      save_expense_draft_graph: {
        Args: {
          p_expected_graph_revision: number
          p_expense: Json
          p_guest_shares: Json
          p_guests: Json
          p_items: Json
          p_participant_order: Json
          p_payers: Json
          p_save_operation_id: string
          p_shares: Json
        }
        Returns: Json
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

