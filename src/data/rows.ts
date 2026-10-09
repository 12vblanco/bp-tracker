import type { Arm, Period, Reading, Session } from '../domain/types'
import type { ProfileRecord } from './db'
import { getStandard } from '../domain/standards'

/**
 * The camelCase/snake_case seam, and the only place either spelling meets the
 * other. Pure and synchronous so it can be tested without a network.
 *
 * `syncState` is deliberately absent in both directions. It describes this
 * device's relationship to the server; a round trip would overwrite a pending
 * local edit with `clean` and lose the edit.
 */

export interface SessionRow {
  id: string
  user_id: string
  taken_at: string
  period: Period
  arm: Arm | null
  readings: Reading[]
  avg_systolic: number
  avg_diastolic: number
  avg_pulse: number | null
  tags: string[]
  notes: string | null
  weight_kg: number | null
  waist_cm: number | null
  updated_at: string
  deleted_at: string | null
}

export interface ProfileRow {
  user_id: string
  standard: string
  target_systolic: number | null
  target_diastolic: number | null
  tags: string[]
  timezone: string | null
  updated_at: string
}

/** Postgres `numeric` can arrive as a string once it is wide enough. */
function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = num(value)
  return Number.isFinite(n) ? n : null
}

export function toSessionRow(session: Session): SessionRow {
  return {
    id: session.id,
    user_id: session.userId,
    taken_at: session.takenAt,
    period: session.period,
    arm: session.arm,
    readings: session.readings,
    avg_systolic: session.avgSystolic,
    avg_diastolic: session.avgDiastolic,
    avg_pulse: session.avgPulse,
    tags: session.tags,
    notes: session.notes,
    weight_kg: session.weightKg,
    waist_cm: session.waistCm,
    updated_at: session.updatedAt,
    deleted_at: session.deletedAt,
  }
}

export function fromSessionRow(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    takenAt: row.taken_at,
    period: row.period,
    arm: row.arm,
    readings: Array.isArray(row.readings) ? row.readings : [],
    avgSystolic: num(row.avg_systolic),
    avgDiastolic: num(row.avg_diastolic),
    avgPulse: numOrNull(row.avg_pulse),
    tags: row.tags ?? [],
    notes: row.notes,
    // Null, never undefined: a column absent from a narrowed select would
    // otherwise slip past every `=== null` check downstream.
    weightKg: numOrNull(row.weight_kg),
    waistCm: numOrNull(row.waist_cm),
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

export function toProfileRow(profile: ProfileRecord): ProfileRow {
  return {
    user_id: profile.userId,
    standard: profile.standard,
    target_systolic: profile.targetSystolic,
    target_diastolic: profile.targetDiastolic,
    tags: profile.tags,
    timezone: profile.timezone,
    updated_at: profile.updatedAt,
  }
}

export function fromProfileRow(row: ProfileRow): Omit<ProfileRecord, 'syncState'> {
  const targetSystolic = numOrNull(row.target_systolic)
  const targetDiastolic = numOrNull(row.target_diastolic)
  const paired = targetSystolic !== null && targetDiastolic !== null

  return {
    userId: row.user_id,
    // Degrades rather than throwing, matching getStandard() everywhere else.
    standard: getStandard(row.standard).id,
    targetSystolic: paired ? targetSystolic : null,
    targetDiastolic: paired ? targetDiastolic : null,
    tags: row.tags ?? [],
    timezone: row.timezone,
    updatedAt: row.updated_at,
  }
}
