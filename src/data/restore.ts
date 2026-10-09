import { sessionAverage } from '../domain/averages'
import { isPlausibleReading } from '../domain/reading'
import { DEFAULT_STANDARD_ID, isStandardId, type StandardId } from '../domain/standards'
import type { Arm, Period, Reading, Session } from '../domain/types'

/**
 * Reads a backup file back in.
 *
 * Pure: it parses and judges, it does not write. Storage is `importBackup` in
 * repository.ts, the one door.
 *
 * Every value here is treated as hostile. A backup is a file that has been out
 * in the world — hand-edited, truncated by a full disk, written by an older
 * version of this app — and a single NaN systolic reaching Dexie would poison
 * every average, chart and report downstream of it with no error to notice.
 *
 * The file is rejected whole only when it is not a backup at all. A row that
 * cannot be read is counted and skipped, never fatal: one corrupt sitting must
 * not cost someone the other four months.
 */

/** A session as a file can describe one. `userId` is the importer's to assign. */
export type RestorableSession = Omit<Session, 'userId'>

export interface RestorableProfile {
  standard: StandardId
  targetSystolic: number | null
  targetDiastolic: number | null
  tags: string[]
  timezone: string | null
  updatedAt: string
}

export interface ParsedBackup {
  exportedAt: string | null
  profile: RestorableProfile | null
  sessions: RestorableSession[]
  /** Entries present in the file that could not be read. */
  rejected: number
}

/** A file-level problem, worded for someone looking at a file picker. */
export class RestoreError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Normalises to a UTC instant, so a file written in any form sorts correctly. */
function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

function intOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

/** Weight and waist are genuinely fractional, unlike a pressure. */
function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim() !== '') seen.add(entry)
  }
  return [...seen]
}

/**
 * An unreadable period becomes `other` rather than rejecting the sitting. The
 * readings are the irreplaceable part; `other` still counts toward every
 * overall average, it only drops out of the AM/PM split.
 */
function periodOf(value: unknown): Period {
  return value === 'morning' || value === 'evening' || value === 'other' ? value : 'other'
}

function armOf(value: unknown): Arm | null {
  return value === 'left' || value === 'right' ? value : null
}

function readingsOf(value: unknown): Reading[] {
  if (!Array.isArray(value)) return []

  const readings: Reading[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const systolic = intOrNull(raw.systolic)
    const diastolic = intOrNull(raw.diastolic)
    if (systolic === null || diastolic === null) continue

    const reading: Reading = { systolic, diastolic, pulse: intOrNull(raw.pulse) }
    if (isPlausibleReading(reading)) readings.push(reading)
  }
  return readings
}

function sessionOf(value: unknown): RestorableSession | null {
  if (!isRecord(value)) return null

  const id = typeof value.id === 'string' && value.id !== '' ? value.id : null
  const takenAt = isoOrNull(value.takenAt)
  const readings = readingsOf(value.readings)

  // The three irreducible parts. Without an id a restore cannot be idempotent,
  // without a timestamp the sitting cannot be placed, and without a surviving
  // reading there is nothing left to restore.
  if (id === null || takenAt === null || readings.length === 0) return null

  // Averages are recomputed, never read from the file. They are derived data,
  // and a backup is exactly where a stored average stops agreeing with the
  // readings it claims to summarise — a dropped reading leaves the old mean
  // behind. Recomputing with the same function that wrote them is a no-op on an
  // intact file and a repair on a damaged one.
  const average = sessionAverage(readings)
  if (!average) return null

  return {
    id,
    takenAt,
    period: periodOf(value.period),
    arm: armOf(value.arm),
    readings,
    avgSystolic: average.systolic,
    avgDiastolic: average.diastolic,
    avgPulse: average.pulse,
    tags: stringArray(value.tags),
    notes: typeof value.notes === 'string' ? value.notes : null,
    // Absent in exports written before v2 added them. `null`, never undefined.
    weightKg: finiteOrNull(value.weightKg),
    waistCm: finiteOrNull(value.waistCm),
    // A missing edit time falls back to the reading time rather than to now:
    // dating a four-month-old sitting "today" would hand it every conflict it
    // meets under last-write-wins.
    updatedAt: isoOrNull(value.updatedAt) ?? takenAt,
    deletedAt: isoOrNull(value.deletedAt),
  }
}

function profileOf(value: unknown): RestorableProfile | null {
  if (!isRecord(value)) return null

  const targetSystolic = intOrNull(value.targetSystolic)
  const targetDiastolic = intOrNull(value.targetDiastolic)
  // Both or neither, the same rule Settings enforces: half a target silently
  // falls back to the standard on one axis and reads as a bug.
  const paired = targetSystolic !== null && targetDiastolic !== null

  return {
    // An unknown id degrades to the default rather than throwing, matching
    // getStandard(). A rolled-back deploy should not make a backup unreadable.
    standard: isStandardId(value.standard) ? value.standard : DEFAULT_STANDARD_ID,
    targetSystolic: paired ? targetSystolic : null,
    targetDiastolic: paired ? targetDiastolic : null,
    tags: stringArray(value.tags),
    timezone: typeof value.timezone === 'string' ? value.timezone : null,
    // Epoch, not now: an undated profile must lose to the live one, because
    // adopting it would overwrite real settings with guesses.
    updatedAt: isoOrNull(value.updatedAt) ?? new Date(0).toISOString(),
  }
}

export function parseBackup(text: string): ParsedBackup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new RestoreError('That file is not JSON. Pick the .json backup, not the CSV.')
  }

  if (!isRecord(raw) || !Array.isArray(raw.sessions)) {
    throw new RestoreError(
      'That JSON has no list of sessions, so it is not a BP Tracker backup.',
    )
  }

  // Last id wins within a file, by edit time. A concatenated or hand-merged
  // backup can carry the same sitting twice; the database cannot.
  const byId = new Map<string, RestorableSession>()
  let rejected = 0

  for (const entry of raw.sessions) {
    const session = sessionOf(entry)
    if (!session) {
      rejected++
      continue
    }
    const seen = byId.get(session.id)
    if (!seen || seen.updatedAt <= session.updatedAt) byId.set(session.id, session)
  }

  return {
    exportedAt: isoOrNull(raw.exportedAt),
    profile: profileOf(raw.profile),
    sessions: [...byId.values()],
    rejected,
  }
}
