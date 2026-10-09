import { describe, it, expect } from 'vitest'
import {
  formatDate,
  formatDateShort,
  formatTime,
  formatWeekRange,
  formatDayFull,
} from './format'
import { bandRange, classify } from './classify'
import { ESC, AHA } from './standards'

const AUG_20 = new Date('2026-08-20T20:06')

describe('regional dates', () => {
  it('puts the day first in Europe and the month first in the US', () => {
    expect(formatDate(AUG_20, ESC)).toBe('20 Aug 2026')
    expect(formatDate(AUG_20, AHA)).toBe('Aug 20, 2026')
  })

  it('follows the region for short dates too', () => {
    expect(formatDateShort(AUG_20, ESC)).toBe('20 Aug')
    expect(formatDateShort(AUG_20, AHA)).toBe('Aug 20')
  })

  it('uses a 24-hour clock in Europe and a 12-hour one in the US', () => {
    expect(formatTime(AUG_20, ESC)).toBe('20:06')
    expect(formatTime(AUG_20, AHA)).toBe('8:06 PM')
  })

  it('formats a full weekday heading per region', () => {
    expect(formatDayFull(AUG_20, ESC)).toBe('Thursday 20 August')
    expect(formatDayFull(AUG_20, AHA)).toBe('Thursday, August 20')
  })
})

describe('week ranges', () => {
  const monday = new Date('2026-08-10T00:00')
  const sunday = new Date('2026-08-16T23:59')

  it('names the month once for a week inside one month', () => {
    // The bare number goes on whichever end the region does not put the month.
    expect(formatWeekRange(monday, sunday, ESC)).toBe('10–16 Aug')
    expect(formatWeekRange(monday, sunday, AHA)).toBe('Aug 10–16')
  })

  it('names both months when the week straddles one', () => {
    const start = new Date('2026-07-27T00:00')
    const end = new Date('2026-08-02T23:59')
    expect(formatWeekRange(start, end, ESC)).toBe('27 Jul–2 Aug')
    expect(formatWeekRange(start, end, AHA)).toBe('Jul 27–Aug 2')
  })
})

describe('bandRange', () => {
  it('derives ESC ranges from the thresholds themselves', () => {
    const severity = classify({ systolic: 135, diastolic: 86 }, ESC).severity
    expect(bandRange(ESC, severity)).toEqual({ systolic: '130–139', diastolic: '85–89' })
  })

  it('describes the lowest band as an open lower bound', () => {
    expect(bandRange(ESC, 0)).toEqual({ systolic: 'under 120', diastolic: 'under 80' })
  })

  it('describes the worst band as an open upper bound', () => {
    expect(bandRange(ESC, 5)).toEqual({
      systolic: '180 or above',
      diastolic: '110 or above',
    })
  })

  it('reports no diastolic range for AHA’s systolic-only Elevated band', () => {
    const severity = classify({ systolic: 125, diastolic: 70 }, AHA).severity
    expect(bandRange(AHA, severity)).toEqual({ systolic: '120–129', diastolic: null })
  })

  it('skips the null-floored band when bounding the one below it', () => {
    // AHA Normal's diastolic ceiling comes from Stage 1's floor of 80, not from
    // Elevated, which has no diastolic floor at all.
    expect(bandRange(AHA, 0)).toEqual({ systolic: 'under 120', diastolic: 'under 80' })
  })

  it('gives every band a description', () => {
    for (const standard of [ESC, AHA]) {
      for (const band of standard.bands) {
        expect(band.description.length).toBeGreaterThan(20)
      }
    }
  })
})
