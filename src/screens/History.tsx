import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { isToday, isYesterday } from 'date-fns'
import type { Session } from '../domain/types'
import type { GuidelineStandard } from '../domain/standards'
import { classify } from '../domain/classify'
import { formatDayFull, formatTime } from '../domain/format'
import { formatBody } from '../domain/body'
import { useProfile, useSessions } from '../data/hooks'
import { CategoryBadge } from '../components/CategoryBadge'

export function History() {
  const sessions = useSessions()
  const { standard, target, profile } = useProfile()

  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [bandFilter, setBandFilter] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (!sessions) return []
    return sessions.filter((session) => {
      if (tagFilter && !session.tags.includes(tagFilter)) return false
      if (bandFilter) {
        const { band } = classify(
          { systolic: session.avgSystolic, diastolic: session.avgDiastolic },
          standard,
          target,
        )
        if (band.id !== bandFilter) return false
      }
      return true
    })
  }, [sessions, tagFilter, bandFilter, standard, target])

  // Grouped by calendar day. The list is already newest-first, so insertion
  // order into the Map is the display order.
  const days = useMemo(() => {
    const groups = new Map<string, Session[]>()
    for (const session of filtered) {
      const key = session.takenAt.slice(0, 10)
      const group = groups.get(key)
      if (group) group.push(session)
      else groups.set(key, [session])
    }
    return [...groups.entries()]
  }, [filtered])

  if (sessions === undefined) return <main className="page" />

  return (
    <main className="page">
      <div className="page-header">
        <h1>History</h1>
        <p>
          {filtered.length} of {sessions.length} sitting{sessions.length === 1 ? '' : 's'}
        </p>
      </div>

      {sessions.length === 0 ? (
        <div className="empty">
          <p>Nothing logged yet.</p>
          <Link className="btn" to="/log">
            Log a reading
          </Link>
        </div>
      ) : (
        <>
          <div className="filters">
            <div className="segmented" role="group" aria-label="Category filter">
              <button
                type="button"
                aria-pressed={bandFilter === null}
                onClick={() => setBandFilter(null)}
              >
                All
              </button>
              {standard.bands.map((band) => (
                <button
                  key={band.id}
                  type="button"
                  aria-pressed={bandFilter === band.id}
                  onClick={() => setBandFilter(bandFilter === band.id ? null : band.id)}
                >
                  {band.label}
                </button>
              ))}
            </div>
          </div>

          {(profile?.tags?.length ?? 0) > 0 && (
            <div className="chips">
              {profile?.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="chip"
                  aria-pressed={tagFilter === tag}
                  onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}

          {days.length === 0 ? (
            <div className="empty">
              <p>Nothing matches those filters.</p>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setTagFilter(null)
                  setBandFilter(null)
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            days.map(([day, group]) => (
              <div className="day-group" key={day}>
                <div className="day-heading">{dayLabel(day, standard)}</div>
                {/* The row is a container, not a button: the badge is itself
                    interactive (it explains the grade on hover and focus), and
                    a button inside a button is invalid HTML that React rejects.
                    A stretched link keeps the whole row clickable while leaving
                    the badge above it in the stacking order. */}
                {group.map((session) => (
                  <div key={session.id} className="entry">
                    <div className="entry-main">
                      <Link className="entry-link" to={`/log/${session.id}`}>
                        <span className="bp-value" style={{ fontSize: '1.25rem' }}>
                          {session.avgSystolic}/{session.avgDiastolic}{' '}
                          <span className="bp-unit">
                            mmHg
                            {session.avgPulse !== null ? ` · ${session.avgPulse} bpm` : ''}
                          </span>
                        </span>
                      </Link>
                      <div className="entry-tags">
                        {session.readings.length} reading
                        {session.readings.length === 1 ? '' : 's'}
                        {session.arm ? ` · ${session.arm} arm` : ''}
                        {/* A weight carries its own unit, so it needs no label.
                            A bare circumference does not. */}
                        {session.weightKg !== null
                          ? ` · ${formatBody(session.weightKg, 'weightKg', standard)}`
                          : ''}
                        {session.waistCm !== null
                          ? ` · waist ${formatBody(session.waistCm, 'waistCm', standard)}`
                          : ''}
                        {session.tags.length > 0 ? ` · ${session.tags.join(', ')}` : ''}
                      </div>
                    </div>
                    <CategoryBadge
                      bp={{ systolic: session.avgSystolic, diastolic: session.avgDiastolic }}
                      standard={standard}
                      target={target}
                    />
                    <span className="entry-time">
                      {formatTime(new Date(session.takenAt), standard)}
                    </span>
                  </div>
                ))}
              </div>
            ))
          )}
        </>
      )}
    </main>
  )
}

function dayLabel(isoDay: string, standard: GuidelineStandard): string {
  // Midday avoids any chance of a timezone shift moving the label to the
  // neighbouring day.
  const date = new Date(`${isoDay}T12:00:00`)
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return formatDayFull(date, standard)
}
