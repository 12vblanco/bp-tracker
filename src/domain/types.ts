/**
 * Core domain types. Everything here is plain data — no React, no storage, no
 * ambient clock. Functions that need "now" take it as an argument.
 */

/** A blood pressure pair in mmHg. */
export interface BP {
  systolic: number
  diastolic: number
}

/** One cuff measurement. Pulse is optional because not every cuff reports it. */
export interface Reading {
  systolic: number
  diastolic: number
  pulse: number | null
}

/**
 * Time-of-day bucket, derived from the local hour but overridable per session.
 * `other` still counts toward overall averages, just not the AM/PM split cards.
 */
export type Period = 'morning' | 'evening' | 'other'

export type Arm = 'left' | 'right'

/**
 * A measurement sitting: 1–3 readings taken a minute apart, averaged.
 * Guidelines treat the average of a sitting — not a lone reading — as the
 * data point, so this is the unit everything downstream operates on.
 *
 * Note what is NOT here: any category, grade, or "in range" flag. Those are
 * derived at render time from the active guideline standard, so switching
 * standards reclassifies history instead of leaving stale labels behind.
 */
export interface Session {
  id: string
  userId: string
  /** ISO 8601 UTC instant. Rendered in the profile's timezone. */
  takenAt: string
  period: Period
  arm: Arm | null
  readings: Reading[]
  avgSystolic: number
  avgDiastolic: number
  avgPulse: number | null
  tags: string[]
  notes: string | null
  /**
   * Body measurements, both optional and both usually absent — they are taken
   * every so often, not every sitting. Always metric whatever the display unit
   * says; see `domain/body.ts` for why.
   */
  weightKg: number | null
  waistCm: number | null
  updatedAt: string
  /** Soft delete, so deletions propagate through sync instead of resurrecting. */
  deletedAt: string | null
}

/** The average of a session's readings, as a BP pair plus pulse. */
export interface SessionAverage extends BP {
  pulse: number | null
}
