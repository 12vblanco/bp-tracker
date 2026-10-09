import { describe, it, expect } from 'vitest'
import { trendSeries } from './series'
import { makeSession } from './testing'

describe('trendSeries', () => {
  it('orders oldest first regardless of input order', () => {
    const points = trendSeries([
      makeSession('2026-08-12T08:00', [[140, 90]]),
      makeSession('2026-08-10T08:00', [[150, 95]]),
      makeSession('2026-08-11T08:00', [[145, 92]]),
    ])
    expect(points.map((p) => p.systolic)).toEqual([150, 145, 140])
  })

  it('withholds the mean until three readings are in the window', () => {
    const points = trendSeries([
      makeSession('2026-08-10T08:00', [[150, 95]]),
      makeSession('2026-08-11T08:00', [[140, 90]]),
      makeSession('2026-08-12T08:00', [[130, 80]]),
    ])
    expect(points[0]?.systolicMean).toBeNull()
    expect(points[1]?.systolicMean).toBeNull()
    expect(points[2]?.systolicMean).toBe(140)
  })

  it('trails rather than centres, so a point never moves later', () => {
    const sessions = [
      makeSession('2026-08-10T08:00', [[150, 95]]),
      makeSession('2026-08-11T08:00', [[150, 95]]),
      makeSession('2026-08-12T08:00', [[150, 95]]),
    ]
    const before = trendSeries(sessions)
    // A much lower reading arrives afterwards; earlier points must be untouched.
    const after = trendSeries([...sessions, makeSession('2026-08-13T08:00', [[110, 70]])])
    expect(after.slice(0, 3).map((p) => p.systolicMean)).toEqual(
      before.map((p) => p.systolicMean),
    )
  })

  it('drops readings that fall out of the window', () => {
    const points = trendSeries([
      // Three old readings, then three recent ones 30 days later.
      makeSession('2026-07-01T08:00', [[180, 110]]),
      makeSession('2026-07-02T08:00', [[180, 110]]),
      makeSession('2026-07-03T08:00', [[180, 110]]),
      makeSession('2026-08-10T08:00', [[120, 80]]),
      makeSession('2026-08-11T08:00', [[120, 80]]),
      makeSession('2026-08-12T08:00', [[120, 80]]),
    ])
    // The last point's mean must come only from the recent cluster.
    expect(points[5]?.systolicMean).toBe(120)
  })

  it('carries pulse through, nulls included', () => {
    const points = trendSeries([
      makeSession('2026-08-10T08:00', [{ systolic: 140, diastolic: 90, pulse: 72 }]),
      makeSession('2026-08-11T08:00', [[140, 90]]),
    ])
    expect(points[0]?.pulse).toBe(72)
    expect(points[1]?.pulse).toBeNull()
  })

  it('is empty for no sessions', () => {
    expect(trendSeries([])).toEqual([])
  })
})
