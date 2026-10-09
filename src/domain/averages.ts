import { startOfWeek, endOfWeek, getISOWeek, getISOWeekYear, subDays } from 'date-fns'
import type { BP, Period, Reading, Session, SessionAverage } from './types'
import type { GuidelineStandard } from './standards/types'
import { isInTarget } from './classify'
import { formatWeekRange } from './format'

/**
 * Averaging helpers.
 *
 * Every function takes the sessions it should operate on and, where relevant,
 * the instant to measure from. Nothing reads the clock or filters deleted rows
 * on its own — callers hand in an already-active list — which keeps all of this
 * trivially testable with fixed dates.
 */

/** Mean of a session's readings, rounded to whole mmHg as cuffs report them. */
export function sessionAverage(readings: Reading[]): SessionAverage | null {
  if (readings.length === 0) return null

  const systolic = mean(readings.map((r) => r.systolic))
  const diastolic = mean(readings.map((r) => r.diastolic))

  const pulses = readings.map((r) => r.pulse).filter((p): p is number => p !== null)
  const pulse = pulses.length > 0 ? Math.round(mean(pulses)) : null

  return { systolic: Math.round(systolic), diastolic: Math.round(diastolic), pulse }
}

/**
 * Time-of-day bucket from the local hour. Morning readings run higher than
 * evening ones, so mixing them into a single average hides the pattern that
 * matters most.
 */
export function periodFor(date: Date): Period {
  const hour = date.getHours()
  if (hour >= 4 && hour < 12) return 'morning'
  if (hour >= 17 && hour < 24) return 'evening'
  return 'other'
}

/** Mean session average across sessions. Null for an empty list. */
export function averageBP(sessions: Session[]): BP | null {
  if (sessions.length === 0) return null
  return {
    systolic: Math.round(mean(sessions.map((s) => s.avgSystolic))),
    diastolic: Math.round(mean(sessions.map((s) => s.avgDiastolic))),
  }
}

export function averagePulse(sessions: Session[]): number | null {
  const pulses = sessions.map((s) => s.avgPulse).filter((p): p is number => p !== null)
  return pulses.length > 0 ? Math.round(mean(pulses)) : null
}

/**
 * Sessions falling in the `days`-long window ending at `end`.
 * Half-open: later than `end - days`, up to and including `end`.
 */
export function sessionsInWindow(sessions: Session[], end: Date, days: number): Session[] {
  const start = subDays(end, days)
  return sessions.filter((s) => {
    const t = new Date(s.takenAt)
    return t > start && t <= end
  })
}

export interface BPDelta {
  systolic: number
  diastolic: number
}

/** Current minus previous. Negative means blood pressure came down. */
export function deltaBP(current: BP | null, previous: BP | null): BPDelta | null {
  if (!current || !previous) return null
  return {
    systolic: current.systolic - previous.systolic,
    diastolic: current.diastolic - previous.diastolic,
  }
}

export interface WindowTrend {
  average: BP | null
  pulse: number | null
  previousAverage: BP | null
  delta: BPDelta | null
  sessionCount: number
}

/**
 * The dashboard hero: an average over the last `days`, the same span before it,
 * and the difference. Comparing like-for-like spans is what makes the delta
 * honest — a partial week against a full one would flatter or alarm at random.
 */
export function windowTrend(sessions: Session[], end: Date, days: number): WindowTrend {
  const current = sessionsInWindow(sessions, end, days)
  const previous = sessionsInWindow(sessions, subDays(end, days), days)
  const average = averageBP(current)

  return {
    average,
    pulse: averagePulse(current),
    previousAverage: averageBP(previous),
    delta: deltaBP(average, averageBP(previous)),
    sessionCount: current.length,
  }
}

export interface PeriodSplit {
  morning: BP | null
  evening: BP | null
  morningCount: number
  eveningCount: number
}

/** Morning and evening averages. `other` sessions are excluded from both. */
export function periodSplit(sessions: Session[]): PeriodSplit {
  const morning = sessions.filter((s) => s.period === 'morning')
  const evening = sessions.filter((s) => s.period === 'evening')
  return {
    morning: averageBP(morning),
    evening: averageBP(evening),
    morningCount: morning.length,
    eveningCount: evening.length,
  }
}

export interface WeekSummary {
  /** Monday 00:00 local. */
  weekStart: Date
  weekEnd: Date
  isoWeek: number
  isoYear: number
  /** Short human label in the standard's regional convention, e.g. "4–10 Aug". */
  label: string
  sessionCount: number
  readingCount: number
  average: BP
  pulse: number | null
  inTargetCount: number
  /** 0–100, rounded. */
  inTargetPct: number
}

/**
 * Weekly averages, ISO weeks (Monday–Sunday), newest first.
 *
 * Keyed by ISO year + week rather than by date string so the last days of
 * December land in the right bucket instead of starting a phantom week.
 */
export function weeklySummaries(
  sessions: Session[],
  standard: GuidelineStandard,
  target?: BP | null,
): WeekSummary[] {
  const buckets = new Map<string, Session[]>()

  for (const session of sessions) {
    const date = new Date(session.takenAt)
    const key = `${getISOWeekYear(date)}-${getISOWeek(date)}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(session)
    else buckets.set(key, [session])
  }

  const summaries: WeekSummary[] = []

  for (const bucket of buckets.values()) {
    const first = bucket[0]
    if (!first) continue

    const date = new Date(first.takenAt)
    const weekStart = startOfWeek(date, { weekStartsOn: 1 })
    const weekEnd = endOfWeek(date, { weekStartsOn: 1 })
    const average = averageBP(bucket)
    if (!average) continue

    const inTargetCount = bucket.filter((s) =>
      isInTarget({ systolic: s.avgSystolic, diastolic: s.avgDiastolic }, standard, target),
    ).length

    summaries.push({
      weekStart,
      weekEnd,
      isoWeek: getISOWeek(date),
      isoYear: getISOWeekYear(date),
      label: formatWeekRange(weekStart, weekEnd, standard),
      sessionCount: bucket.length,
      readingCount: bucket.reduce((n, s) => n + s.readings.length, 0),
      average,
      pulse: averagePulse(bucket),
      inTargetCount,
      inTargetPct: Math.round((inTargetCount / bucket.length) * 100),
    })
  }

  return summaries.sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime())
}

/** Share of sessions strictly inside the target, 0–100. Null for an empty list. */
export function percentInTarget(
  sessions: Session[],
  standard: GuidelineStandard,
  target?: BP | null,
): number | null {
  if (sessions.length === 0) return null
  const count = sessions.filter((s) =>
    isInTarget({ systolic: s.avgSystolic, diastolic: s.avgDiastolic }, standard, target),
  ).length
  return Math.round((count / sessions.length) * 100)
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}
