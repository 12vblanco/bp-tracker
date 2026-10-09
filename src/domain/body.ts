import type { Session } from './types'
import type { GuidelineStandard } from './standards/types'

/**
 * Weight and waist circumference.
 *
 * Two things hold this design together:
 *
 * 1. **Stored in metric, always.** A value persisted as a bare `78` becomes a
 *    different measurement the moment the display unit changes — a 78 kg person
 *    would read as 78 lb after a trip to Settings. Kilograms and centimetres go
 *    in the database; the unit on screen comes from the active standard, so
 *    switching ESC↔AHA re-labels a number instead of reinterpreting it. Same
 *    rule as the bands: nothing region-specific is ever written down.
 *
 * 2. **A day's measurement, not a sitting's.** Weight rides along on a BP
 *    sitting because that is the trip you already make, but it belongs to the
 *    day. Where a day carries more than one, the day's figure is their mean —
 *    the same treatment the readings inside a sitting get, rather than a
 *    "first one wins" rule nobody would guess.
 *
 * Nothing here classifies. Waist has published risk thresholds, but they depend
 * on sex and ethnicity, neither of which this app knows or should start asking
 * for. It records what you measure.
 */

const KG_PER_LB = 0.45359237
const CM_PER_IN = 2.54

/** Plausible ranges in canonical units. Wide enough not to argue with anyone. */
const RANGE = {
  weightKg: [25, 350],
  waistCm: [40, 200],
} as const

export type BodyMeasure = 'weightKg' | 'waistCm'

export function weightUnit(standard: GuidelineStandard): string {
  return standard.format.weightUnit
}

export function lengthUnit(standard: GuidelineStandard): string {
  return standard.format.lengthUnit
}

/** The unit a measure is shown in under this standard. */
export function unitFor(measure: BodyMeasure, standard: GuidelineStandard): string {
  return measure === 'weightKg' ? weightUnit(standard) : lengthUnit(standard)
}

/** "Weight" / "Waist" — one label for both the field and the chart. */
export function labelFor(measure: BodyMeasure): string {
  return measure === 'weightKg' ? 'Weight' : 'Waist'
}

export function kgToDisplay(kg: number, standard: GuidelineStandard): number {
  return standard.format.weightUnit === 'lb' ? kg / KG_PER_LB : kg
}

export function displayToKg(value: number, standard: GuidelineStandard): number {
  return standard.format.weightUnit === 'lb' ? value * KG_PER_LB : value
}

export function cmToDisplay(cm: number, standard: GuidelineStandard): number {
  return standard.format.lengthUnit === 'in' ? cm / CM_PER_IN : cm
}

export function displayToCm(value: number, standard: GuidelineStandard): number {
  return standard.format.lengthUnit === 'in' ? value * CM_PER_IN : value
}

/** Canonical → display, for whichever measure. */
export function toDisplay(
  value: number,
  measure: BodyMeasure,
  standard: GuidelineStandard,
): number {
  return measure === 'weightKg' ? kgToDisplay(value, standard) : cmToDisplay(value, standard)
}

/** Display → canonical, for whichever measure. */
export function fromDisplay(
  value: number,
  measure: BodyMeasure,
  standard: GuidelineStandard,
): number {
  return measure === 'weightKg' ? displayToKg(value, standard) : displayToCm(value, standard)
}

/**
 * One decimal, with a bare `.0` dropped. A bathroom scale reports 78.4 and a
 * tape measure 94, and printing "94.0 cm" implies a precision the tape does
 * not have.
 */
export function formatNumber(value: number): string {
  const text = value.toFixed(1)
  return text.endsWith('.0') ? text.slice(0, -2) : text
}

/** "78.4 kg" / "172.8 lb" / "94 cm" / "37 in" — always with its unit. */
export function formatBody(
  value: number,
  measure: BodyMeasure,
  standard: GuidelineStandard,
): string {
  return `${formatNumber(toDisplay(value, measure, standard))} ${unitFor(measure, standard)}`
}

/** A signed difference in display units, e.g. "−2.4 kg". Sign is always shown. */
export function formatBodyDelta(
  delta: number,
  measure: BodyMeasure,
  standard: GuidelineStandard,
): string {
  const shown = toDisplay(Math.abs(delta), measure, standard)
  // A true minus sign, not a hyphen — it lines up with the tabular figures.
  return `${delta < 0 ? '−' : '+'}${formatNumber(shown)} ${unitFor(measure, standard)}`
}

/**
 * Keeps a part-typed decimal usable: a European comma becomes a point, and the
 * value is capped at three whole digits and one decimal. Kept permissive on
 * purpose — validation is `parseBody`'s job, and rejecting keystrokes mid-entry
 * is how a field stops you typing "7" on the way to "78.4".
 */
export function sanitizeDecimal(value: string): string {
  const normalized = value.replace(',', '.').replace(/[^\d.]/g, '')
  const [whole = '', ...rest] = normalized.split('.')
  const head = whole.slice(0, 3)
  return rest.length === 0 ? head : `${head}.${rest.join('').slice(0, 1)}`
}

