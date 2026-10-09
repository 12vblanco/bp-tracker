import Dexie, { type EntityTable } from 'dexie'
import type { Session } from '../domain/types'
import type { StandardId } from '../domain/standards'

/**
 * Local store. Dexie is the source of truth the UI reads from; Supabase is a
 * replica that catches up in the background. That ordering is what makes a
 * reading save instantly and survive a dead connection.
 */

export type SyncState = 'clean' | 'pending' | 'deleted'

export interface StoredSession extends Session {
  syncState: SyncState
}

export interface ProfileRecord {
  userId: string
  standard: StandardId
  /** Null means "use the active standard's home threshold". */
  targetSystolic: number | null
  targetDiastolic: number | null
  tags: string[]
  timezone: string | null
  updatedAt: string
  syncState: SyncState
}

export interface MetaRecord {
  key: string
  value: string
}

export class BPDatabase extends Dexie {
  sessions!: EntityTable<StoredSession, 'id'>
  profile!: EntityTable<ProfileRecord, 'userId'>
  meta!: EntityTable<MetaRecord, 'key'>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      // deletedAt is not indexed: it is null for almost every row, and Dexie
      // skips null keys, so filtering active rows in memory is both simpler
      // and correct here.
      sessions: 'id, takenAt, syncState, updatedAt',
      profile: 'userId',
      meta: 'key',
    })

    // v2 adds weightKg and waistCm to sessions. Neither is indexed, so the
    // store declarations are unchanged and only the backfill is needed — but it
    // is needed: without it, existing rows carry `undefined` where the type
    // promises `null`, and `undefined` is the one value a `=== null` check
    // misses. The upgrade does not touch `updatedAt` or `syncState`, because
    // adding an absent field is not an edit anyone should have to sync.
    this.version(2)
      .stores({
        sessions: 'id, takenAt, syncState, updatedAt',
        profile: 'userId',
        meta: 'key',
      })
      .upgrade((tx) =>
        tx
          .table<StoredSession>('sessions')
          .toCollection()
          .modify((session) => {
            session.weightKg ??= null
            session.waistCm ??= null
          }),
      )
  }
}

/**
 * One database per user id.
 *
 * Without this, signing out of one account and into another on the same browser
 * merges two people's readings into one history — silently, with no error to
 * notice. The namespace makes that impossible rather than unlikely.
 */
export function databaseNameFor(userId: string): string {
  return `bp-tracker:${userId}`
}

/** Pre-auth Phase 1 identity. Real user ids replace it once sign-in exists. */
export const LOCAL_USER_ID = 'local'

let current: { userId: string; db: BPDatabase } | null = null

export function openDatabase(userId: string): BPDatabase {
  if (current?.userId === userId) return current.db
  current?.db.close()
  current = { userId, db: new BPDatabase(databaseNameFor(userId)) }
  return current.db
}

/**
 * Closes the connection on sign-out. Deliberately does not delete: a reading
 * logged offline and not yet pushed would be destroyed by a wipe, and the
 * per-user namespace already prevents any cross-account leakage. Settings
 * offers an explicit destructive wipe for when that is actually what you want.
 */
export function closeDatabase(): void {
  current?.db.close()
  current = null
}

export async function deleteDatabaseFor(userId: string): Promise<void> {
  if (current?.userId === userId) closeDatabase()
  await Dexie.delete(databaseNameFor(userId))
}

export function getDatabase(): BPDatabase {
  if (!current) throw new Error('Database accessed before openDatabase()')
  return current.db
}

export function currentUserId(): string {
  if (!current) throw new Error('User id accessed before openDatabase()')
  return current.userId
}

export function isDatabaseOpen(): boolean {
  return current !== null
}
