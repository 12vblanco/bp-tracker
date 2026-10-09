import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Session } from '../domain/types'
import type { BPDelta } from '../domain/averages'
import {
  periodSplit,
  sessionsInWindow,
  weeklySummaries,
  windowTrend,
  percentInTarget,
} from '../domain/averages'
import { bandDistribution, classify } from '../domain/classify'
import { trendSeries } from '../domain/series'
import {
  bodyChange,
  dailyBody,
  formatBodyDelta,
  formatNumber,
  hasBodyData,
  labelFor,
  latestBody,
  toDisplay,
  unitFor,
  type BodyChange,
  type BodyMeasure,
  type BodyReading,
} from '../domain/body'
import { tagComparisons } from '../domain/tags'
import { useProfile, useSessions } from '../data/hooks'
import { CategoryBadge } from '../components/CategoryBadge'
import { TrendChart, type Metric } from '../components/TrendChart'
import { formatDate, formatTime } from '../domain/format'
import type { GuidelineStandard } from '../domain/standards'

const RANGES = [
  { days: 14, label: '14d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 365, label: '1y' },
]

export function Dashboard() {
  const sessions = useSessions()
  const { standard, target } = useProfile()
  const [rangeDays, setRangeDays] = useState(90)
  const [metric, setMetric] = useState<Metric>('bp')

  // A single `now` for the whole render, so every card measures from the same
  // instant instead of drifting apart mid-paint.
  const now = useMemo(() => new Date(), [sessions])

  if (sessions === undefined) return <main className="page" />

  if (sessions.length === 0) {
    return (
      <main className="page">
        <div className="empty">
          <p>No readings yet.</p>
          <p className="faint">
            Averages and trends appear here once you have logged a few sittings.
          </p>
          <Link className="btn" to="/log">
            Log your first reading
          </Link>
        </div>
      </main>
    )
  }

  const inRange = sessionsInWindow(sessions, now, rangeDays)
  const trend = windowTrend(sessions, now, 7)
  const split = periodSplit(inRange)
  const weeks = weeklySummaries(inRange, standard, target)
  const insights = tagComparisons(inRange)
  const points = trendSeries(inRange)
  const bodyPoints = dailyBody(inRange)
  const rangePct = percentInTarget(inRange, standard, target)
  const distribution = bandDistribution(inRange, standard, target)
  const goal = target ?? standard.homeThreshold

  const latest = sessions[0]
  const latestBP = latest
    ? { systolic: latest.avgSystolic, diastolic: latest.avgDiastolic }
    : null
  const aboveTarget = inRange.filter(
    (s) =>
      !classify({ systolic: s.avgSystolic, diastolic: s.avgDiastolic }, standard, target)
        .inTarget,
  )
  // Naming the worst band that actually has sittings in it. Reporting a count
  // for the top bands instead read as a contradiction — "58 above threshold ·
  // none in the top bands" — because most of those 58 sit one band up, not five.
  const worstBand = [...distribution].reverse().find((d) => d.count > 0)?.band ?? null

  return (
    <main className="page">
      {/* The instrument panel: everything you opened the app to find, in one row. */}
      <div className="kpis">
        <Kpi
          label="7-day mean"
          value={trend.average ? `${trend.average.systolic}/${trend.average.diastolic}` : '—'}
          unit="mmHg"
          note={<DeltaNote delta={trend.delta} />}
        />
        <Kpi
          label="Latest sitting"
          value={latestBP ? `${latestBP.systolic}/${latestBP.diastolic}` : '—'}
          unit={latest ? formatTime(new Date(latest.takenAt), standard) : ''}
          note={
            latestBP ? (
              <CategoryBadge bp={latestBP} standard={standard} target={target} />
            ) : (
              'No sittings'
            )
          }
        />
        <Kpi
          label="In target"
          value={rangePct === null ? '—' : String(rangePct)}
          unit="%"
          note={`${inRange.length - aboveTarget.length} of ${inRange.length} sittings`}
        />
        <Kpi
          label="Morning mean"
          value={split.morning ? `${split.morning.systolic}/${split.morning.diastolic}` : '—'}
          unit="AM"
          note={`${split.morningCount} sittings`}
        />
        <Kpi
          label="Evening mean"
          value={split.evening ? `${split.evening.systolic}/${split.evening.diastolic}` : '—'}
          unit="PM"
          note={`${split.eveningCount} sittings`}
        />
        <Kpi
          label="Above threshold"
          value={String(aboveTarget.length)}
          unit="sittings"
          note={worstBand ? `worst band: ${worstBand.label}` : 'nothing recorded'}
          tone={aboveTarget.length > 0 ? 'neg' : undefined}
        />
      </div>

      <div className="filters no-print">
        <div className="segmented" role="group" aria-label="Date range">
          {RANGES.map((range) => (
            <button
              key={range.days}
              type="button"
              aria-pressed={rangeDays === range.days}
              onClick={() => setRangeDays(range.days)}
            >
              {range.label}
            </button>
          ))}
        </div>
        {/* Weight and waist appear only once there is something to plot. They are
            occasional measurements, and an empty button is a promise the chart
            cannot keep. Presence is judged across all history, not the visible
            range, so the control does not flicker as the range changes. */}
        <div className="segmented" role="group" aria-label="Measure">
          <button type="button" aria-pressed={metric === 'bp'} onClick={() => setMetric('bp')}>
            PRESSURE
          </button>
          <button
            type="button"
            aria-pressed={metric === 'pulse'}
            onClick={() => setMetric('pulse')}
          >
            PULSE
          </button>
          {hasBodyData(sessions, 'weightKg') && (
            <button
              type="button"
              aria-pressed={metric === 'weight'}
              onClick={() => setMetric('weight')}
            >
              WEIGHT
            </button>
          )}
          {hasBodyData(sessions, 'waistCm') && (
            <button
              type="button"
              aria-pressed={metric === 'waist'}
              onClick={() => setMetric('waist')}
            >
              WAIST
            </button>
          )}
        </div>
      </div>

      <div className="dashboard-main">
        <section className="card">
          <div className="card-title">
            {metric === 'bp'
              ? `7-day rolling mean · ${rangeDays} days · target ${goal.systolic}/${goal.diastolic}`
              : metric === 'pulse'
                ? `Pulse · ${rangeDays} days`
                : `${labelFor(metric === 'weight' ? 'weightKg' : 'waistCm')} · ${rangeDays} days`}
          </div>
          <TrendChart
            points={points}
            body={bodyPoints}
            standard={standard}
            target={target}
            metric={metric}
          />
        </section>

        <section className="card">
          <div className="card-title">Band distribution</div>
          <div className="faint" style={{ marginTop: -4 }}>
            {inRange.length} sittings · reclassified live
          </div>

          <div className="band-bar" role="img" aria-label="Share of sittings in each band">
            {distribution
              .filter((d) => d.count > 0)
              .map((d) => (
                <span
                  key={d.band.id}
                  style={{
                    width: `${d.pct}%`,
                    background: `var(--tone-${d.band.tone}-dot)`,
                  }}
                />
              ))}
          </div>

          <div className="band-rows">
            {distribution.map((d) => (
              <div className="band-row" key={d.band.id}>
                <span
                  className="band-swatch"
                  style={{ background: `var(--tone-${d.band.tone}-dot)` }}
                />
                <span>{d.band.label}</span>
                <span className="band-n">{d.count}</span>
                <span className="band-pct">{d.pct}%</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <Body sessions={sessions} inRange={inRange} rangeDays={rangeDays} standard={standard} />

      <section className="card">
        <div className="row-between" style={{ marginBottom: 10 }}>
          <div className="card-title" style={{ margin: 0 }}>
            Weekly averages
          </div>
          {rangePct !== null && <span className="faint mono">{rangePct}% in target</span>}
        </div>

        {weeks.length === 0 ? (
          <p className="faint">No readings in this range.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Week</th>
                  <th className="num">Average</th>
                  <th className="num">Sittings</th>
                  <th className="num">In target</th>
                  <th>Band</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((week) => (
                  <tr key={`${week.isoYear}-${week.isoWeek}`}>
                    <td>{week.label}</td>
                    <td className="num">
                      {week.average.systolic}/{week.average.diastolic}
                    </td>
                    <td className="num">{week.sessionCount}</td>
                    <td className="num">{week.inTargetPct}%</td>
                    <td>
                      <CategoryBadge bp={week.average} standard={standard} target={target} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {insights.length > 0 && (
        <section className="card">
          <div className="card-title">What goes with your readings</div>
          {insights.map((insight) => (
            <div className="insight" key={insight.tag}>
              <span>{insight.tag}</span>
              <span className="row" style={{ gap: 8 }}>
                <span className="faint mono">
                  {insight.withAverage.systolic}/{insight.withAverage.diastolic} vs{' '}
                  {insight.withoutAverage.systolic}/{insight.withoutAverage.diastolic}
                </span>
                <DeltaLabel delta={insight.delta} />
              </span>
            </div>
          ))}
          <p className="faint" style={{ marginTop: 10 }}>
            Only shown for tags with at least 5 sittings on each side. These are associations in
            your own notes, not causes — a tag can just as easily mark the kind of day that
            raised your pressure as the thing that raised it.
          </p>
        </section>
      )}

      <Consistency sessions={sessions} now={now} />

      <p className="disclaimer">
        Categories and targets follow {standard.name}, using the home-measurement threshold of{' '}
        {standard.homeThreshold.systolic}/{standard.homeThreshold.diastolic} rather than the
        higher clinic figure. This is a record to discuss with your doctor, not a diagnosis.
      </p>
    </main>
  )
}

function Kpi({
  label,
  value,
  unit,
  note,
  tone,
}: {
  label: string
  value: string
  unit?: string
  note?: React.ReactNode
  tone?: 'neg' | 'pos'
}) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        <strong style={tone ? { color: `var(--${tone})` } : undefined}>{value}</strong>
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>
      <div className="kpi-note">{note}</div>
    </div>
  )
}

/** Kept short deliberately — the KPI cell is ~200px and clips anything longer. */
function DeltaNote({ delta }: { delta: BPDelta | null }) {
  if (!delta) return <>No prior week</>
  if (delta.systolic === 0 && delta.diastolic === 0) return <>No change</>
  const sign = delta.systolic < 0 ? '−' : '+'
  return <>{`${sign}${Math.abs(delta.systolic)} vs last week`}</>
}

/**
 * Down is good for blood pressure, so green means falling everywhere — on the
 * weekly trend and on the tag insights alike.
 */
function DeltaLabel({ delta }: { delta: BPDelta | null }) {
  if (!delta) return <span className="faint">No earlier period to compare</span>
  if (delta.systolic === 0 && delta.diastolic === 0)
    return <span className="delta flat">No change</span>

  const direction =
    delta.systolic === 0
      ? delta.diastolic < 0
        ? 'down'
        : 'up'
      : delta.systolic < 0
        ? 'down'
        : 'up'

  return (
    <span className={`delta ${direction}`}>
      {direction === 'down' ? '↓' : '↑'} {Math.abs(delta.systolic)}/{Math.abs(delta.diastolic)}{' '}
      mmHg
    </span>
  )
}

/**
 * Weight and waist, when there are any.
 *
 * Deliberately unjudged. Down is good for blood pressure and the deltas are
 * coloured accordingly, but "down is good" is not true of body weight for
 * everyone who might use this — so these deltas carry a direction and a figure
 * and no colour at all. The app records what you measure.
 */
function Body({
  sessions,
  inRange,
  rangeDays,
  standard,
}: {
  sessions: Session[]
  inRange: Session[]
  rangeDays: number
  standard: GuidelineStandard
}) {
  // Latest comes from all history, not the visible range: "last weighed seven
  // weeks ago" is the useful answer, and a range filter would blank it instead.
  const latest = latestBody(sessions)
  if (!latest.weightKg && !latest.waistCm) return null

  return (
    <section className="card">
      <div className="card-title">Body measurements</div>
      <div className="grid-2">
        <BodyStat
          measure="weightKg"
          latest={latest.weightKg}
          change={bodyChange(inRange, 'weightKg')}
          rangeDays={rangeDays}
          standard={standard}
        />
        <BodyStat
          measure="waistCm"
          latest={latest.waistCm}
          change={bodyChange(inRange, 'waistCm')}
          rangeDays={rangeDays}
          standard={standard}
        />
      </div>
    </section>
  )
}

function BodyStat({
  measure,
  latest,
  change,
  rangeDays,
  standard,
}: {
  measure: BodyMeasure
  latest: BodyReading | null
  change: BodyChange | null
  rangeDays: number
  standard: GuidelineStandard
}) {
  if (!latest) return null

  return (
    <div>
      <div className="kpi-label">{labelFor(measure)}</div>
      <div className="bp-value bp-large">
        {formatNumber(toDisplay(latest.value, measure, standard))}{' '}
        <span className="bp-unit">{unitFor(measure, standard)}</span>
      </div>
      {/* The date is not a footnote. A figure from six weeks ago shown bare
          reads as today's, which is the one wrong conclusion available here. */}
      <div className="faint">as of {formatDate(new Date(latest.takenAt), standard)}</div>
      <div className="body-change">
        {change ? (
          <>
            <span className="delta flat">
              {change.delta === 0
                ? 'No change'
                : formatBodyDelta(change.delta, measure, standard)}
            </span>{' '}
            <span className="faint">
              over {rangeDays} days · {change.entryCount} days recorded
            </span>
          </>
        ) : (
          <span className="faint">
            Recorded once or less in the last {rangeDays} days — no change to show yet.
          </span>
        )}
      </div>
    </div>
  )
}

/** Plain count, no streaks. Missing a day is not a moral failure. */
function Consistency({ sessions, now }: { sessions: Session[]; now: Date }) {
  const last30 = sessionsInWindow(sessions, now, 30)
  const days = new Set(last30.map((s) => s.takenAt.slice(0, 10))).size

  return (
    <section className="card">
      <div className="card-title">Consistency</div>
      <p className="muted">
        {last30.length} sitting{last30.length === 1 ? '' : 's'} across {days} of the last 30
        days.
      </p>
    </section>
  )
}