/**
 * A typed field to a canonical value, or null when it is blank, malformed, or
 * outside the plausible range. Blank and invalid deliberately collapse to the
 * same answer: both mean "do not record a measurement".
 */
export function parseBody(
  text: string,
  measure: BodyMeasure,
  standard: GuidelineStandard,
): number | null {
  const trimmed = text.trim()
  if (trimmed === '' || !/^\d{1,3}(\.\d)?$/.test(trimmed)) return null

  const canonical = fromDisplay(Number(trimmed), measure, standard)
  const [min, max] = RANGE[measure]
  if (canonical < min || canonical > max) return null

  // Stored to one decimal in canonical units. Round-tripping 172.8 lb through
  // kilograms and back has to land on 172.8 again, and a full-precision kg
  // value would drift a tenth on the way home.
  return Math.round(canonical * 10) / 10
}

/** Canonical value → the string that field should show. Empty for "not recorded". */
export function toBodyInput(
  value: number | null,
  measure: BodyMeasure,
  standard: GuidelineStandard,
): string {
  return value === null ? '' : formatNumber(toDisplay(value, measure, standard))
}

export interface BodyEntry {
  /** ISO calendar day. */
  day: string
  /** Midday of that day in epoch ms — a chart x with no chance of a timezone slip. */
  t: number
  weightKg: number | null
  waistCm: number | null
}

/**
 * One entry per calendar day that carries a measurement, oldest first. Days
 * with neither are absent rather than null-filled, so a caller can count
 * entries to find out how often something was actually measured.
 */
export function dailyBody(sessions: Session[]): BodyEntry[] {
  const byDay = new Map<string, { weights: number[]; waists: number[] }>()

  for (const session of sessions) {
    const weight = session.weightKg ?? null
    const waist = session.waistCm ?? null
    if (weight === null && waist === null) continue

    const day = session.takenAt.slice(0, 10)
    let bucket = byDay.get(day)
    if (!bucket) {
      bucket = { weights: [], waists: [] }
      byDay.set(day, bucket)
    }
    if (weight !== null) bucket.weights.push(weight)
    if (waist !== null) bucket.waists.push(waist)
  }

  return [...byDay.entries()]
    .map(([day, bucket]) => ({
      day,
      t: new Date(`${day}T12:00:00`).getTime(),
      weightKg: roundedMean(bucket.weights),
      waistCm: roundedMean(bucket.waists),
    }))
    .sort((a, b) => a.day.localeCompare(b.day))
}

/** Days in this list that recorded the given measure. */
export function bodyEntries(sessions: Session[], measure: BodyMeasure): BodyEntry[] {
  return dailyBody(sessions).filter((entry) => entry[measure] !== null)
}

export interface BodyReading {
  /** Canonical units. */
  value: number
  /** The sitting it was recorded on. */
  takenAt: string
}

/**
 * The most recent of each measure, whenever it was taken. Deliberately not
 * windowed: "last weighed six weeks ago" is the useful answer, and a range
 * filter would have replaced it with a dash.
 */
export function latestBody(sessions: Session[]): {
  weightKg: BodyReading | null
  waistCm: BodyReading | null
} {
  const newestFirst = [...sessions].sort((a, b) => b.takenAt.localeCompare(a.takenAt))

  return {
    weightKg: findLatest(newestFirst, 'weightKg'),
    waistCm: findLatest(newestFirst, 'waistCm'),
  }
}

export interface BodyChange {
  /** Canonical units. */
  first: number
  last: number
  /** `last - first`. Negative means the figure came down. */
  delta: number
  firstDay: string
  lastDay: string
  /** How many days recorded this measure. */
  entryCount: number
}

/**
 * First to last within whatever list it is given, so the caller's range filter
 * decides the span. Null below two entries: a single measurement is a starting
 * point, not a change, and reporting it as "+0" would read as "no movement".
 */
export function bodyChange(sessions: Session[], measure: BodyMeasure): BodyChange | null {
  const entries = bodyEntries(sessions, measure)
  const first = entries[0]
  const last = entries[entries.length - 1]
  if (!first || !last || entries.length < 2) return null

  const from = first[measure]!
  const to = last[measure]!

  return {
    first: from,
    last: to,
    delta: Math.round((to - from) * 10) / 10,
    firstDay: first.day,
    lastDay: last.day,
    entryCount: entries.length,
  }
}

/** True when anything in this list carries either measurement. */
export function hasBodyData(sessions: Session[], measure?: BodyMeasure): boolean {
  return sessions.some((session) =>
    measure === undefined
      ? (session.weightKg ?? null) !== null || (session.waistCm ?? null) !== null
      : (session[measure] ?? null) !== null,
  )
}

function findLatest(newestFirst: Session[], measure: BodyMeasure): BodyReading | null {
  for (const session of newestFirst) {
    const value = session[measure] ?? null
    if (value !== null) return { value, takenAt: session.takenAt }
  }
  return null
}

function roundedMean(values: number[]): number | null {
  if (values.length === 0) return null
  const sum = values.reduce((total, value) => total + value, 0)
  return Math.round((sum / values.length) * 10) / 10
}
