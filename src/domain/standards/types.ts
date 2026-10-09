import type { BP } from '../types'

export type StandardId = 'esc' | 'aha'

/**
 * Visual severity, kept separate from the label so components never
 * switch on a standard-specific category name.
 */
export type Tone = 'optimal' | 'normal' | 'watch' | 'warn' | 'high' | 'severe'

/**
 * One category in a guideline's table.
 *
 * Both ESC/ESH and AHA/ACC classify by the *worse* of the two values, which
 * falls out naturally if each axis is scored independently against its own
 * inclusive floor and the higher severity wins. That single model reproduces
 * both tables exactly — including AHA's `and`-joined Elevated band, which is
 * expressed by giving it no diastolic floor at all.
 */
export interface Band {
  id: string
  label: string
  tone: Tone
  /** Plain-language meaning, shown in the badge tooltip. */
  description: string
  /** Inclusive systolic floor. The lowest band uses -Infinity. */
  systolicFrom: number
  /**
   * Inclusive diastolic floor, or null when no diastolic value can land a
   * reading in this band. Null is what makes AHA's Elevated behave as
   * "120–129 AND <80" rather than "and/or".
   */
  diastolicFrom: number | null
}

/**
 * Regional conventions that travel with the standard.
 *
 * A guideline is a regional artefact, so the region's date and time habits ride
 * along with it: picking ESC/ESH means European dates, picking AHA/ACC means US
 * ones. That keeps one visible choice in Settings instead of two, and it is the
 * pairing a reader expects.
 */
export interface RegionFormat {
  /** Flag emoji shown beside the standard's name. */
  flag: string
  /** date-fns locale tag driving month and weekday names. */
  localeTag: 'en-GB' | 'en-US'
  /** "20 Aug 2026" vs "Aug 20, 2026". */
  date: string
  /** "20 Aug" vs "Aug 20". */
  dateShort: string
  /** "20/08/2026" vs "08/20/2026". */
  dateNumeric: string
  /** 24-hour vs 12-hour. */
  time: string
  /** "Thursday 20 August" vs "Thursday, August 20". */
  dayFull: string
  /** Day-and-month only, for week ranges. */
  dayMonth: string
  /** Bare day number, for the near end of a same-month week range. */
  dayOnly: string
  /** Weight as shown. Stored values are always kilograms. */
  weightUnit: 'kg' | 'lb'
  /** Circumference as shown. Stored values are always centimetres. */
  lengthUnit: 'cm' | 'in'
}

export interface GuidelineStandard {
  id: StandardId
  /** Full name, shown in Settings and on the printed report. */
  name: string
  /** Compact name for badges and tight layouts. */
  shortName: string
  /** Cited on the report so a clinician knows which yardstick produced it. */
  source: string
  /** Date, time, and flag conventions for this standard's region. */
  format: RegionFormat
  /** Ordered best → worst. Array index is the severity score. */
  bands: Band[]
  /**
   * Hypertension cutoff for *home* self-measurement, which is lower than the
   * clinic cutoff in both standards. Every reading in this app is a home
   * reading, so this — not the office number — drives target bands and
   * "% in range".
   */
  homeThreshold: BP
  /** Persistent-warning floor. Either value at or above it triggers. */
  urgent: BP
  /** Urgent-care floor. Either value at or above it triggers. */
  emergency: BP
  /** Isolated systolic hypertension: systolic at or above, diastolic below. */
  isolatedSystolic: { systolicFrom: number; diastolicBelow: number }
}
