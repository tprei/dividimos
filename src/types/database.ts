export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string | null;
          handle: string | null;
          phone: string | null;
          name: string;
          pix_key_encrypted: string;
          pix_key_type: "phone" | "cpf" | "email" | "random";
          pix_key_hint: string;
          avatar_url: string | null;
          onboarded: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          email?: string | null;
          handle?: string | null;
          phone?: string | null;
          name: string;
          pix_key_encrypted: string;
          pix_key_type?: "phone" | "cpf" | "email" | "random";
          pix_key_hint?: string;
          avatar_url?: string | null;
          onboarded?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          handle?: string | null;
          phone?: string | null;
          name?: string;
          pix_key_encrypted?: string;
          pix_key_type?: "phone" | "cpf" | "email" | "random";
          pix_key_hint?: string;
          avatar_url?: string | null;
          onboarded?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      bills: {
        Row: {
          id: string;
          creator_id: string;
          title: string;
          merchant_name: string | null;
          bill_type: string;
          status: "draft" | "active" | "partially_settled" | "settled";
          service_fee_percent: number;
          fixed_fees: number;
          total_amount: number;
          total_amount_input: number;
          group_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          creator_id: string;
          title: string;
          merchant_name?: string | null;
          bill_type?: string;
          status?: "draft" | "active" | "partially_settled" | "settled";
          service_fee_percent?: number;
          fixed_fees?: number;
          total_amount?: number;
          total_amount_input?: number;
          group_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          creator_id?: string;
          title?: string;
          merchant_name?: string | null;
          bill_type?: string;
          status?: "draft" | "active" | "partially_settled" | "settled";
          service_fee_percent?: number;
          fixed_fees?: number;
          total_amount?: number;
          total_amount_input?: number;
          group_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      bill_participants: {
        Row: {
          bill_id: string;
          user_id: string;
          status: "invited" | "accepted" | "declined";
          invited_by: string | null;
          joined_at: string;
          responded_at: string | null;
        };
        Insert: {
          bill_id: string;
          user_id: string;
          status?: "invited" | "accepted" | "declined";
          invited_by?: string | null;
          joined_at?: string;
          responded_at?: string | null;
        };
        Update: {
          bill_id?: string;
          user_id?: string;
          status?: "invited" | "accepted" | "declined";
          invited_by?: string | null;
          joined_at?: string;
          responded_at?: string | null;
        };
        Relationships: [];
      };
      bill_payers: {
        Row: {
          bill_id: string;
          user_id: string;
          amount_cents: number;
        };
        Insert: {
          bill_id: string;
          user_id: string;
          amount_cents: number;
        };
        Update: {
          bill_id?: string;
          user_id?: string;
          amount_cents?: number;
        };
        Relationships: [];
      };
      bill_splits: {
        Row: {
          id: string;
          bill_id: string;
          user_id: string;
          split_type: string;
          value: number;
          computed_amount_cents: number;
        };
        Insert: {
          id?: string;
          bill_id: string;
          user_id: string;
          split_type?: string;
          value: number;
          computed_amount_cents: number;
        };
        Update: {
          id?: string;
          bill_id?: string;
          user_id?: string;
          split_type?: string;
          value?: number;
          computed_amount_cents?: number;
        };
        Relationships: [];
      };
      bill_items: {
        Row: {
          id: string;
          bill_id: string;
          description: string;
          quantity: number;
          unit_price_cents: number;
          total_price_cents: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          bill_id: string;
          description: string;
          quantity?: number;
          unit_price_cents: number;
          total_price_cents: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          bill_id?: string;
          description?: string;
          quantity?: number;
          unit_price_cents?: number;
          total_price_cents?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      item_splits: {
        Row: {
          id: string;
          item_id: string;
          user_id: string;
          split_type: "equal" | "percentage" | "fixed";
          value: number;
          computed_amount_cents: number;
        };
        Insert: {
          id?: string;
          item_id: string;
          user_id: string;
          split_type?: "equal" | "percentage" | "fixed";
          value: number;
          computed_amount_cents: number;
        };
        Update: {
          id?: string;
          item_id?: string;
          user_id?: string;
          split_type?: "equal" | "percentage" | "fixed";
          value?: number;
          computed_amount_cents?: number;
        };
        Relationships: [];
      };
      ledger: {
        Row: {
          id: string;
          bill_id: string | null;
          entry_type: "debt" | "payment";
          group_id: string | null;
          from_user_id: string;
          to_user_id: string;
          amount_cents: number;
          paid_amount_cents: number;
          status: "pending" | "partially_paid" | "paid_unconfirmed" | "settled";
          paid_at: string | null;
          confirmed_at: string | null;
          confirmed_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          bill_id?: string | null;
          entry_type?: "debt" | "payment";
          group_id?: string | null;
          from_user_id: string;
          to_user_id: string;
          amount_cents: number;
          paid_amount_cents?: number;
          status?: "pending" | "partially_paid" | "paid_unconfirmed" | "settled";
          paid_at?: string | null;
          confirmed_at?: string | null;
          confirmed_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          bill_id?: string | null;
          entry_type?: "debt" | "payment";
          group_id?: string | null;
          from_user_id?: string;
          to_user_id?: string;
          amount_cents?: number;
          paid_amount_cents?: number;
          status?: "pending" | "partially_paid" | "paid_unconfirmed" | "settled";
          paid_at?: string | null;
          confirmed_at?: string | null;
          confirmed_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          ledger_id: string | null;

          from_user_id: string;
          to_user_id: string;
          amount_cents: number;
          status: "unconfirmed" | "settled";
          created_at: string;
          confirmed_at: string | null;
        };
        Insert: {
          id?: string;
          ledger_id?: string | null;
          group_settlement_id?: string | null;
          from_user_id: string;
          to_user_id: string;
          amount_cents: number;
          status?: "unconfirmed" | "settled";
          created_at?: string;
          confirmed_at?: string | null;
        };
        Update: {
          id?: string;
          ledger_id?: string | null;
          group_settlement_id?: string | null;
          from_user_id?: string;
          to_user_id?: string;
          amount_cents?: number;
          status?: "unconfirmed" | "settled";
          created_at?: string;
          confirmed_at?: string | null;
        };
        Relationships: [];
      };
      groups: {
        Row: {
          id: string;
          name: string;
          creator_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          creator_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          creator_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      group_members: {
        Row: {
          group_id: string;
          user_id: string;
          status: "invited" | "accepted";
          invited_by: string;
          created_at: string;
          accepted_at: string | null;
        };
        Insert: {
          group_id: string;
          user_id: string;
          status?: "invited" | "accepted";
          invited_by: string;
          created_at?: string;
          accepted_at?: string | null;
        };
        Update: {
          group_id?: string;
          user_id?: string;
          status?: "invited" | "accepted";
          invited_by?: string;
          created_at?: string;
          accepted_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      user_profiles: {
        Row: {
          id: string;
          handle: string;
          name: string;
          avatar_url: string | null;
        };
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
    Enums: {
      pix_key_type: "phone" | "cpf" | "email" | "random";
      bill_status: "draft" | "active" | "partially_settled" | "settled";
      bill_participant_status: "invited" | "accepted" | "declined";
      split_type: "equal" | "percentage" | "fixed";
      debt_status: "pending" | "partially_paid" | "paid_unconfirmed" | "settled";
      payment_status: "unconfirmed" | "settled";
      ledger_entry_type: "debt" | "payment";
      group_member_status: "invited" | "accepted";
    };
    CompositeTypes: Record<string, never>;
  };
}
