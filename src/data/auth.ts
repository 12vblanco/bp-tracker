import { isSyncConfigured, supabase } from './supabase'

/**
 * Sign-in, framed as "back this up" rather than as the price of entry.
 *
 * Magic link only: nothing to store, nothing to reset, no password to leak.
 * There is deliberately no way for a signed-out visitor to be refused — the app
 * works with no account at all, and the README's promise that a reading saves
 * instantly and survives a dead connection depends on that staying true.
 */

export interface Account {
  userId: string
  email: string | null
}

/** Resolves the stored session on boot. Null when signed out or unconfigured. */
export async function currentAccount(): Promise<Account | null> {
  if (!isSyncConfigured) return null
  const { data } = await supabase().auth.getSession()
  const user = data.session?.user
  return user ? { userId: user.id, email: user.email ?? null } : null
}

export async function sendMagicLink(email: string): Promise<void> {
  const { error } = await supabase().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  })
  if (error) throw error
}

/**
 * Closes the session. Does not touch the database — a reading logged offline
 * and not yet pushed would be destroyed by a wipe, and the per-user namespace
 * already prevents any cross-account leakage.
 */
export async function signOut(): Promise<void> {
  await supabase().auth.signOut()
}

export function onAccountChange(listener: () => void): () => void {
  if (!isSyncConfigured) return () => {}
  const { data } = supabase().auth.onAuthStateChange(() => listener())
  return () => data.subscription.unsubscribe()
}
