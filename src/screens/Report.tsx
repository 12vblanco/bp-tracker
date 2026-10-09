import { useMemo, useState } from 'react'
import { subDays } from 'date-fns'
import type { Session } from '../domain/types'
import type { GuidelineStandard } from '../domain/standards'
import {
  averageBP,
  averagePulse,
  periodSplit,
  percentInTarget,
  weeklySummaries,
} from '../domain/averages'
import {
  bodyChange,
  bodyEntries,
  dailyBody,
  formatBodyDelta,
  formatNumber,
  labelFor,
  toDisplay,
  unitFor,
  type BodyMeasure,
} from '../domain/body'
import { tagUsage } from '../domain/tags'
import { formatDate, formatDateShort, formatTime, toIsoDay } from '../domain/format'
import { useProfile, useSessions } from '../data/hooks'
import { CategoryBadge } from '../components/CategoryBadge'
import { sessionsToCsv, downloadFile } from '../data/export'

const PRESETS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
]

/**
 * The appointment page.
 *
 * Everything a doctor would ask for on one sheet, in the order they would ask:
 * what the average is, whether it is in range, how it moved, and then the raw
 * log to check any of it against.
 */
export function Report() {
  const sessions = useSessions()
  const { standard, target } = useProfile()
  const [days, setDays] = useState(90)

  const now = useMemo(() => new Date(), [sessions])
  const from = useMemo(() => subDays(now, days), [now, days])

  const inRange = useMemo(
    () => (sessions ?? []).filter((s) => new Date(s.takenAt) >= from),
    [sessions, from],
  )

  if (sessions === undefined) return <main className="page" />

  const average = averageBP(inRange)
  const pulse = averagePulse(inRange)
  const split = periodSplit(inRange)
  const weeks = weeklySummaries(inRange, standard, target)
  const pct = percentInTarget(inRange, standard, target)
  const tags = tagUsage(inRange)
  const goal = target ?? standard.homeThreshold

  const body = dailyBody(inRange)
  const ranked = [...inRange].sort((a, b) => b.avgSystolic - a.avgSystolic)
  const highest = ranked.slice(0, 5)
  const lowest = ranked.slice(-5).reverse()

  return (
    <main className="page">
      <div className="page-header">
        <h1>Report</h1>
        <div className="row no-print">
          <button className="btn btn-secondary" onClick={() => window.print()}>
            Print
          </button>
          <button
            className="btn btn-secondary"
            disabled={inRange.length === 0}
            onClick={() =>
              downloadFile(
                `blood-pressure-${toIsoDay(from)}-to-${toIsoDay(now)}.csv`,
                sessionsToCsv(inRange),
                'text/csv',
              )
            }
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="filters no-print">
        <div className="segmented" role="group" aria-label="Report period">
          {PRESETS.map((preset) => (
            <button
              key={preset.days}
              type="button"
              aria-pressed={days === preset.days}
              onClick={() => setDays(preset.days)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {inRange.length === 0 ? (
        <div className="empty">
          <p>No readings in this period.</p>
        </div>
      ) : (
        <>
          <section className="card">
            <div className="card-title">Summary</div>
            <p className="muted" style={{ marginBottom: 12 }}>
              {formatDate(from, standard)} – {formatDate(now, standard)} · {inRange.length}{' '}
              sittings · {inRange.reduce((n, s) => n + s.readings.length, 0)} readings
            </p>

            {average && (
              <div className="hero-top" style={{ marginBottom: 12 }}>
                <div>
                  <div className="bp-value bp-large">
                    {average.systolic}/{average.diastolic} <span className="bp-unit">mmHg</span>
                  </div>
                  <div className="faint">
                    Overall average{pulse !== null ? ` · ${pulse} bpm` : ''}
                  </div>
                </div>
                <CategoryBadge bp={average} standard={standard} target={target} />
              </div>
            )}

            <div className="table-scroll">
              <table>
                <tbody>
                  <tr>
                    <td>Readings in target</td>
                    <td className="num">{pct}%</td>
                  </tr>
                  <tr>
                    <td>Morning average</td>
                    <td className="num">
                      {split.morning
                        ? `${split.morning.systolic}/${split.morning.diastolic} (${split.morningCount})`
                        : '—'}
                    </td>
                  </tr>
                  <tr>
                    <td>Evening average</td>
                    <td className="num">
                      {split.evening
                        ? `${split.evening.systolic}/${split.evening.diastolic} (${split.eveningCount})`
                        : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Naming the standard is not a footnote: "78% in target" means two
                different things under ESC and AHA, and the reader cannot tell
                which without being told. */}
            <p className="faint" style={{ marginTop: 12 }}>
              Classified using {standard.name}. Target for home self-measurement is under{' '}
              {goal.systolic}/{goal.diastolic} mmHg
              {target ? ' (personal target set in the app)' : ''}. Source: {standard.source}.
            </p>
          </section>

          <section className="card">
            <div className="card-title">Weekly averages</div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Week</th>
                    <th className="num">Average</th>
                    <th className="num">Pulse</th>
                    <th className="num">Sittings</th>
                    <th className="num">In target</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week) => (
                    <tr key={`${week.isoYear}-${week.isoWeek}`}>
                      <td>{week.label}</td>
                      <td className="num">
                        {week.average.systolic}/{week.average.diastolic}
                      </td>
                      <td className="num">{week.pulse ?? '—'}</td>
                      <td className="num">{week.sessionCount}</td>
                      <td className="num">{week.inTargetPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {body.length > 0 && (
            <section className="card">
              <div className="card-title">Body measurements</div>
              <div className="grid-2" style={{ marginBottom: 12 }}>
                <BodySummary measure="weightKg" sessions={inRange} standard={standard} />
                <BodySummary measure="waistCm" sessions={inRange} standard={standard} />
              </div>

              {/* Every measurement, not a weekly mean. These are taken every so
                  often, so there is nothing to smooth — and a clinician reading
                  a weight trend wants the dates it was actually taken on. */}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="num">Weight ({unitFor('weightKg', standard)})</th>
                      <th className="num">Waist ({unitFor('waistCm', standard)})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...body].reverse().map((entry) => (
                      <tr key={entry.day}>
                        <td>{formatDate(new Date(`${entry.day}T12:00:00`), standard)}</td>
                        <td className="num">
                          {entry.weightKg === null
                            ? '—'
                            : formatNumber(toDisplay(entry.weightKg, 'weightKg', standard))}
                        </td>
                        <td className="num">
                          {entry.waistCm === null
                            ? '—'
                            : formatNumber(toDisplay(entry.waistCm, 'waistCm', standard))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="grid-2">
            <ExtremeCard title="Highest readings" sessions={highest} standard={standard} />
            <ExtremeCard title="Lowest readings" sessions={lowest} standard={standard} />
          </div>

          {tags.length > 0 && (
            <section className="card">
              <div className="card-title">Context recorded</div>
              <div className="table-scroll">
                <table>
                  <tbody>
                    {tags.map((entry) => (
                      <tr key={entry.tag}>
                        <td>{entry.tag}</td>
                        <td className="num">{entry.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="card">
            <div className="card-title">Full log</div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Time</th>
                    <th>When</th>
                    <th className="num">Average</th>
                    <th className="num">Readings</th>
                    <th className="num">Pulse</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {inRange.map((session) => (
                    <tr key={session.id}>
                      <td>{formatDate(new Date(session.takenAt), standard)}</td>
                      <td>{formatTime(new Date(session.takenAt), standard)}</td>
                      <td>{session.period === 'other' ? '—' : session.period}</td>
                      <td className="num">
                        {session.avgSystolic}/{session.avgDiastolic}
                      </td>
                      <td className="num">
                        {session.readings.map((r) => `${r.systolic}/${r.diastolic}`).join('  ')}
                      </td>
                      <td className="num">{session.avgPulse ?? '—'}</td>
                      <td style={{ whiteSpace: 'normal' }}>
                        {[session.tags.join(', '), session.notes].filter(Boolean).join(' — ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <p className="disclaimer">
        Self-measured readings recorded at home by the patient. Not a clinical measurement and
        not a diagnosis. Generated {formatDate(now, standard)}.
      </p>
    </main>
  )
}

/**
 * First, last, and the difference across the report period. Unjudged for the
 * same reason as on the dashboard: which direction is good depends on the person,
 * and that is a conversation for the appointment, not a colour on a page.
 */
function BodySummary({
  measure,
  sessions,
  standard,
}: {
  measure: BodyMeasure
  sessions: Session[]
  standard: GuidelineStandard
}) {
  const entries = bodyEntries(sessions, measure)
  const change = bodyChange(sessions, measure)
  const last = entries[entries.length - 1]
  if (!last) return null

  const unit = unitFor(measure, standard)

  return (
    <div>
      <div className="card-title" style={{ marginBottom: 4 }}>
        {labelFor(measure)}
      </div>
      <div className="bp-value bp-large">
        {formatNumber(toDisplay(last[measure]!, measure, standard))}{' '}
        <span className="bp-unit">{unit}</span>
      </div>
      <div className="faint">
        {change
          ? `${formatNumber(toDisplay(change.first, measure, standard))} → ${formatNumber(
              toDisplay(change.last, measure, standard),
            )} ${unit} · ${
              change.delta === 0
                ? 'no change'
                : formatBodyDelta(change.delta, measure, standard)
            }`
          : 'Recorded once in this period'}{' '}
        · {entries.length} day{entries.length === 1 ? '' : 's'} recorded
      </div>
    </div>
  )
}

function ExtremeCard({
  title,
  sessions,
  standard,
}: {
  title: string
  sessions: Session[]
  standard: GuidelineStandard
}) {
  return (
    <section className="card">
      <div className="card-title">{title}</div>
      <div className="table-scroll">
        <table>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td>{formatDateShort(new Date(session.takenAt), standard)}</td>
                <td className="num">
                  {session.avgSystolic}/{session.avgDiastolic}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
