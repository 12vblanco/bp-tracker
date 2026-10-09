import { describe, it, expect } from 'vitest'
import { tagComparisons, tagUsage } from './tags'
import { makeSession } from './testing'

function tagged(day: number, bp: [number, number], tags: string[]) {
  return makeSession(`2026-08-${String(day).padStart(2, '0')}T08:00`, [bp], { tags })
}

describe('tagComparisons', () => {
  // Six tagged at 150/95, six untagged at 138/86.
  const sessions = [
    ...[1, 2, 3, 4, 5, 6].map((d) => tagged(d, [150, 95], ['caffeine'])),
    ...[7, 8, 9, 10, 11, 12].map((d) => tagged(d, [138, 86], [])),
  ]

  it('compares tagged against untagged', () => {
    const [comparison] = tagComparisons(sessions)
    expect(comparison?.tag).toBe('caffeine')
    expect(comparison?.withAverage).toEqual({ systolic: 150, diastolic: 95 })
    expect(comparison?.withoutAverage).toEqual({ systolic: 138, diastolic: 86 })
    expect(comparison?.delta).toEqual({ systolic: 12, diastolic: 9 })
    expect(comparison?.withCount).toBe(6)
    expect(comparison?.withoutCount).toBe(6)
  })

  it('suppresses a tag with too few tagged sessions', () => {
    // Four is under the floor of five: a real effect and a coincidence look
    // identical at this sample size, so neither gets shown.
    const thin = [
      ...[1, 2, 3, 4].map((d) => tagged(d, [160, 100], ['alcohol'])),
      ...[5, 6, 7, 8, 9, 10].map((d) => tagged(d, [130, 80], [])),
    ]
    expect(tagComparisons(thin)).toEqual([])
  })

  it('suppresses a tag with too few untagged sessions', () => {
    const thin = [
      ...[1, 2, 3, 4, 5, 6].map((d) => tagged(d, [150, 95], ['meds taken'])),
      ...[7, 8].map((d) => tagged(d, [130, 80], [])),
    ]
    expect(tagComparisons(thin)).toEqual([])
  })

  it('respects a custom sample floor', () => {
    const thin = [
      ...[1, 2].map((d) => tagged(d, [150, 95], ['exercise'])),
      ...[3, 4].map((d) => tagged(d, [130, 80], [])),
    ]
    expect(tagComparisons(thin, 5)).toEqual([])
    expect(tagComparisons(thin, 2)).toHaveLength(1)
  })

  it('ranks by the largest systolic effect in either direction', () => {
    const mixed = [
      ...[1, 2, 3, 4, 5].map((d) => tagged(d, [160, 100], ['stressed', 'poor sleep'])),
      ...[6, 7, 8, 9, 10].map((d) => tagged(d, [150, 95], ['poor sleep'])),
      ...[11, 12, 13, 14, 15].map((d) => tagged(d, [130, 80], [])),
    ]
    const ranked = tagComparisons(mixed)
    const magnitudes = ranked.map((c) => Math.abs(c.delta.systolic))
    expect(magnitudes).toEqual([...magnitudes].sort((a, b) => b - a))
  })
})

describe('tagUsage', () => {
  it('counts uses, most-used first', () => {
    const sessions = [
      tagged(1, [140, 90], ['meds taken', 'caffeine']),
      tagged(2, [140, 90], ['meds taken']),
      tagged(3, [140, 90], ['meds taken', 'stressed']),
    ]
    expect(tagUsage(sessions)).toEqual([
      { tag: 'meds taken', count: 3 },
      { tag: 'caffeine', count: 1 },
      { tag: 'stressed', count: 1 },
    ])
  })
})
