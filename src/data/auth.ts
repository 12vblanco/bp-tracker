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

const AUTO_EMAIL = import.meta.env.VITE_BP_EMAIL ?? ''
const AUTO_PASSWORD = import.meta.env.VITE_BP_PASSWORD ?? ''

export const hasAutoSignIn = AUTO_EMAIL !== '' && AUTO_PASSWORD !== ''

/**
 * Signs the one user in without asking, when credentials are configured.
 *
 * SINGLE USER ONLY. The password ships in the client bundle, so the Netlify
 * basic-auth gate is the only thing keeping it private — and that edge function
 * calls itself a doormat, not a lock. The moment a second person has an
 * account, delete this and go back to the magic link, or one bundle hands over
 * the other person's readings.
 *
 * Never throws and never blocks boot: sync is an addition to a local-first app,
 * never a precondition for it. A failure leaves the app signed out and working.
 */
export async function ensureSignedIn(): Promise<void> {
  if (!isSyncConfigured || !hasAutoSignIn) return
  // getSession reads localStorage and is cheap; the sign-in below is a round
  // trip, so it is skipped offline rather than stalling the first paint.
  const { data } = await supabase().auth.getSession()
  if (data.session) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return

  const { error } = await supabase().auth.signInWithPassword({
    email: AUTO_EMAIL,
    password: AUTO_PASSWORD,
  })
  // Swallowed on purpose. The footer reports "signed out", which is the honest
  // state, and the magic link still works.
  if (error) console.warn('Auto sign-in failed:', error.message)
}

/** Email and password sign-in. Throws with the provider's message on failure. */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await supabase().auth.signInWithPassword({ email, password })
  if (error) throw error
}

/**
 * Sets or changes the password on the signed-in account.
 *
 * Here rather than only in the Supabase dashboard because an account created by
 * magic link has no password at all, and without one there is nothing for the
 * sign-in form above to accept.
 */
export async function updatePassword(password: string): Promise<void> {
  const { error } = await supabase().auth.updateUser({ password })
  if (error) throw error
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
