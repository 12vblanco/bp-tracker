import type { BP, Session } from './types'
import type { Band, GuidelineStandard } from './standards/types'

export type Urgency = 'none' | 'urgent' | 'emergency'

export interface Classification {
  band: Band
  /** Index into `standard.bands`. Higher is worse. Comparable only within one standard. */
  severity: number
  /** Systolic at or above the standard's floor while diastolic stays below it. */
  isolatedSystolic: boolean
  urgency: Urgency
  /** Below 90/60 — worth noticing when medication is being titrated. */
  low: boolean
  /** Strictly below the target on both values. */
  inTarget: boolean
}

/**
 * Score one axis against its own inclusive floors and return the index of the
 * worst band it reaches. Bands with a null floor on this axis are skipped,
 * which is how AHA's Elevated stays systolic-only.
 */
function axisSeverity(value: number, bands: Band[], axis: 'systolic' | 'diastolic'): number {
  let severity = 0
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i]
    if (!band) continue
    const floor = axis === 'systolic' ? band.systolicFrom : band.diastolicFrom
    if (floor !== null && value >= floor) severity = i
  }
  return severity
}

/**
 * Classify a reading under a standard.
 *
 * `target` overrides the standard's home threshold when a doctor has set a
 * personal goal; pass null or omit it to use the standard's own figure.
 *
 * Nothing here is cached or persisted — call it at render time so a change of
 * standard reclassifies every reading you have ever taken.
 */
export function classify(
  bp: BP,
  standard: GuidelineStandard,
  target?: BP | null,
): Classification {
  const severity = Math.max(
    axisSeverity(bp.systolic, standard.bands, 'systolic'),
    axisSeverity(bp.diastolic, standard.bands, 'diastolic'),
  )

  // Severity is derived from the band list itself, so index 0 always exists.
  const band = standard.bands[severity] ?? standard.bands[0]!

  const goal = target ?? standard.homeThreshold

  return {
    band,
    severity,
    isolatedSystolic:
      bp.systolic >= standard.isolatedSystolic.systolicFrom &&
      bp.diastolic < standard.isolatedSystolic.diastolicBelow,
    urgency: urgencyOf(bp, standard),
    low: bp.systolic < 90 || bp.diastolic < 60,
    inTarget: bp.systolic < goal.systolic && bp.diastolic < goal.diastolic,
  }
}

/**
 * Either value crossing a floor is enough. Deliberately `or`, not `and`:
 * an isolated diastolic of 125 is an emergency regardless of the systolic,
 * and over-warning is the safe direction to err in.
 *
 * Both tiers share a systolic floor of 180 because both guidelines put the
 * crisis line there, so in practice `urgent` is reached only by a diastolic of
 * 110–119 — ESC Grade 3 sitting just below the crisis threshold. A systolic of
 * 180 goes straight to `emergency`, which is what "≥180 and/or ≥120" means.
 *
 * The tiers separate *numbers*, not severity of response. Guidelines distinguish
 * hypertensive urgency from emergency by target-organ symptoms, which no cuff
 * can report, so the banner shows the symptom list at both tiers and tells you
 * to seek emergency care if any are present.
 */
export function urgencyOf(bp: BP, standard: GuidelineStandard): Urgency {
  if (
    bp.systolic >= standard.emergency.systolic ||
    bp.diastolic >= standard.emergency.diastolic
  ) {
    return 'emergency'
  }
  if (bp.systolic >= standard.urgent.systolic || bp.diastolic >= standard.urgent.diastolic) {
    return 'urgent'
  }
  return 'none'
}

/** Convenience for the common "is this reading within goal" question. */
export function isInTarget(bp: BP, standard: GuidelineStandard, target?: BP | null): boolean {
  const goal = target ?? standard.homeThreshold
  return bp.systolic < goal.systolic && bp.diastolic < goal.diastolic
}

export interface BandRange {
  /** e.g. "130–139" or "under 120" or "180 or above". */
  systolic: string
  /** Null when no diastolic value maps to this band — AHA's Elevated. */
  diastolic: string | null
}

/**
 * The numeric range a band covers, derived from its own floor and the floor of
 * the band above it.
 *
 * Computed rather than written out beside each band so the numbers in a tooltip
 * can never drift from the numbers doing the classifying.
 */
export function bandRange(standard: GuidelineStandard, severity: number): BandRange {
  const band = standard.bands[severity]
  if (!band) return { systolic: '', diastolic: null }

  const next = standard.bands[severity + 1]

  const axis = (from: number | null, to: number | null | undefined): string | null => {
    if (from === null) return null
    if (from === -Infinity) return to === null || to === undefined ? '' : `under ${to}`
    if (to === null || to === undefined) return `${from} or above`
    return `${from}–${to - 1}`
  }

  return {
    systolic: axis(band.systolicFrom, next?.systolicFrom) ?? '',
    // Walk forward for the next band that actually has a diastolic floor, so a
    // null-floored band above does not truncate the range below it.
    diastolic: axis(
      band.diastolicFrom,
      standard.bands.slice(severity + 1).find((b) => b.diastolicFrom !== null)?.diastolicFrom,
    ),
  }
}

export interface BandCount {
  band: Band
  severity: number
  count: number
  /** 0–100, rounded. Shares may not total exactly 100 after rounding. */
  pct: number
}

/**
 * How many sittings fall in each band, best to worst.
 *
 * Every band is returned, including empty ones: "no sittings in Grade 3" is
 * information, and a list whose rows appear and vanish as the data changes is
 * harder to read than a fixed one.
 */
export function bandDistribution(
  sessions: Session[],
  standard: GuidelineStandard,
  target?: BP | null,
): BandCount[] {
  const counts = new Array<number>(standard.bands.length).fill(0)

  for (const session of sessions) {
    const { severity } = classify(
      { systolic: session.avgSystolic, diastolic: session.avgDiastolic },
      standard,
      target,
    )
    counts[severity] = (counts[severity] ?? 0) + 1
  }

  return standard.bands.map((band, severity) => ({
    band,
    severity,
    count: counts[severity] ?? 0,
    pct:
      sessions.length === 0 ? 0 : Math.round(((counts[severity] ?? 0) / sessions.length) * 100),
  }))
}
