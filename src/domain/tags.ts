import type { BP, Session } from './types'
import { averageBP, deltaBP, type BPDelta } from './averages'

export const DEFAULT_TAGS = [
  'meds taken',
  'missed meds',
  'caffeine',
  'exercise',
  'stressed',
  'poor sleep',
  'alcohol',
  'unwell',
] as const

export interface TagComparison {
  tag: string
  withAverage: BP
  withoutAverage: BP
  withCount: number
  withoutCount: number
  /** Tagged minus untagged. Positive means the tag goes with higher readings. */
  delta: BPDelta
}

/**
 * Average blood pressure with a tag versus without it.
 *
 * Only tags with at least `minSample` sessions on *both* sides are returned.
 * Without that gate the screen would happily announce that caffeine raises your
 * systolic by 12 on the strength of two readings, which is worse than showing
 * nothing — it is a wrong conclusion presented with the same confidence as a
 * right one.
 *
 * This is a correlation over self-selected notes. It cannot separate "coffee
 * raises my BP" from "I drink coffee on stressful mornings", and the UI says so.
 */
export function tagComparisons(sessions: Session[], minSample = 5): TagComparison[] {
  const tags = new Set<string>()
  for (const session of sessions) {
    for (const tag of session.tags) tags.add(tag)
  }

  const comparisons: TagComparison[] = []

  for (const tag of tags) {
    const tagged = sessions.filter((s) => s.tags.includes(tag))
    const untagged = sessions.filter((s) => !s.tags.includes(tag))

    if (tagged.length < minSample || untagged.length < minSample) continue

    const withAverage = averageBP(tagged)
    const withoutAverage = averageBP(untagged)
    const delta = deltaBP(withAverage, withoutAverage)
    if (!withAverage || !withoutAverage || !delta) continue

    comparisons.push({
      tag,
      withAverage,
      withoutAverage,
      withCount: tagged.length,
      withoutCount: untagged.length,
      delta,
    })
  }

  // Largest systolic effect first, in either direction.
  return comparisons.sort((a, b) => Math.abs(b.delta.systolic) - Math.abs(a.delta.systolic))
}

/** Tags in use across the given sessions, most-used first. */
export function tagUsage(sessions: Session[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const session of sessions) {
    for (const tag of session.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
}
