import Dexie from 'dexie'
import { getDatabase, currentUserId, BPDatabase, databaseNameFor, LOCAL_USER_ID } from './db'
import type { StoredSession } from './db'
import { ensureProfile, onLocalWrite, pendingSessions } from './repository'
import { fromProfileRow, fromSessionRow, toProfileRow, toSessionRow } from './rows'
import type { ProfileRow, SessionRow } from './rows'
import { isSyncConfigured, supabase } from './supabase'

/**
 * Background replication. Dexie stays the source of truth the UI reads from;
 * the server is a replica that catches up.
 *
 * Nothing here ever blocks a render, and every function is safe to call when
 * signed out or unconfigured — it returns an empty report rather than throwing,
 * so callers do not have to guard.
 */

const WATERMARK = 'sync:lastPulledAt'
const ADOPTED = 'sync:adopted'

export interface SyncReport {
  pushed: number
  pulled: number
  ran: boolean
}

const NOTHING: SyncReport = { pushed: 0, pulled: 0, ran: false }

async function readMeta(key: string): Promise<string | null> {
  const row = await getDatabase().meta.get(key)
  return row?.value ?? null
}

async function writeMeta(key: string, value: string): Promise<void> {
  await getDatabase().meta.put({ key, value })
}

/**
 * Sends everything this device owes the server.
 *
 * A row is marked clean only if it has not been edited since it was read. The
 * push is a round trip, and a sitting saved while it was in flight would
 * otherwise be marked clean without ever having been sent.
 */
async function push(userId: string): Promise<number> {
  const pending = await pendingSessions()
  if (pending.length === 0) return 0

  const rows: SessionRow[] = pending.map((row) => toSessionRow({ ...row, userId }))
  const { error } = await supabase().from('sessions').upsert(rows, { onConflict: 'id' })
  if (error) throw error

  const db = getDatabase()
  await db.transaction('rw', db.sessions, async () => {
    for (const sent of pending) {
      const current = await db.sessions.get(sent.id)
      if (current && current.updatedAt === sent.updatedAt) {
        await db.sessions.put({ ...current, syncState: 'clean' })
      }
    }
  })

  return pending.length
}

async function pushProfile(userId: string): Promise<void> {
  const profile = await ensureProfile()
  if (profile.syncState === 'clean') return

  const { error } = await supabase()
    .from('profiles')
    .upsert(toProfileRow({ ...profile, userId }), { onConflict: 'user_id' })
  if (error) throw error

  const db = getDatabase()
  const current = await db.profile.get(userId)
  if (current && current.updatedAt === profile.updatedAt) {
    await db.profile.put({ ...current, syncState: 'clean' })
  }
}

/**
 * Takes everything changed since the last pull.
 *
 * Conflicts resolve last-write-wins on `updatedAt`. For one person's own
 * readings on two devices that is correct rather than a compromise — the losing
 * write is nearly always a stale echo of the same sitting.
 */
async function pull(userId: string): Promise<number> {
  const since = (await readMeta(WATERMARK)) ?? new Date(0).toISOString()

  const { data, error } = await supabase()
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .gt('updated_at', since)
    .order('updated_at', { ascending: true })
  if (error) throw error

  const rows = (data ?? []) as SessionRow[]
  const db = getDatabase()
  let applied = 0
  let highest = since

  await db.transaction('rw', db.sessions, async () => {
    for (const row of rows) {
      if (row.updated_at > highest) highest = row.updated_at

      const incoming = fromSessionRow(row)
      const local = await db.sessions.get(incoming.id)
      // A local edit at the same instant keeps the local copy: the server's
      // version is already known here, and the local one may not be sent yet.
      if (local && local.updatedAt >= incoming.updatedAt) continue

      const stored: StoredSession = { ...incoming, userId, syncState: 'clean' }
      await db.sessions.put(stored)
      applied++
    }
  })

  // Written after the rows land, so a failure part way through replays rather
  // than skipping what it never applied.
  if (highest !== since) await writeMeta(WATERMARK, highest)

  return applied
}

