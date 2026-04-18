import { createClient as _createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export const createClient = (url: string, anonKey: string) =>
  _createClient<Database>(url, anonKey)

export type SupabaseClient = ReturnType<typeof createClient>
