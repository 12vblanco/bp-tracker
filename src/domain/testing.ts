import type { Period, Reading, Session } from './types'
import { sessionAverage, periodFor } from './averages'

/**
 * Test-only session factory. `takenAtLocal` is a local wall-clock string
 * ("2026-08-10T08:00"), converted to the UTC instant the app actually stores —
 * so tests read in the timezone a person would think in while still exercising
 * the real storage format.
 */
export function makeSession(
  takenAtLocal: string,
  readings: [number, number][] | Reading[],
  overrides: Partial<Session> = {},
): Session {
  const parsed: Reading[] = readings.map((r) =>
    Array.isArray(r) ? { systolic: r[0], diastolic: r[1], pulse: null } : r,
  )
  const average = sessionAverage(parsed)
  const takenAt = new Date(takenAtLocal)

  return {
    id: takenAt.toISOString(),
    userId: 'test-user',
    takenAt: takenAt.toISOString(),
    period: periodFor(takenAt) as Period,
    arm: null,
    readings: parsed,
    avgSystolic: average?.systolic ?? 0,
    avgDiastolic: average?.diastolic ?? 0,
    avgPulse: average?.pulse ?? null,
    tags: [],
    notes: null,
    weightKg: null,
    waistCm: null,
    updatedAt: takenAt.toISOString(),
    deletedAt: null,
    ...overrides,
  }
}