async function pullProfile(userId: string): Promise<void> {
  const { data, error } = await supabase()
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return

  const incoming = fromProfileRow(data as ProfileRow)
  const db = getDatabase()
  const local = await db.profile.get(userId)
  if (local && local.updatedAt >= incoming.updatedAt) return

  await db.profile.put({ ...incoming, userId, syncState: 'clean' })
}

export async function syncNow(): Promise<SyncReport> {
  if (!isSyncConfigured) return NOTHING
  const userId = currentUserId()
  if (userId === LOCAL_USER_ID) return NOTHING

  // Push first. A pull that ran first could overwrite a local edit with an
  // older server copy before the edit had ever been sent.
  const pushed = await push(userId)
  await pushProfile(userId)
  const pulled = await pull(userId)
  await pullProfile(userId)

  return { pushed, pulled, ran: true }
}

/**
 * Moves a pre-account history into the signed-in user's database, once.
 *
 * `databaseNameFor()` means signing in opens `bp-tracker:<uuid>` — a fresh,
 * empty store — while every existing reading stays orphaned in
 * `bp-tracker:local`. Without this step the app goes blank the instant you sign
 * in, which from the user's chair is indistinguishable from data loss.
 *
 * The local database is left alone afterwards, deliberately. Dropping it would
 * destroy the only copy if the push that follows never succeeds; it costs
 * nothing to leave, and `ADOPTED` stops a second pass duplicating every row.
 */
export async function adoptLocalHistory(userId: string): Promise<number> {
  if (userId === LOCAL_USER_ID) return 0
  if (await readMeta(ADOPTED)) return 0

  const localName = databaseNameFor(LOCAL_USER_ID)
  if (!(await Dexie.exists(localName))) {
    await writeMeta(ADOPTED, new Date().toISOString())
    return 0
  }

  const local = new BPDatabase(localName)
  let adopted = 0
  try {
    await local.open()
    const sessions = await local.sessions.toArray()
    const target = getDatabase()

    if (sessions.length > 0) {
      // Rewritten to the real id and marked pending: these are edits no server
      // has heard about yet, which is exactly what pending means.
      await target.sessions.bulkPut(
        sessions.map((row) => ({ ...row, userId, syncState: 'pending' as const })),
      )
      adopted = sessions.length
    }
  } finally {
    local.close()
  }

  await writeMeta(ADOPTED, new Date().toISOString())
  return adopted
}

/**
 * Pushes shortly after a local change, rather than waiting for the next load.
 *
 * Debounced because a sitting is saved a row at a time — three readings a
 * minute apart are three writes to the same session, and each one would
 * otherwise be its own round trip.
 *
 * A failure is swallowed on purpose. The rows stay `pending`, so the next
 * trigger retries them; surfacing a network error here would put a warning on
 * screen for something the app is already handling.
 */
const DEBOUNCE_MS = 1500

let timer: ReturnType<typeof setTimeout> | null = null
let running = false
let repeat = false

async function run(): Promise<void> {
  if (running) {
    // A write landed mid-flight. Go round again once this pass finishes, or it
    // would sit unpushed until the next trigger.
    repeat = true
    return
  }
  running = true
  try {
    await syncNow()
  } catch {
    // Offline, or the project is paused. Nothing to do: the rows are pending.
  } finally {
    running = false
    if (repeat) {
      repeat = false
      scheduleSync()
    }
  }
}

export function scheduleSync(): void {
  if (!isSyncConfigured) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void run()
  }, DEBOUNCE_MS)
}

/**
 * Starts reacting to local writes, reconnection, and the tab coming back.
 *
 * The last two matter as much as the first: a reading saved on a train is
 * pending until something notices the network returned.
 */
export function startAutoSync(): () => void {
  if (!isSyncConfigured) return () => {}

  const stopWrites = onLocalWrite(scheduleSync)
  const onOnline = () => scheduleSync()
  const onVisible = () => {
    if (document.visibilityState === 'visible') scheduleSync()
  }

  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    stopWrites()
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
    if (timer) clearTimeout(timer)
  }
}
