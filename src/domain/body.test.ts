import { describe, it, expect } from 'vitest'
import {
  bodyChange,
  bodyEntries,
  dailyBody,
  formatBody,
  formatBodyDelta,
  formatNumber,
  hasBodyData,
  latestBody,
  parseBody,
  sanitizeDecimal,
  toBodyInput,
  unitFor,
} from './body'
import { AHA, ESC } from './standards'
import { makeSession } from './testing'

describe('units', () => {
  it('shows metric under ESC and imperial under AHA', () => {
    expect(unitFor('weightKg', ESC)).toBe('kg')
    expect(unitFor('waistCm', ESC)).toBe('cm')
    expect(unitFor('weightKg', AHA)).toBe('lb')
    expect(unitFor('waistCm', AHA)).toBe('in')
  })

  it('stores kilograms whichever unit was typed', () => {
    expect(parseBody('78.4', 'weightKg', ESC)).toBe(78.4)
    expect(parseBody('172.8', 'weightKg', AHA)).toBe(78.4)
  })

  it('stores centimetres whichever unit was typed', () => {
    expect(parseBody('94', 'waistCm', ESC)).toBe(94)
    expect(parseBody('37', 'waistCm', AHA)).toBe(94)
  })

  /** The whole reason values are canonical: a stored figure must not change meaning. */
  it('relabels a stored value on a standard switch rather than reinterpreting it', () => {
    const kg = parseBody('80', 'weightKg', ESC)!
    expect(formatBody(kg, 'weightKg', ESC)).toBe('80 kg')
    expect(formatBody(kg, 'weightKg', AHA)).toBe('176.4 lb')
  })

  it('round-trips a typed imperial value back to the same text', () => {
    const kg = parseBody('172.8', 'weightKg', AHA)!
    expect(toBodyInput(kg, 'weightKg', AHA)).toBe('172.8')
  })

  it('round-trips a typed metric value back to the same text', () => {
    const kg = parseBody('78.4', 'weightKg', ESC)!
    expect(toBodyInput(kg, 'weightKg', ESC)).toBe('78.4')
  })
})

describe('parseBody', () => {
  it('reads a whole number and a one-decimal number', () => {
    expect(parseBody('78', 'weightKg', ESC)).toBe(78)
    expect(parseBody('78.4', 'weightKg', ESC)).toBe(78.4)
  })

  it('treats blank as "not measured" rather than as zero', () => {
    expect(parseBody('', 'weightKg', ESC)).toBeNull()
    expect(parseBody('   ', 'weightKg', ESC)).toBeNull()
  })

  it('rejects an implausible weight in the unit it was typed in', () => {
    expect(parseBody('5', 'weightKg', ESC)).toBeNull()
    expect(parseBody('400', 'weightKg', ESC)).toBeNull()
    // 60 lb is 27 kg — plausible, where 60 kg would be too if read as kilograms.
    expect(parseBody('60', 'weightKg', AHA)).toBe(27.2)
    expect(parseBody('50', 'weightKg', AHA)).toBeNull()
  })

  it('rejects an implausible waist', () => {
    expect(parseBody('12', 'waistCm', ESC)).toBeNull()
    expect(parseBody('250', 'waistCm', ESC)).toBeNull()
  })

  it('rejects text that is not a number', () => {
    expect(parseBody('abc', 'weightKg', ESC)).toBeNull()
    expect(parseBody('78.44', 'weightKg', ESC)).toBeNull()
    expect(parseBody('.', 'weightKg', ESC)).toBeNull()
  })
})

describe('sanitizeDecimal', () => {
  it('accepts a European decimal comma', () => {
    expect(sanitizeDecimal('78,4')).toBe('78.4')
  })

  it('keeps one decimal place and drops the rest', () => {
    expect(sanitizeDecimal('78.456')).toBe('78.4')
    expect(sanitizeDecimal('78.4.5')).toBe('78.4')
  })

  it('leaves a part-typed value alone so the field can be typed into', () => {
    expect(sanitizeDecimal('7')).toBe('7')
    expect(sanitizeDecimal('78.')).toBe('78.')
  })

  it('strips anything that is not a digit or a point', () => {
    expect(sanitizeDecimal('78 kg')).toBe('78')
  })
})

describe('formatNumber', () => {
  it('drops a bare decimal zero, because a tape measure has no tenths', () => {
    expect(formatNumber(94)).toBe('94')
    expect(formatNumber(78.4)).toBe('78.4')
  })
})

describe('formatBodyDelta', () => {
  it('always carries a sign, with a true minus', () => {
    expect(formatBodyDelta(-2.4, 'weightKg', ESC)).toBe('−2.4 kg')
    expect(formatBodyDelta(1.5, 'weightKg', ESC)).toBe('+1.5 kg')
  })

  it('converts the difference, not just the endpoints', () => {
    expect(formatBodyDelta(-4.5, 'weightKg', AHA)).toBe('−9.9 lb')
  })
})

