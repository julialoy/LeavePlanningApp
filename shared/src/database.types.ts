export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

// Semantic aliases — these are strings at runtime (Supabase serializes over JSON),
// but document the expected format in type signatures.
export type UUID = string          // xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export type ISODateTime = string   // e.g. "2026-04-18T14:30:00.000Z" (timestamptz)
export type ISODate = string       // e.g. "2026-04-18" (date)

export type AccrualFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'
export type AccrualType = 'accrual' | 'lump_sum'
export type LeaveUnit = 'hours' | 'days'
export type LeaveStatus = 'planned' | 'scheduled' | 'in_progress' | 'taken'

// ============================================================
// leave_policies discriminated union helpers
// ============================================================

type LeavePolicyCommon = {
  id: UUID
  user_id: UUID
  leave_type_id: UUID
  max_balance: number | null
  carry_over_limit: number | null
  unit: LeaveUnit
  created_at: ISODateTime
  updated_at: ISODateTime
}

export type AccrualPolicyRow = LeavePolicyCommon & {
  accrual_type: 'accrual'
  accrual_rate: number
  accrual_frequency: AccrualFrequency
  lump_sum_amount: null
  lump_sum_month: null
  lump_sum_day: null
}

export type LumpSumPolicyRow = LeavePolicyCommon & {
  accrual_type: 'lump_sum'
  lump_sum_amount: number
  lump_sum_month: number | null
  lump_sum_day: number | null
  accrual_rate: null
  accrual_frequency: null
}

type LeavePolicyCommonInsert = {
  id?: UUID
  user_id: UUID
  leave_type_id: UUID
  max_balance?: number | null
  carry_over_limit?: number | null
  unit?: LeaveUnit
  created_at?: ISODateTime
  updated_at?: ISODateTime
}

type AccrualPolicyInsert = LeavePolicyCommonInsert & {
  accrual_type: 'accrual'
  accrual_rate: number
  accrual_frequency: AccrualFrequency
  lump_sum_amount?: null
  lump_sum_month?: null
  lump_sum_day?: null
}

type LumpSumPolicyInsert = LeavePolicyCommonInsert & {
  accrual_type: 'lump_sum'
  lump_sum_amount: number
  lump_sum_month?: number | null
  lump_sum_day?: number | null
  accrual_rate?: null
  accrual_frequency?: null
}

// Common fields only — use when updating max_balance, carry_over_limit, unit, etc.
// without changing the policy type. Note: TypeScript's structural typing means
// type-specific fields are not blocked here; the DB constraint is the safety net.
type LeavePolicyCommonUpdate = {
  id?: UUID
  user_id?: UUID
  leave_type_id?: UUID
  max_balance?: number | null
  carry_over_limit?: number | null
  unit?: LeaveUnit
  created_at?: ISODateTime
  updated_at?: ISODateTime
}

// Full typed update — required when changing accrual_type or any type-specific field.
type AccrualPolicyUpdate = LeavePolicyCommonUpdate & {
  accrual_type: 'accrual'
  accrual_rate: number
  accrual_frequency: AccrualFrequency
  lump_sum_amount?: null
  lump_sum_month?: null
  lump_sum_day?: null
}

type LumpSumPolicyUpdate = LeavePolicyCommonUpdate & {
  accrual_type: 'lump_sum'
  lump_sum_amount: number
  lump_sum_month?: number | null
  lump_sum_day?: number | null
  accrual_rate?: null
  accrual_frequency?: null
}

// ============================================================
// Database interface
// ============================================================

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: UUID
          name: string
          created_at: ISODateTime
          updated_at: ISODateTime
        }
        Insert: {
          id: UUID
          name: string
          created_at?: ISODateTime
          updated_at?: ISODateTime
        }
        Update: {
          id?: UUID
          name?: string
          created_at?: ISODateTime
          updated_at?: ISODateTime
        }
      }
      leave_types: {
        Row: {
          id: UUID
          user_id: UUID
          name: string
          color: string
          created_at: ISODateTime
          updated_at: ISODateTime
        }
        Insert: {
          id?: UUID
          user_id: UUID
          name: string
          color?: string
          created_at?: ISODateTime
          updated_at?: ISODateTime
        }
        Update: {
          id?: UUID
          user_id?: UUID
          name?: string
          color?: string
          created_at?: ISODateTime
          updated_at?: ISODateTime
        }
      }
      leave_policies: {
        Row: AccrualPolicyRow | LumpSumPolicyRow
        Insert: AccrualPolicyInsert | LumpSumPolicyInsert
        Update: LeavePolicyCommonUpdate | AccrualPolicyUpdate | LumpSumPolicyUpdate
      }
      leave_balances: {
        Row: {
          id: UUID
          user_id: UUID
          leave_type_id: UUID
          balance: number
          as_of_date: ISODate
          created_at: ISODateTime
          updated_at: ISODateTime
        }
        Insert: {
          id?: UUID
          user_id: UUID
          leave_type_id: UUID
          balance?: number
          as_of_date?: ISODate
          created_at?: ISODateTime
          updated_at?: ISODateTime
        }
        Update: {
          id?: UUID
          user_id?: UUID
          leave_type_id?: UUID
          balance?: number
          as_of_date?: ISODate
          created_at?: ISODateTime
          updated_at?: ISODateTime
        }
      }
      leave_entries: {
        Row: {
          id: UUID
          user_id: UUID
          leave_type_id: UUID
          start_date: ISODate
          end_date: ISODate
          amount: number
          status: LeaveStatus
          notes: string | null
          created_at: ISODateTime
          updated_at: ISODateTime
        }
        Insert: {
          id?: UUID
          user_id: UUID
          leave_type_id: UUID
          start_date: ISODate
          end_date: ISODate
          amount: number
          status?: LeaveStatus
          notes?: string | null
          created_at?: ISODateTime
          updated_at?: ISODateTime
        }
        Update: {
          id?: UUID
          user_id?: UUID
          leave_type_id?: UUID
          start_date?: ISODate
          end_date?: ISODate
          amount?: number
          status?: LeaveStatus
          notes?: string | null
          created_at?: ISODateTime
          updated_at?: ISODateTime
        }
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}

// ============================================================
// Convenience row-type aliases
// ============================================================

export type Profile = Database['public']['Tables']['profiles']['Row']
export type LeaveType = Database['public']['Tables']['leave_types']['Row']
export type LeavePolicy = AccrualPolicyRow | LumpSumPolicyRow
export type LeavePolicyInsert = AccrualPolicyInsert | LumpSumPolicyInsert
export type LeavePolicyUpdate = LeavePolicyCommonUpdate | AccrualPolicyUpdate | LumpSumPolicyUpdate
export type LeaveBalance = Database['public']['Tables']['leave_balances']['Row']
export type LeaveEntry = Database['public']['Tables']['leave_entries']['Row']
