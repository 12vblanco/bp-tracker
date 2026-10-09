import { describe, it, expect } from 'vitest'
import {
  sessionAverage,
  periodFor,
  averageBP,
  sessionsInWindow,
  windowTrend,
  periodSplit,
  weeklySummaries,
  percentInTarget,
  deltaBP,
} from './averages'
import { ESC } from './standards'
import { makeSession } from './testing'

describe('sessionAverage', () => {
  it('averages and rounds to whole mmHg', () => {
    expect(
      sessionAverage([
        { systolic: 120, diastolic: 80, pulse: null },
        { systolic: 125, diastolic: 85, pulse: null },
      ]),
    ).toEqual({ systolic: 123, diastolic: 83, pulse: null })
  })

  it('averages three readings, the sitting guidelines actually recommend', () => {
    expect(
      sessionAverage([
        { systolic: 140, diastolic: 90, pulse: 72 },
        { systolic: 135, diastolic: 85, pulse: 70 },
        { systolic: 133, diastolic: 83, pulse: 68 },
      ]),
    ).toEqual({ systolic: 136, diastolic: 86, pulse: 70 })
  })

  it('averages only the pulses that were recorded', () => {
    expect(
      sessionAverage([
        { systolic: 130, diastolic: 80, pulse: 70 },
        { systolic: 130, diastolic: 80, pulse: null },
      ])?.pulse,
    ).toBe(70)
  })

  it('returns a null pulse when no cuff reported one', () => {
    expect(sessionAverage([{ systolic: 130, diastolic: 80, pulse: null }])?.pulse).toBeNull()
  })

  it('returns null for an empty sitting', () => {
    expect(sessionAverage([])).toBeNull()
  })
})

describe('periodFor', () => {
  const cases: [string, string][] = [
    ['2026-08-10T03:59', 'other'],
    ['2026-08-10T04:00', 'morning'],
    ['2026-08-10T11:59', 'morning'],
    ['2026-08-10T12:00', 'other'],
    ['2026-08-10T16:59', 'other'],
    ['2026-08-10T17:00', 'evening'],
    ['2026-08-10T23:59', 'evening'],
    ['2026-08-10T00:00', 'other'],
  ]

  it.each(cases)('%s is %s', (local, expected) => {
    expect(periodFor(new Date(local))).toBe(expected)
  })

  it('reads local wall-clock time across a DST change', () => {
    // Europe/Madrid springs forward on 2026-03-29. Both of these are 08:00 on
    // the clock in the room, 23 hours apart in UTC — the bucket must follow the
    // clock, not the elapsed time.
    expect(periodFor(new Date('2026-03-28T08:00'))).toBe('morning')
    expect(periodFor(new Date('2026-03-29T08:00'))).toBe('morning')
  })
})

describe('sessionsInWindow', () => {
  const sessions = [
    makeSession('2026-08-13T08:00', [[150, 95]]),
    makeSession('2026-08-14T08:00', [[150, 95]]),
    makeSession('2026-08-20T08:00', [[140, 90]]),
  ]
  const end = new Date('2026-08-20T23:59')

  it('is half-open: excludes the far edge, includes the near one', () => {
    const window = sessionsInWindow(sessions, end, 7)
    const dates = window.map((s) => s.takenAt.slice(0, 10))
    expect(dates).toEqual(['2026-08-14', '2026-08-20'])
  })
})

describe('windowTrend', () => {
  // Aug 7–13 at 150/95, Aug 14–20 at 140/90.
  const sessions = [
    ...[7, 8, 9, 10, 11, 12, 13].map((d) =>
      makeSession(`2026-08-${String(d).padStart(2, '0')}T08:00`, [[150, 95]]),
    ),
    ...[14, 15, 16, 17, 18, 19, 20].map((d) => makeSession(`2026-08-${d}T08:00`, [[140, 90]])),
  ]
  const end = new Date('2026-08-20T23:59')

  it('compares like-for-like spans', () => {
    const trend = windowTrend(sessions, end, 7)
    expect(trend.average).toEqual({ systolic: 140, diastolic: 90 })
    expect(trend.previousAverage).toEqual({ systolic: 150, diastolic: 95 })
    expect(trend.sessionCount).toBe(7)
  })

  it('reports a fall as a negative delta', () => {
    expect(windowTrend(sessions, end, 7).delta).toEqual({ systolic: -10, diastolic: -5 })
  })

  it('has no delta when there is no prior span to compare against', () => {
    const only = [makeSession('2026-08-20T08:00', [[140, 90]])]
    expect(windowTrend(only, end, 7).delta).toBeNull()
  })
})

