import type { Arm, Period, Reading, Session } from '../domain/types'
import type { StandardId } from '../domain/standards'
import { DEFAULT_STANDARD_ID } from '../domain/standards'
import { DEFAULT_TAGS } from '../domain/tags'
import { sessionAverage } from '../domain/averages'
import { getDatabase, currentUserId, type ProfileRecord, type StoredSession } from './db'
import type { ParsedBackup } from './restore'

/**
 * The only door between the UI and storage.
 *
 * Screens import this and nothing below it. That seam is what lets the backend
 * change — a different provider, a server-side API, sharding — without a single
 * component being touched.
 */

/**
 * Fires after any local write.
 *
 * The sync layer subscribes to this rather than being called from here:
 * `sync.ts` already imports this module, so importing it back would be a
 * cycle. Screens stay unaware that sync exists at all.
 */
type WriteListener = () => void
const writeListeners = new Set<WriteListener>()

export function onLocalWrite(listener: WriteListener): () => void {
  writeListeners.add(listener)
  return () => {
    writeListeners.delete(listener)
  }
}

function announceWrite(): void {
  for (const listener of writeListeners) listener()
}

export interface SessionInput {
  takenAt: Date
  period: Period
  arm: Arm | null
  readings: Reading[]
  tags: string[]
  notes: string | null
  /** Kilograms, or null when not measured. */
  weightKg: number | null
  /** Centimetres, or null when not measured. */
  waistCm: number | null
}

function toSession(input: SessionInput, id: string, userId: string): Session {
  const average = sessionAverage(input.readings)
  if (!average) throw new Error('A session needs at least one reading')

  return {
    id,
    userId,
    takenAt: input.takenAt.toISOString(),
    period: input.period,
    arm: input.arm,
    readings: input.readings,
    avgSystolic: average.systolic,
    avgDiastolic: average.diastolic,
    avgPulse: average.pulse,
    tags: input.tags,
    notes: input.notes,
    weightKg: input.weightKg,
    waistCm: input.waistCm,
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  }
}

/**
 * Fills in fields added after a row was written.
 *
 * The v2 migration backfills existing rows, but a row can also arrive from a
 * restored export or, later, from sync — and one `undefined` where the domain
 * expects `null` slips past every `=== null` check downstream. Normalising at
 * the one door into storage means nothing above this line has to be defensive.
 */
function normalize(row: StoredSession): Session {
  return { ...row, weightKg: row.weightKg ?? null, waistCm: row.waistCm ?? null }
}

/** Active sessions, newest first. Soft-deleted rows never leave this layer. */
export async function listSessions(): Promise<Session[]> {
  const rows = await getDatabase().sessions.toArray()
  return rows
    .filter((row) => row.deletedAt === null)
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt))
    .map(normalize)
}

export async function getSession(id: string): Promise<Session | null> {
  const row = await getDatabase().sessions.get(id)
  return row && row.deletedAt === null ? normalize(row) : null
}

export async function createSession(input: SessionInput): Promise<Session> {
  const session = toSession(input, crypto.randomUUID(), currentUserId())
  await getDatabase().sessions.put({ ...session, syncState: 'pending' })
  announceWrite()
  return session
}

export async function updateSession(id: string, input: SessionInput): Promise<Session> {
  const existing = await getDatabase().sessions.get(id)
  if (!existing) throw new Error(`No session ${id}`)

  const session = toSession(input, id, existing.userId)
  await getDatabase().sessions.put({ ...session, syncState: 'pending' })
  announceWrite()
  return session
}

/**
 * Soft delete. A hard delete would resurrect the row on the next pull from any
 * device that has not yet heard about it.
 */
export async function deleteSession(id: string): Promise<void> {
  const existing = await getDatabase().sessions.get(id)
  if (!existing) return

  await getDatabase().sessions.put({
    ...existing,
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    syncState: 'deleted',
  })
  announceWrite()
}

function defaultProfile(userId: string): ProfileRecord {
  return {
    userId,
    standard: DEFAULT_STANDARD_ID,
    targetSystolic: null,
    targetDiastolic: null,
    tags: [...DEFAULT_TAGS],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    updatedAt: new Date().toISOString(),
    syncState: 'pending',
  }
}

