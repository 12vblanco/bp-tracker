import { subDays, setHours, setMinutes } from 'date-fns'
import type { Reading } from '../domain/types'
import { periodFor } from '../domain/averages'
import { createSession } from './repository'

/**
 * Development seed: roughly four months of plausible history.
 *
 * Charts, weekly tables, and the tag-insight sample gate all behave differently
 * on three rows than on three months, and judging a layout on toy data is how
 * you ship one that falls apart on real data. Deterministic so a layout bug
 * looks the same on every run.
 */

/** mulberry32 — small, seeded, good enough for fake blood pressure. */
function rng(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export async function seedDemoData(days = 120): Promise<number> {
  const random = rng(20260820)
  const now = new Date()
  let created = 0

  for (let dayOffset = days; dayOffset >= 0; dayOffset--) {
    // Roughly four days in five — a real person misses days.
    if (random() < 0.2) continue

    const date = subDays(now, dayOffset)
    // Gentle improvement over the period, as medication takes hold.
    const drift = (dayOffset / days) * 9
    const progress = (days - dayOffset) / days

    // Body measurements are occasional on purpose: a scale most mornings, a tape
    // measure about once a fortnight. Seeding them on every sitting would make
    // the sparse case — the one the UI has to handle well — invisible.
    const weightKg =
      random() < 0.6 ? Math.round((82 - progress * 4 + (random() - 0.5) * 0.8) * 10) / 10 : null
    const waistCm = dayOffset % 14 === 0 ? Math.round((98 - progress * 5) * 2) / 2 : null

    const sittings: { hour: number; minute: number; lift: number }[] = [
      { hour: 7, minute: 30 + Math.floor(random() * 40), lift: 5 },
    ]
    if (random() < 0.75) {
      sittings.push({ hour: 20, minute: Math.floor(random() * 50), lift: -3 })
    }

    for (const [index, sitting] of sittings.entries()) {
      const takenAt = setMinutes(setHours(date, sitting.hour), sitting.minute)
      // Morning sitting only. Weighing yourself twice a day is not a thing, and
      // the day's figure would end up an average of before and after dinner.
      const isFirst = index === 0

      const tags: string[] = []
      if (random() < 0.85) tags.push('meds taken')
      else tags.push('missed meds')
      if (random() < 0.3) tags.push('caffeine')
      if (random() < 0.2) tags.push('exercise')
      if (random() < 0.18) tags.push('stressed')
      if (random() < 0.15) tags.push('poor sleep')

      // Tags nudge the numbers so the insight panel has something real to find.
      const tagLift =
        (tags.includes('missed meds') ? 8 : 0) +
        (tags.includes('stressed') ? 6 : 0) +
        (tags.includes('poor sleep') ? 4 : 0) +
        (tags.includes('caffeine') ? 3 : 0) +
        (tags.includes('exercise') ? -4 : 0)

      const base = 128 + drift + sitting.lift + tagLift
      const readings: Reading[] = []
      const count = random() < 0.8 ? 3 : 2

      for (let i = 0; i < count; i++) {
        // Readings settle downward across a sitting, as they do in life.
        const settle = i * -2.5
        const noise = (random() - 0.5) * 9
        const systolic = Math.round(base + settle + noise)
        const diastolic = Math.round(systolic * 0.63 + (random() - 0.5) * 5)
        readings.push({
          systolic,
          diastolic,
          pulse: Math.round(68 + (random() - 0.5) * 14),
        })
      }

      await createSession({
        takenAt,
        period: periodFor(takenAt),
        arm: 'left',
        readings,
        tags,
        notes: null,
        weightKg: isFirst ? weightKg : null,
        waistCm: isFirst ? waistCm : null,
      })
      created++
    }
  }

  return created
}