describe('deltaBP', () => {
  it('returns null when either side is missing', () => {
    expect(deltaBP(null, { systolic: 140, diastolic: 90 })).toBeNull()
    expect(deltaBP({ systolic: 140, diastolic: 90 }, null)).toBeNull()
  })
})

describe('periodSplit', () => {
  const sessions = [
    makeSession('2026-08-10T08:00', [[145, 92]]),
    makeSession('2026-08-11T08:00', [[141, 90]]),
    makeSession('2026-08-10T20:00', [[131, 84]]),
    makeSession('2026-08-11T14:00', [[135, 88]]), // 'other'
  ]

  it('separates morning from evening', () => {
    const split = periodSplit(sessions)
    expect(split.morning).toEqual({ systolic: 143, diastolic: 91 })
    expect(split.evening).toEqual({ systolic: 131, diastolic: 84 })
    expect(split.morningCount).toBe(2)
    expect(split.eveningCount).toBe(1)
  })

  it('leaves midday readings out of both', () => {
    // The 'other' session at 14:00 is in neither average.
    const split = periodSplit(sessions)
    expect(split.morningCount + split.eveningCount).toBe(3)
  })

  it('returns nulls rather than NaN for an empty side', () => {
    const split = periodSplit([makeSession('2026-08-10T08:00', [[140, 90]])])
    expect(split.evening).toBeNull()
  })
})

describe('weeklySummaries', () => {
  it('keeps an ISO week together across the year boundary', () => {
    // Mon 29 Dec 2025 through Sun 4 Jan 2026 is ISO week 1 of 2026: one bucket,
    // even though the calendar year changes mid-week.
    const summaries = weeklySummaries(
      [
        makeSession('2025-12-29T08:00', [[140, 90]]),
        makeSession('2026-01-01T08:00', [[150, 95]]),
      ],
      ESC,
    )
    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.isoYear).toBe(2026)
    expect(summaries[0]?.isoWeek).toBe(1)
    expect(summaries[0]?.average).toEqual({ systolic: 145, diastolic: 93 })
  })

  it('splits the week before off into its own bucket', () => {
    const summaries = weeklySummaries(
      [
        makeSession('2025-12-28T08:00', [[140, 90]]), // Sunday, ISO week 52 of 2025
        makeSession('2025-12-29T08:00', [[140, 90]]), // Monday, ISO week 1 of 2026
      ],
      ESC,
    )
    expect(summaries).toHaveLength(2)
  })

  it('orders newest first', () => {
    const summaries = weeklySummaries(
      [
        makeSession('2026-08-03T08:00', [[140, 90]]),
        makeSession('2026-08-17T08:00', [[140, 90]]),
        makeSession('2026-08-10T08:00', [[140, 90]]),
      ],
      ESC,
    )
    expect(summaries.map((s) => s.weekStart.getDate())).toEqual([17, 10, 3])
  })

  it('names both months when a week straddles one', () => {
    // Mon 27 Jul – Sun 2 Aug 2026. "27–2 Aug" would read as going backwards.
    const summaries = weeklySummaries([makeSession('2026-07-29T08:00', [[140, 90]])], ESC)
    expect(summaries[0]?.label).toBe('27 Jul–2 Aug')
  })

  it('names the month once when a week sits inside one', () => {
    const summaries = weeklySummaries([makeSession('2026-08-12T08:00', [[140, 90]])], ESC)
    expect(summaries[0]?.label).toBe('10–16 Aug')
  })

  it('counts readings, not just sittings', () => {
    const summaries = weeklySummaries(
      [
        makeSession('2026-08-10T08:00', [
          [140, 90],
          [138, 88],
          [136, 86],
        ]),
      ],
      ESC,
    )
    expect(summaries[0]?.sessionCount).toBe(1)
    expect(summaries[0]?.readingCount).toBe(3)
  })

  it('reports percent in target per week', () => {
    const summaries = weeklySummaries(
      [
        makeSession('2026-08-10T08:00', [[130, 80]]), // in target under ESC
        makeSession('2026-08-11T08:00', [[145, 92]]), // out
      ],
      ESC,
    )
    expect(summaries[0]?.inTargetCount).toBe(1)
    expect(summaries[0]?.inTargetPct).toBe(50)
  })
})

describe('percentInTarget', () => {
  it('is null rather than zero for no data', () => {
    expect(percentInTarget([], ESC)).toBeNull()
  })
})

describe('averageBP', () => {
  it('is null for an empty list', () => {
    expect(averageBP([])).toBeNull()
  })
})
