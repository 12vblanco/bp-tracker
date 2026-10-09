import { describe, it, expect } from 'vitest'
import { bandDistribution, classify, urgencyOf } from './classify'
import { ESC, AHA, getStandard, DEFAULT_STANDARD_ID } from './standards'
import { percentInTarget } from './averages'
import { makeSession } from './testing'

describe('ESC/ESH bands', () => {
  const cases: [number, number, string][] = [
    [119, 79, 'optimal'],
    [120, 79, 'normal'],
    [119, 80, 'normal'],
    [129, 84, 'normal'],
    [130, 84, 'high-normal'],
    [129, 85, 'high-normal'],
    [139, 89, 'high-normal'],
    [140, 89, 'grade-1'],
    [139, 90, 'grade-1'],
    [159, 99, 'grade-1'],
    [160, 99, 'grade-2'],
    [159, 100, 'grade-2'],
    [179, 109, 'grade-2'],
    [180, 109, 'grade-3'],
    [179, 110, 'grade-3'],
  ]

  it.each(cases)('%i/%i is %s', (systolic, diastolic, expected) => {
    expect(classify({ systolic, diastolic }, ESC).band.id).toBe(expected)
  })

  it('takes the worse of the two values', () => {
    // Diastolic drives it: 118 alone would be Optimal.
    expect(classify({ systolic: 118, diastolic: 92 }, ESC).band.id).toBe('grade-1')
    // Systolic drives it: 70 alone would be Optimal.
    expect(classify({ systolic: 145, diastolic: 70 }, ESC).band.id).toBe('grade-1')
  })

  it('flags isolated systolic hypertension', () => {
    expect(classify({ systolic: 145, diastolic: 70 }, ESC).isolatedSystolic).toBe(true)
    // Diastolic at the ceiling, so not isolated.
    expect(classify({ systolic: 145, diastolic: 90 }, ESC).isolatedSystolic).toBe(false)
    // Systolic below the floor, so not isolated.
    expect(classify({ systolic: 138, diastolic: 70 }, ESC).isolatedSystolic).toBe(false)
  })
})

describe('AHA/ACC bands', () => {
  const cases: [number, number, string][] = [
    [119, 79, 'normal'],
    [120, 79, 'elevated'],
    [129, 79, 'elevated'],
    [130, 79, 'stage-1'],
    [119, 80, 'stage-1'],
    [139, 89, 'stage-1'],
    [140, 89, 'stage-2'],
    [139, 90, 'stage-2'],
    [179, 119, 'stage-2'],
    [180, 119, 'crisis'],
    [140, 120, 'crisis'],
  ]

  it.each(cases)('%i/%i is %s', (systolic, diastolic, expected) => {
    expect(classify({ systolic, diastolic }, AHA).band.id).toBe(expected)
  })

  it('122/84 is Stage 1, not Elevated', () => {
    // Elevated is the one band joined with AND (120-129 and <80), so a
    // diastolic of 84 pulls this up to Stage 1. Encoding Elevated with a null
    // diastolic floor is what makes this come out right.
    const result = classify({ systolic: 122, diastolic: 84 }, AHA)
    expect(result.band.id).toBe('stage-1')
    expect(result.band.id).not.toBe('elevated')
  })

  it('keeps Elevated systolic-only', () => {
    expect(classify({ systolic: 125, diastolic: 79 }, AHA).band.id).toBe('elevated')
    expect(classify({ systolic: 125, diastolic: 80 }, AHA).band.id).toBe('stage-1')
  })
})

describe('urgency', () => {
  it('stays quiet below the floors', () => {
    expect(urgencyOf({ systolic: 179, diastolic: 109 }, ESC)).toBe('none')
  })

  it('warns on a diastolic in the 110–119 severe band', () => {
    // Both guidelines put the crisis line at a systolic of 180, so `urgent` is
    // the diastolic-only tier: ESC Grade 3 sitting below the crisis threshold.
    expect(urgencyOf({ systolic: 150, diastolic: 110 }, ESC)).toBe('urgent')
    expect(urgencyOf({ systolic: 170, diastolic: 119 }, ESC)).toBe('urgent')
  })

  it('treats a systolic of 180 as crisis-range on its own', () => {
    // "≥180 and/or ≥120" — the systolic alone qualifies, so this must not be
    // downgraded to a softer warning just because the diastolic looks fine.
    expect(urgencyOf({ systolic: 180, diastolic: 90 }, ESC)).toBe('emergency')
    expect(urgencyOf({ systolic: 200, diastolic: 80 }, ESC)).toBe('emergency')
  })

  it('escalates on an isolated diastolic crisis', () => {
    expect(urgencyOf({ systolic: 180, diastolic: 120 }, ESC)).toBe('emergency')
    // Systolic well below the floor; the diastolic alone carries it.
    expect(urgencyOf({ systolic: 150, diastolic: 125 }, ESC)).toBe('emergency')
  })

  it('uses the same floors under both standards', () => {
    expect(urgencyOf({ systolic: 170, diastolic: 115 }, AHA)).toBe('urgent')
    expect(urgencyOf({ systolic: 185, diastolic: 95 }, AHA)).toBe('emergency')
    expect(urgencyOf({ systolic: 185, diastolic: 125 }, AHA)).toBe('emergency')
  })
})

