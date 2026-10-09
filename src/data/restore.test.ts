import { describe, it, expect } from 'vitest'
import { parseBackup, RestoreError } from './restore'
import { makeSession } from '../domain/testing'
import type { ExportBundle } from './repository'

/** A minimal valid session, overridable per case. */
function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a',
    userId: 'local',
    takenAt: '2026-08-10T08:00:00.000Z',
    period: 'morning',
    arm: 'left',
    readings: [{ systolic: 140, diastolic: 90, pulse: 70 }],
    avgSystolic: 140,
    avgDiastolic: 90,
    avgPulse: 70,
    tags: [],
    notes: null,
    weightKg: null,
    waistCm: null,
    updatedAt: '2026-08-10T08:05:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

const bundle = (sessions: unknown[], rest: Record<string, unknown> = {}) =>
  JSON.stringify({ exportedAt: '2026-09-01T10:00:00.000Z', sessions, ...rest })

describe('parseBackup — file level', () => {
  it('rejects something that is not JSON, naming the likely mistake', () => {
    expect(() => parseBackup('session_id,taken_at_utc\n1,2')).toThrow(RestoreError)
    expect(() => parseBackup('nope')).toThrow(/not JSON/)
  })

  it('rejects JSON that carries no session list', () => {
    expect(() => parseBackup('{"readings":[]}')).toThrow(/not a BP Tracker backup/)
    expect(() => parseBackup('[]')).toThrow(RestoreError)
  })

  it('accepts an empty but well-formed backup', () => {
    const parsed = parseBackup(bundle([]))
    expect(parsed.sessions).toEqual([])
    expect(parsed.rejected).toBe(0)
  })
})

describe('parseBackup — a bad row costs only that row', () => {
  it('keeps the good sittings and counts the unreadable ones', () => {
    const parsed = parseBackup(
      bundle([session({ id: 'a' }), { id: 'b' }, null, 'garbage', session({ id: 'c' })]),
    )
    expect(parsed.sessions.map((s) => s.id)).toEqual(['a', 'c'])
    expect(parsed.rejected).toBe(3)
  })

  it.each([
    ['no id', { id: null }],
    ['an unparseable timestamp', { takenAt: 'last Tuesday' }],
    ['no readings left', { readings: [] }],
    ['readings that are not a list', { readings: 'two of them' }],
  ])('rejects a sitting with %s', (_label, overrides) => {
    expect(parseBackup(bundle([session(overrides)])).sessions).toHaveLength(0)
  })

  it('drops an implausible reading but keeps the sitting it came from', () => {
    const parsed = parseBackup(
      bundle([
        session({
          readings: [
            { systolic: 140, diastolic: 90, pulse: null },
            { systolic: 7, diastolic: 90, pulse: null },
            { systolic: 1400, diastolic: 90, pulse: null },
            { systolic: 138.5, diastolic: 88, pulse: null },
          ],
        }),
      ]),
    )
    expect(parsed.sessions[0]!.readings).toEqual([
      { systolic: 140, diastolic: 90, pulse: null },
    ])
  })

  it('refuses a NaN or a string where a pressure belongs', () => {
    const parsed = parseBackup(
      bundle([session({ readings: [{ systolic: '140', diastolic: 90, pulse: null }] })]),
    )
    expect(parsed.sessions).toHaveLength(0)
  })
})

describe('parseBackup — derived values are recomputed, not trusted', () => {
  it('recomputes an average that disagrees with its readings', () => {
    const parsed = parseBackup(
      bundle([
        session({
          readings: [
            { systolic: 140, diastolic: 90, pulse: 70 },
            { systolic: 130, diastolic: 80, pulse: 60 },
          ],
          avgSystolic: 999,
          avgDiastolic: 999,
          avgPulse: 999,
        }),
      ]),
    )
    expect(parsed.sessions[0]).toMatchObject({
      avgSystolic: 135,
      avgDiastolic: 85,
      avgPulse: 65,
    })
  })

  it('is a no-op on an intact file', () => {
    const parsed = parseBackup(bundle([session()]))
    expect(parsed.sessions[0]).toMatchObject({
      avgSystolic: 140,
      avgDiastolic: 90,
      avgPulse: 70,
    })
  })
})

describe('parseBackup — fields added after a backup was written', () => {
  it('reads a pre-v2 row, which has no weight or waist at all', () => {
    const { weightKg, waistCm, ...old } = session()
    void weightKg
    void waistCm
    const parsed = parseBackup(bundle([old]))
    // null, not undefined: undefined is the one value a `=== null` check misses.
    expect(parsed.sessions[0]!.weightKg).toBeNull()
    expect(parsed.sessions[0]!.waistCm).toBeNull()
  })

  it('keeps a fractional weight, which is not an integer like a pressure is', () => {
    const parsed = parseBackup(bundle([session({ weightKg: 78.4, waistCm: 94.5 })]))
    expect(parsed.sessions[0]).toMatchObject({ weightKg: 78.4, waistCm: 94.5 })
  })

  it('dates an undated edit to the reading, never to now', () => {
    const { updatedAt, ...undated } = session()
    void updatedAt
    const parsed = parseBackup(bundle([undated]))
    expect(parsed.sessions[0]!.updatedAt).toBe('2026-08-10T08:00:00.000Z')
  })
})

