import { describe, it, expect } from 'vitest'
import { fromProfileRow, fromSessionRow, toProfileRow, toSessionRow } from './rows'
import type { ProfileRow, SessionRow } from './rows'
import { makeSession } from '../domain/testing'
import type { ProfileRecord } from './db'

describe('session round trip', () => {
  it('survives the trip to the server and back unchanged', () => {
    const session = makeSession(
      '2026-08-10T08:00',
      [
        [140, 90],
        [138, 88],
      ],
      {
        arm: 'right',
        tags: ['caffeine'],
        notes: 'after a late coffee',
        weightKg: 78.4,
        waistCm: 94,
      },
    )
    expect(fromSessionRow(toSessionRow(session))).toEqual(session)
  })

  it('carries a soft delete across, so a deletion propagates', () => {
    const session = makeSession('2026-08-10T08:00', [[140, 90]], {
      deletedAt: '2026-08-11T00:00:00.000Z',
    })
    expect(fromSessionRow(toSessionRow(session)).deletedAt).toBe('2026-08-11T00:00:00.000Z')
  })

  it('never carries syncState, which is this device’s business alone', () => {
    const row = toSessionRow(makeSession('2026-08-10T08:00', [[140, 90]]))
    expect(row).not.toHaveProperty('syncState')
    expect(Object.keys(row)).not.toContain('sync_state')
  })
})

describe('reading rows the server actually returns', () => {
  const base: SessionRow = {
    id: 'a',
    user_id: 'u',
    taken_at: '2026-08-10T06:00:00.000Z',
    period: 'morning',
    arm: null,
    readings: [{ systolic: 140, diastolic: 90, pulse: null }],
    avg_systolic: 140,
    avg_diastolic: 90,
    avg_pulse: null,
    tags: [],
    notes: null,
    weight_kg: null,
    waist_cm: null,
    updated_at: '2026-08-10T06:00:00.000Z',
    deleted_at: null,
  }

  it('coerces numerics that arrive as strings', () => {
    // Postgres `numeric` comes back as a string once it is wide enough, and a
    // string systolic would poison every average downstream.
    const row = { ...base, avg_systolic: '140', avg_diastolic: '90.5', weight_kg: '78.4' }
    const session = fromSessionRow(row as unknown as SessionRow)
    expect(session.avgSystolic).toBe(140)
    expect(session.avgDiastolic).toBe(90.5)
    expect(session.weightKg).toBe(78.4)
  })

  it('turns an absent column into null, never undefined', () => {
    const { weight_kg, waist_cm, ...narrowed } = base
    void weight_kg
    void waist_cm
    const session = fromSessionRow(narrowed as SessionRow)
    expect(session.weightKg).toBeNull()
    expect(session.waistCm).toBeNull()
  })

  it('tolerates null tags and readings rather than throwing', () => {
    const row = { ...base, tags: null, readings: null }
    const session = fromSessionRow(row as unknown as SessionRow)
    expect(session.tags).toEqual([])
    expect(session.readings).toEqual([])
  })
})

describe('profile round trip', () => {
  const profile: ProfileRecord = {
    userId: 'u',
    standard: 'aha',
    targetSystolic: 125,
    targetDiastolic: 75,
    tags: ['caffeine'],
    timezone: 'Europe/Madrid',
    updatedAt: '2026-09-01T09:00:00.000Z',
    syncState: 'clean',
  }

  it('keeps everything but syncState', () => {
    const { syncState, ...expected } = profile
    void syncState
    expect(fromProfileRow(toProfileRow(profile))).toEqual(expected)
    expect(toProfileRow(profile)).not.toHaveProperty('syncState')
  })

  it('degrades an unknown standard instead of throwing', () => {
    const row = { ...toProfileRow(profile), standard: 'nice' }
    expect(fromProfileRow(row).standard).toBe('esc')
  })

  it('drops half a target, matching the both-or-neither rule', () => {
    const row: ProfileRow = { ...toProfileRow(profile), target_diastolic: null }
    expect(fromProfileRow(row)).toMatchObject({ targetSystolic: null, targetDiastolic: null })
  })
})