/**
 * Pure read — safe inside a live query.
 *
 * Dexie runs live queries in read-only reactive transactions, so this must not
 * create the row when it is missing. Creation is `ensureProfile`, called once at
 * startup; keeping the two apart is what stops the app throwing on first run.
 */
export async function readProfile(): Promise<ProfileRecord | undefined> {
  return getDatabase().profile.get(currentUserId())
}

/** Creates the default profile if this user has none. Never call from a live query. */
export async function ensureProfile(): Promise<ProfileRecord> {
  const userId = currentUserId()
  const existing = await getDatabase().profile.get(userId)
  if (existing) return existing

  const profile = defaultProfile(userId)
  await getDatabase().profile.put(profile)
  return profile
}

export interface ProfilePatch {
  standard?: StandardId
  targetSystolic?: number | null
  targetDiastolic?: number | null
  tags?: string[]
}

export async function saveProfile(patch: ProfilePatch): Promise<ProfileRecord> {
  const existing = await ensureProfile()
  const updated: ProfileRecord = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
    syncState: 'pending',
  }
  await getDatabase().profile.put(updated)
  announceWrite()
  return updated
}

export interface ExportBundle {
  exportedAt: string
  profile: ProfileRecord
  sessions: Session[]
}

/**
 * Everything, as plain JSON. The escape hatch: a tool that holds your health
 * history should never be the only place it exists.
 */
export async function exportAll(): Promise<ExportBundle> {
  return {
    exportedAt: new Date().toISOString(),
    profile: await ensureProfile(),
    sessions: await listSessions(),
  }
}

export type ImportMode = 'merge' | 'replace'

export interface ImportResult {
  added: number
  updated: number
  /** Already present with an equal or newer edit, so left untouched. */
  superseded: number
  /** Rows the file carried that could not be read. Counted by the parser. */
  rejected: number
  profileAdopted: boolean
}

/**
 * Restores a parsed backup.
 *
 * Two things here are deliberate and easy to get wrong the other way:
 *
 * `userId` comes from the live session, never from the file. A backup exported
 * under a different id — a pre-auth export, another account, a hand-edited
 * file — would otherwise write rows that the per-user namespace guarantees this
 * user can never see. From the restorer's chair that is a silent no-op.
 *
 * Restored rows are `pending`, not `clean`. They describe edits this device has
 * that no server has heard about yet, which is exactly what pending means;
 * marking them clean would let a future first sync pull right over them.
 *
 * Merge resolves a collision by `updatedAt`, last write wins — the same rule
 * the sync design uses, for the same reason: the two sides are one person's own
 * readings, so the older copy is nearly always a stale echo of the newer.
 */
export async function importBackup(
  parsed: ParsedBackup,
  mode: ImportMode,
): Promise<ImportResult> {
  const db = getDatabase()
  const userId = currentUserId()

  let added = 0
  let updated = 0
  let superseded = 0
  let profileAdopted = false

  await db.transaction('rw', db.sessions, db.profile, async () => {
    if (mode === 'replace') await db.sessions.clear()

    const existing = new Map((await db.sessions.toArray()).map((row) => [row.id, row]))
    const incoming: StoredSession[] = []

    for (const session of parsed.sessions) {
      const current = existing.get(session.id)
      if (current && current.updatedAt >= session.updatedAt) {
        superseded++
        continue
      }
      incoming.push({ ...session, userId, syncState: 'pending' })
      if (current) updated++
      else added++
    }

    // One write for the whole file. A per-row put would leave a half-restored
    // database behind if the tab closed partway through.
    if (incoming.length > 0) await db.sessions.bulkPut(incoming)

    if (parsed.profile) {
      const live = await db.profile.get(userId)
      // Settings are adopted only when the file's are newer. A restore is for
      // the readings; quietly reverting a standard or a target the person has
      // since changed is a second, unasked-for edit.
      if (!live || live.updatedAt < parsed.profile.updatedAt) {
        await db.profile.put({ ...parsed.profile, userId, syncState: 'pending' })
        profileAdopted = true
      }
    }
  })

  announceWrite()
  return { added, updated, superseded, rejected: parsed.rejected, profileAdopted }
}

/** Rows the sync layer still owes the server. */
export async function pendingSessions(): Promise<StoredSession[]> {
  const rows = await getDatabase().sessions.toArray()
  return rows.filter((row) => row.syncState !== 'clean')
}