describe('parseBackup — normalisation', () => {
  it('preserves a soft delete, so a deletion survives the round trip', () => {
    const parsed = parseBackup(bundle([session({ deletedAt: '2026-08-11T00:00:00.000Z' })]))
    expect(parsed.sessions[0]!.deletedAt).toBe('2026-08-11T00:00:00.000Z')
  })

  it('falls back to `other` for an unreadable period rather than losing the sitting', () => {
    const parsed = parseBackup(bundle([session({ period: 'lunchtime' })]))
    expect(parsed.sessions[0]!.period).toBe('other')
  })

  it('drops an arm it does not recognise', () => {
    expect(parseBackup(bundle([session({ arm: 'third' })])).sessions[0]!.arm).toBeNull()
  })

  it('keeps only string tags, de-duplicated and without blanks', () => {
    const parsed = parseBackup(
      bundle([session({ tags: ['caffeine', 'caffeine', '', '  ', 7, null, 'exercise'] })]),
    )
    expect(parsed.sessions[0]!.tags).toEqual(['caffeine', 'exercise'])
  })

  it('normalises a local timestamp to a UTC instant', () => {
    const parsed = parseBackup(bundle([session({ takenAt: '2026-08-10T08:00:00+02:00' })]))
    expect(parsed.sessions[0]!.takenAt).toBe('2026-08-10T06:00:00.000Z')
  })
})

describe('parseBackup — duplicate ids within one file', () => {
  it('keeps the most recently edited copy', () => {
    const parsed = parseBackup(
      bundle([
        session({ id: 'a', notes: 'older', updatedAt: '2026-08-10T08:00:00.000Z' }),
        session({ id: 'a', notes: 'newer', updatedAt: '2026-08-12T08:00:00.000Z' }),
      ]),
    )
    expect(parsed.sessions).toHaveLength(1)
    expect(parsed.sessions[0]!.notes).toBe('newer')
  })
})

describe('parseBackup — profile', () => {
  it('reads a profile back', () => {
    const parsed = parseBackup(
      bundle([], {
        profile: {
          standard: 'aha',
          targetSystolic: 125,
          targetDiastolic: 75,
          tags: ['caffeine'],
          timezone: 'Europe/Madrid',
          updatedAt: '2026-09-01T09:00:00.000Z',
        },
      }),
    )
    expect(parsed.profile).toMatchObject({
      standard: 'aha',
      targetSystolic: 125,
      targetDiastolic: 75,
      timezone: 'Europe/Madrid',
    })
  })

  it('degrades an unknown standard to the default instead of throwing', () => {
    const parsed = parseBackup(bundle([], { profile: { standard: 'nice' } }))
    expect(parsed.profile!.standard).toBe('esc')
  })

  it('drops half a target, matching the both-or-neither rule in Settings', () => {
    const parsed = parseBackup(bundle([], { profile: { targetSystolic: 125 } }))
    expect(parsed.profile).toMatchObject({ targetSystolic: null, targetDiastolic: null })
  })

  it('dates an undated profile to the epoch, so it loses to the live one', () => {
    const parsed = parseBackup(bundle([], { profile: { standard: 'aha' } }))
    expect(parsed.profile!.updatedAt).toBe('1970-01-01T00:00:00.000Z')
  })

  it('is null when the file has no profile', () => {
    expect(parseBackup(bundle([])).profile).toBeNull()
  })
})

/**
 * The contract that actually matters. Everything above tests the parser against
 * files it invents; this tests it against the shape `exportAll` really writes,
 * which is the only file a person will ever hand it. If the two drift, a backup
 * stops being restorable and nothing else in this suite would notice.
 */
describe('a real export round-trips', () => {
  it('survives the trip with nothing rejected and nothing altered', () => {
    const sessions = [
      makeSession('2026-08-10T08:00', [
        [140, 90],
        [138, 88],
      ]),
      makeSession('2026-08-11T21:30', [[128, 82]], {
        tags: ['caffeine', 'poor sleep'],
        notes: 'after a late coffee, "the good one"',
        arm: 'right',
        weightKg: 78.4,
        waistCm: 94,
      }),
    ]

    const bundle: ExportBundle = {
      exportedAt: '2026-09-01T10:00:00.000Z',
      profile: {
        userId: 'test-user',
        standard: 'aha',
        targetSystolic: 125,
        targetDiastolic: 75,
        tags: ['caffeine', 'poor sleep'],
        timezone: 'Europe/Madrid',
        updatedAt: '2026-09-01T09:00:00.000Z',
        syncState: 'clean',
      },
      sessions,
    }

    const parsed = parseBackup(JSON.stringify(bundle, null, 2))

    expect(parsed.rejected).toBe(0)
    expect(parsed.sessions).toHaveLength(2)
    expect(parsed.exportedAt).toBe('2026-09-01T10:00:00.000Z')
    expect(parsed.profile).toMatchObject({ standard: 'aha', targetSystolic: 125 })

    // Compared field by field against the originals, minus userId — which the
    // importer assigns from the live session rather than trusting the file.
    for (const original of sessions) {
      const restored = parsed.sessions.find((s) => s.id === original.id)
      const { userId, ...expected } = original
      void userId
      expect(restored).toEqual(expected)
    }
  })
})