describe('dailyBody', () => {
  const morning = makeSession('2026-08-10T08:00', [[130, 80]], { weightKg: 80.4 })
  const evening = makeSession('2026-08-10T20:00', [[128, 78]], { weightKg: 81 })

  it('averages a day measured twice, as a sitting averages its readings', () => {
    expect(dailyBody([morning, evening])).toEqual([
      {
        day: '2026-08-10',
        t: new Date('2026-08-10T12:00:00').getTime(),
        weightKg: 80.7,
        waistCm: null,
      },
    ])
  })

  it('skips sittings with neither measurement', () => {
    const plain = makeSession('2026-08-11T08:00', [[130, 80]])
    expect(dailyBody([morning, plain])).toHaveLength(1)
  })

  it('returns days oldest first, whatever order it was given', () => {
    const later = makeSession('2026-08-12T08:00', [[130, 80]], { weightKg: 79 })
    expect(dailyBody([later, morning]).map((e) => e.day)).toEqual(['2026-08-10', '2026-08-12'])
  })

  it('treats a legacy row with the field absent as not measured', () => {
    // Rows written before v2 carry `undefined`, which is the one value a
    // `=== null` check misses.
    const legacy = makeSession('2026-08-13T08:00', [[130, 80]], {
      weightKg: undefined as unknown as null,
    })
    expect(dailyBody([legacy])).toEqual([])
  })

  it('keeps the two measures independent within a day', () => {
    const waistOnly = makeSession('2026-08-10T09:00', [[130, 80]], { waistCm: 94 })
    expect(dailyBody([morning, waistOnly])[0]).toMatchObject({ weightKg: 80.4, waistCm: 94 })
  })
})

describe('bodyEntries', () => {
  it('returns only the days that recorded the measure asked for', () => {
    const sessions = [
      makeSession('2026-08-10T08:00', [[130, 80]], { weightKg: 80 }),
      makeSession('2026-08-11T08:00', [[130, 80]], { waistCm: 94 }),
    ]
    expect(bodyEntries(sessions, 'weightKg').map((e) => e.day)).toEqual(['2026-08-10'])
    expect(bodyEntries(sessions, 'waistCm').map((e) => e.day)).toEqual(['2026-08-11'])
  })
})

describe('latestBody', () => {
  const sessions = [
    makeSession('2026-08-10T08:00', [[130, 80]], { weightKg: 82, waistCm: 96 }),
    makeSession('2026-09-01T08:00', [[130, 80]], { weightKg: 79 }),
  ]

  it('finds the most recent of each measure independently', () => {
    const latest = latestBody(sessions)
    expect(latest.weightKg).toEqual({
      value: 79,
      takenAt: new Date('2026-09-01T08:00').toISOString(),
    })
    expect(latest.waistCm?.value).toBe(96)
  })

  it('does not care what order the list arrives in', () => {
    expect(latestBody([...sessions].reverse()).weightKg?.value).toBe(79)
  })

  it('returns nulls when nothing was ever measured', () => {
    expect(latestBody([makeSession('2026-08-10T08:00', [[130, 80]])])).toEqual({
      weightKg: null,
      waistCm: null,
    })
  })
})

describe('bodyChange', () => {
  const sessions = [
    makeSession('2026-08-01T08:00', [[130, 80]], { weightKg: 82.5 }),
    makeSession('2026-08-15T08:00', [[130, 80]], { weightKg: 81 }),
    makeSession('2026-09-01T08:00', [[130, 80]], { weightKg: 79.3 }),
  ]

  it('measures first to last across the list it is given', () => {
    expect(bodyChange(sessions, 'weightKg')).toMatchObject({
      first: 82.5,
      last: 79.3,
      delta: -3.2,
      firstDay: '2026-08-01',
      lastDay: '2026-09-01',
      entryCount: 3,
    })
  })

  it('is null on a single measurement, which is a starting point and not a change', () => {
    expect(bodyChange([sessions[0]!], 'weightKg')).toBeNull()
  })

  it('is null when nothing recorded that measure', () => {
    expect(bodyChange(sessions, 'waistCm')).toBeNull()
  })

  it('reports a rise as a positive delta', () => {
    expect(bodyChange([...sessions].reverse(), 'weightKg')?.delta).toBe(-3.2)
    const gaining = [
      makeSession('2026-08-01T08:00', [[130, 80]], { weightKg: 79 }),
      makeSession('2026-09-01T08:00', [[130, 80]], { weightKg: 80.5 }),
    ]
    expect(bodyChange(gaining, 'weightKg')?.delta).toBe(1.5)
  })
})

describe('hasBodyData', () => {
  const weighed = makeSession('2026-08-10T08:00', [[130, 80]], { weightKg: 80 })
  const plain = makeSession('2026-08-11T08:00', [[130, 80]])

  it('finds either measure when asked for neither in particular', () => {
    expect(hasBodyData([plain, weighed])).toBe(true)
    expect(hasBodyData([plain])).toBe(false)
  })

  it('answers per measure, so a chart button only appears for real data', () => {
    expect(hasBodyData([weighed], 'weightKg')).toBe(true)
    expect(hasBodyData([weighed], 'waistCm')).toBe(false)
  })
})
