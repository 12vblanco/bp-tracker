import type { Reading } from './types'

/**
 * The bounds of a plausible cuff output.
 *
 * Not a medical judgement — the bands in `standards/` do that, and a reading
 * inside these limits can still be an emergency. These are the bounds outside
 * which a number is a typo or a corrupted file rather than a measurement: a
 * systolic of 7 is not a low reading, it is not a reading.
 *
 * Shared by the Log screen and the backup parser on purpose. Two copies would
 * drift, and the pair that matters is exactly "what a person may type" against
 * "what a file may claim" — the same question asked at two doors.
 */
export const READING_LIMITS = {
  systolic: [60, 260],
  diastolic: [30, 200],
  pulse: [30, 250],
} as const

export type ReadingField = keyof typeof READING_LIMITS

export function inReadingRange(value: number, field: ReadingField): boolean {
  const [min, max] = READING_LIMITS[field]
  // Integer, because a cuff reports whole mmHg and a fractional systolic is a
  // sign the value was computed rather than measured.
  return Number.isInteger(value) && value >= min && value <= max
}

/** Both pressures required and in range; pulse optional, but checked when present. */
export function isPlausibleReading(reading: Reading): boolean {
  return (
    inReadingRange(reading.systolic, 'systolic') &&
    inReadingRange(reading.diastolic, 'diastolic') &&
    (reading.pulse === null || inReadingRange(reading.pulse, 'pulse'))
  )
}
