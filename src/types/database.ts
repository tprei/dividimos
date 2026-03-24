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
      };
      bills: {
        Row: {
          id: string;
          creator_id: string;
          title: string;
          merchant_name: string | null;
          status: "draft" | "active" | "partially_settled" | "settled";
          service_fee_percent: number;
          fixed_fees: number;
          total_amount: number;
          group_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          creator_id: string;
          title: string;
          merchant_name?: string | null;
          status?: "draft" | "active" | "partially_settled" | "settled";
          service_fee_percent?: number;
          fixed_fees?: number;
          total_amount?: number;
          group_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          creator_id?: string;
          title?: string;
          merchant_name?: string | null;
          status?: "draft" | "active" | "partially_settled" | "settled";
          service_fee_percent?: number;
          fixed_fees?: number;
          total_amount?: number;
          group_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      group_settlements: {
        Row: {
          id: string;
          group_id: string;
          from_user_id: string;
          to_user_id: string;
          amount_cents: number;
          status: "pending" | "paid_unconfirmed" | "settled";
          paid_at: string | null;
          confirmed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          from_user_id: string;
          to_user_id: string;
          amount_cents: number;
          status?: "pending" | "paid_unconfirmed" | "settled";
          paid_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          group_id?: string;
          from_user_id?: string;
          to_user_id?: string;
          amount_cents?: number;
          status?: "pending" | "paid_unconfirmed" | "settled";
          paid_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
        };
      };
      bill_participants: {
        Row: {
          bill_id: string;
          user_id: string;
          joined_at: string;
        };
        Insert: {
          bill_id: string;
          user_id: string;
          joined_at?: string;
        };
        Update: {
          bill_id?: string;
          user_id?: string;
          joined_at?: string;
        };
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
      };
      ledger: {
        Row: {
          id: string;
          bill_id: string;
          from_user_id: string;
          to_user_id: string;
          amount_cents: number;
          status: "pending" | "paid_unconfirmed" | "settled";
          paid_at: string | null;
          confirmed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          bill_id: string;
          from_user_id: string;
          to_user_id: string;
          amount_cents: number;
          status?: "pending" | "paid_unconfirmed" | "settled";
          paid_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          bill_id?: string;
          from_user_id?: string;
          to_user_id?: string;
          amount_cents?: number;
          status?: "pending" | "paid_unconfirmed" | "settled";
          paid_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
        };
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
      };
    };
    Enums: {
      pix_key_type: "phone" | "cpf" | "email" | "random";
      bill_status: "draft" | "active" | "partially_settled" | "settled";
      split_type: "equal" | "percentage" | "fixed";
      debt_status: "pending" | "paid_unconfirmed" | "settled";
      group_member_status: "invited" | "accepted";
    };
  };
}
