import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The Supabase handle, or nothing.
 *
 * Both variables are absent in a local checkout with no `.env`, and the app has
 * to stay fully usable in that state — sync is an addition to a local-first app,
 * never a precondition for it. Every caller checks `isSyncConfigured` first.
 */

const url = import.meta.env.VITE_SUPABASE_URL ?? ''
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const isSyncConfigured = url !== '' && anonKey !== ''

let client: SupabaseClient | null = null

export function supabase(): SupabaseClient {
  if (!isSyncConfigured) throw new Error('Sync is not configured')
  client ??= createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  return client
}
