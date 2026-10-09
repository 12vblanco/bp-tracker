import { subDays } from 'date-fns'
import type { Session } from './types'

export interface SeriesPoint {
  /** Epoch milliseconds — a numeric x-axis so gaps between readings show as gaps. */
  t: number
  systolic: number
  diastolic: number
  pulse: number | null
  /** Trailing mean over the window, or null until the window has enough history. */
  systolicMean: number | null
  diastolicMean: number | null
}

/**
 * Chart-ready points, oldest first, with a trailing rolling mean.
 *
 * The rolling mean is what makes a trend readable: day-to-day blood pressure
 * swings by 10–15 mmHg for reasons no one can identify, and the raw zigzag
 * invites reading noise as change. The mean is trailing, never centred, so a
 * point never moves once more readings arrive after it.
 */
export function trendSeries(sessions: Session[], windowDays = 7): SeriesPoint[] {
  const ordered = [...sessions].sort((a, b) => a.takenAt.localeCompare(b.takenAt))

  return ordered.map((session, index) => {
    const at = new Date(session.takenAt)
    const from = subDays(at, windowDays)

    // Walk back only as far as the window reaches — the list is sorted, so the
    // first out-of-window session ends the scan.
    let systolicSum = 0
    let diastolicSum = 0
    let count = 0
    for (let i = index; i >= 0; i--) {
      const candidate = ordered[i]
      if (!candidate) break
      if (new Date(candidate.takenAt) <= from) break
      systolicSum += candidate.avgSystolic
      diastolicSum += candidate.avgDiastolic
      count++
    }

    // A "7-day average" drawn from one reading is not an average. Below three
    // it stays null and the line simply starts later.
    const hasMean = count >= 3

    return {
      t: at.getTime(),
      systolic: session.avgSystolic,
      diastolic: session.avgDiastolic,
      pulse: session.avgPulse,
      systolicMean: hasMean ? Math.round(systolicSum / count) : null,
      diastolicMean: hasMean ? Math.round(diastolicSum / count) : null,
    }
  })
}
