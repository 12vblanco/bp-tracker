import { describe, it, expect } from 'vitest'
import { sessionsToCsv } from './export'
import { makeSession } from '../domain/testing'

describe('sessionsToCsv', () => {
  it('writes one row per reading, not per sitting', () => {
    const csv = sessionsToCsv([
      makeSession('2026-08-10T08:00', [
        [140, 90],
        [138, 88],
        [136, 86],
      ]),
    ])
    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(4) // header + 3 readings
    expect(lines[1]).toContain('140,90')
    expect(lines[3]).toContain('136,86')
  })

  it('writes body measurements in metric whatever the display unit is', () => {
    const csv = sessionsToCsv([
      makeSession('2026-08-10T08:00', [[140, 90]], { weightKg: 78.4, waistCm: 94 }),
    ])
    const [header, row] = csv.split('\r\n')
    expect(header).toContain('weight_kg,waist_cm')
    expect(row).toContain('78.4,94')
  })

  it('leaves the body columns empty on a sitting that measured neither', () => {
    const csv = sessionsToCsv([makeSession('2026-08-10T08:00', [[140, 90]])])
    const columns = csv.split('\r\n')[1]!.split(',')
    const header = csv.split('\r\n')[0]!.split(',')
    expect(columns[header.indexOf('weight_kg')]).toBe('')
    expect(columns[header.indexOf('waist_cm')]).toBe('')
  })

  it('carries the session average onto every row so grouping survives', () => {
    const csv = sessionsToCsv([
      makeSession('2026-08-10T08:00', [
        [140, 90],
        [136, 86],
      ]),
    ])
    const [, first, second] = csv.split('\r\n')
    expect(first).toContain('138,88')
    expect(second).toContain('138,88')
  })

  it('orders oldest first, unlike the app’s list', () => {
    const csv = sessionsToCsv([
      makeSession('2026-08-12T08:00', [[130, 80]]),
      makeSession('2026-08-10T08:00', [[150, 95]]),
    ])
    const lines = csv.split('\r\n')
    expect(lines[1]).toContain('2026-08-10')
    expect(lines[2]).toContain('2026-08-12')
  })

  it('quotes and escapes free text that would break the row', () => {
    const csv = sessionsToCsv([
      makeSession('2026-08-10T08:00', [[140, 90]], {
        notes: 'Felt dizzy, then "fine", after a walk',
        tags: ['caffeine', 'stressed'],
      }),
    ])
    expect(csv).toContain('"Felt dizzy, then ""fine"", after a walk"')
    // Tags are semicolon-joined so they stay in one cell without quoting.
    expect(csv).toContain('caffeine; stressed')
  })

  it('leaves a missing pulse empty rather than writing null', () => {
    const csv = sessionsToCsv([makeSession('2026-08-10T08:00', [[140, 90]])])
    const cells = csv.split('\r\n')[1]?.split(',') ?? []
    expect(cells[8]).toBe('')
    expect(csv).not.toContain('null')
  })

  it('emits only a header for no sessions', () => {
    expect(sessionsToCsv([]).split('\r\n')).toHaveLength(1)
  })
})