describe('targets', () => {
  it('uses the home threshold, not the office one', () => {
    // 138/88 would be "normal-ish" against an office cutoff of 140/90 but is
    // above target for self-measurement under both standards.
    expect(classify({ systolic: 138, diastolic: 88 }, ESC).inTarget).toBe(false)
    expect(classify({ systolic: 134, diastolic: 84 }, ESC).inTarget).toBe(true)
    expect(classify({ systolic: 135, diastolic: 84 }, ESC).inTarget).toBe(false)
    expect(classify({ systolic: 134, diastolic: 85 }, ESC).inTarget).toBe(false)
  })

  it('applies AHA’s lower home threshold', () => {
    expect(classify({ systolic: 129, diastolic: 79 }, AHA).inTarget).toBe(true)
    expect(classify({ systolic: 130, diastolic: 79 }, AHA).inTarget).toBe(false)
  })

  it('honours a personal target override', () => {
    const target = { systolic: 125, diastolic: 75 }
    expect(classify({ systolic: 128, diastolic: 74 }, ESC).inTarget).toBe(true)
    expect(classify({ systolic: 128, diastolic: 74 }, ESC, target).inTarget).toBe(false)
  })

  it('flags low readings', () => {
    expect(classify({ systolic: 88, diastolic: 58 }, ESC).low).toBe(true)
    expect(classify({ systolic: 118, diastolic: 55 }, ESC).low).toBe(true)
    expect(classify({ systolic: 95, diastolic: 65 }, ESC).low).toBe(false)
  })
})

describe('switching standards', () => {
  // Chosen to straddle both thresholds: in target under ESC (135/85),
  // out of target under AHA (130/80).
  const sessions = [
    makeSession('2026-08-10T08:00', [[132, 82]]),
    makeSession('2026-08-11T08:00', [[128, 78]]),
    makeSession('2026-08-12T08:00', [[133, 83]]),
    makeSession('2026-08-13T08:00', [[145, 92]]),
  ]

  it('reclassifies the same readings differently', () => {
    expect(classify({ systolic: 132, diastolic: 82 }, ESC).band.label).toBe('High-normal')
    expect(classify({ systolic: 132, diastolic: 82 }, AHA).band.label).toBe('Stage 1')
  })

  it('changes percent-in-target for an unchanged history', () => {
    // Nothing about the sessions changed — only the yardstick.
    expect(percentInTarget(sessions, ESC)).toBe(75)
    expect(percentInTarget(sessions, AHA)).toBe(25)
  })

  it('never caches a category on the session', () => {
    for (const session of sessions) {
      expect(session).not.toHaveProperty('band')
      expect(session).not.toHaveProperty('category')
      expect(session).not.toHaveProperty('inTarget')
    }
  })
})

describe('standard registry', () => {
  it('resolves known ids', () => {
    expect(getStandard('esc')).toBe(ESC)
    expect(getStandard('aha')).toBe(AHA)
  })

  it('falls back rather than throwing on an unknown id', () => {
    expect(getStandard('nice')).toBe(getStandard(DEFAULT_STANDARD_ID))
    expect(getStandard(null)).toBe(ESC)
    expect(getStandard(undefined)).toBe(ESC)
  })

  it('orders every standard’s bands best to worst', () => {
    for (const standard of [ESC, AHA]) {
      const systolicFloors = standard.bands.map((b) => b.systolicFrom)
      const sorted = [...systolicFloors].sort((a, b) => a - b)
      expect(systolicFloors).toEqual(sorted)
    }
  })
})

describe('bandDistribution', () => {
  const sessions = [
    makeSession('2026-08-10T08:00', [[118, 76]]), // Optimal
    makeSession('2026-08-11T08:00', [[124, 82]]), // Normal
    makeSession('2026-08-12T08:00', [[132, 86]]), // High-normal
    makeSession('2026-08-13T08:00', [[145, 92]]), // Grade 1
  ]

  it('counts sittings per band, best to worst', () => {
    const dist = bandDistribution(sessions, ESC)
    expect(dist.map((d) => d.band.id)).toEqual(ESC.bands.map((b) => b.id))
    expect(dist.map((d) => d.count)).toEqual([1, 1, 1, 1, 0, 0])
    expect(dist.map((d) => d.pct)).toEqual([25, 25, 25, 25, 0, 0])
  })

  it('keeps empty bands in the list', () => {
    // "Nothing in Grade 3" is information; rows that appear and vanish are not.
    const dist = bandDistribution(sessions, ESC)
    expect(dist).toHaveLength(6)
    expect(dist.at(-1)?.count).toBe(0)
  })

  it('redistributes when the standard changes', () => {
    const esc = bandDistribution(sessions, ESC).map((d) => d.count)
    const aha = bandDistribution(sessions, AHA).map((d) => d.count)
    expect(aha).toHaveLength(5)
    expect(esc.slice(0, 5)).not.toEqual(aha)
  })

  it('is all-zero for no sittings rather than NaN', () => {
    const dist = bandDistribution([], ESC)
    expect(dist.every((d) => d.count === 0 && d.pct === 0)).toBe(true)
  })
})
