import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { BP } from '../domain/types'
import type { GuidelineStandard } from '../domain/standards'
import type { SeriesPoint } from '../domain/series'
import type { BodyEntry, BodyMeasure } from '../domain/body'
import { formatNumber, labelFor, toDisplay, unitFor } from '../domain/body'
import { formatDateShort, formatDateTime } from '../domain/format'

export type Metric = 'bp' | 'pulse' | 'weight' | 'waist'

/** The two metrics that come from body measurements rather than from a cuff. */
const BODY_MEASURE: Partial<Record<Metric, BodyMeasure>> = {
  weight: 'weightKg',
  waist: 'waistCm',
}

/**
 * Recharts pins `data` to a single row shape, and the body series genuinely has
 * a different one. Widening to "a point in time, plus whatever keys the active
 * metric's <Line> names" keeps that honest without a cast.
 */
type ChartRow = Partial<SeriesPoint> & { t: number; value?: number }

interface Props {
  points: SeriesPoint[]
  /** Daily body measurements, already windowed by the caller. */
  body: BodyEntry[]
  standard: GuidelineStandard
  target: BP | null
  metric: Metric
}

/**
 * Blood pressure over time.
 *
 * Systolic and diastolic share one y-axis because they are the same measure in
 * the same unit. Pulse is a *different* measure, so it gets its own chart via
 * the metric switch rather than a second axis — a dual-scale chart lets the
 * reader infer a relationship from crossing lines that the data never claimed.
 *
 * Solid lines are the sittings you actually recorded; dashed lines are the
 * trailing 7-day mean in the same hue, so identity stays with the entity and
 * dash pattern carries raw-versus-smoothed.
 *
 * Weight and waist are their own metrics for the same reason pulse is: a second
 * y-axis invites the reader to see a relationship in two crossing lines that the
 * data never claimed. They are also drawn *with* their markers — they are taken
 * every so often, and a bare line would imply daily measurements that a
 * once-a-fortnight tape measure never produced.
 */
export function TrendChart({ points, body, standard, target, metric }: Props) {
  const goal = target ?? standard.homeThreshold
  const measure = BODY_MEASURE[metric]

  const bodyPoints = useMemo<ChartRow[]>(() => {
    if (!measure) return []
    return body
      .filter((entry) => entry[measure] !== null)
      .map((entry) => ({ t: entry.t, value: toDisplay(entry[measure]!, measure, standard) }))
  }, [body, measure, standard])

  const domain = useMemo(() => {
    if (measure) {
      const values = bodyPoints.map((p) => p.value).filter((v): v is number => v !== undefined)
      if (values.length === 0) return [0, 1] as [number, number]

      // Body figures move by a few units over months, not by tens, so the
      // 10-unit rounding the pressure axis uses would flatten a real four-kilo
      // loss into a straight line. Pad proportionally instead, with a floor so a
      // single measurement still gets a readable axis.
      const min = Math.min(...values)
      const max = Math.max(...values)
      const pad = Math.max(1, (max - min) * 0.2)
      return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)] as [number, number]
    }

    if (points.length === 0) return [60, 160] as [number, number]

    const values =
      metric === 'pulse'
        ? points.map((p) => p.pulse).filter((v): v is number => v !== null)
        : points.flatMap((p) => [p.systolic, p.diastolic])

    if (values.length === 0) return [50, 110] as [number, number]

    // The target lines must stay on screen even in a very good or very bad
    // stretch, otherwise the reader loses their reference point.
    const candidates = metric === 'pulse' ? values : [...values, goal.systolic, goal.diastolic]

    const low = Math.floor((Math.min(...candidates) - 8) / 10) * 10
    const high = Math.ceil((Math.max(...candidates) + 8) / 10) * 10
    return [Math.max(0, low), high] as [number, number]
  }, [points, metric, goal, measure, bodyPoints])

  const hasPulse = points.some((p) => p.pulse !== null)

  if (measure && bodyPoints.length === 0) {
    return <p className="faint">No {labelFor(measure).toLowerCase()} recorded in this range.</p>
  }

  if (!measure && points.length === 0) {
    return <p className="faint">No readings in this range yet.</p>
  }

  if (metric === 'pulse' && !hasPulse) {
    return <p className="faint">No pulse recorded in this range.</p>
  }

  return (
    <div className="viz">
      <ResponsiveContainer width="100%" height={260}>
        <LineChart
          data={measure ? bodyPoints : (points as ChartRow[])}
          margin={{ top: 8, right: 12, bottom: 4, left: -18 }}
        >
          {/* Hairline, solid, horizontal only — recessive chrome, never dashed. */}
          <CartesianGrid stroke="var(--viz-grid)" strokeWidth={1} vertical={false} />

          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(t: number) => formatDateShort(new Date(t), standard)}
            tick={{ fill: 'var(--viz-axis)', fontSize: 11 }}
            stroke="var(--viz-grid)"
            minTickGap={44}
            tickMargin={8}
          />

          <YAxis
            domain={domain}
            tick={{ fill: 'var(--viz-axis)', fontSize: 11 }}
            stroke="var(--viz-grid)"
            width={52}
            tickMargin={4}
          />

          {metric === 'bp' && (
            <>
              {/* Chrome, not data: muted ink, so these never read as a third and
                  fourth series. Named in the legend rather than labelled inline —
                  an inline label has nowhere to sit that a 90-day line does not
                  already occupy, and a clipped "Targe…85" is worse than none. */}
              <ReferenceLine
                y={goal.systolic}
                stroke="var(--viz-axis)"
                strokeDasharray="5 4"
                strokeWidth={1}
              />
              <ReferenceLine
                y={goal.diastolic}
                stroke="var(--viz-axis)"
                strokeDasharray="5 4"
                strokeWidth={1}
              />
            </>
          )}

          <Tooltip
            content={<TrendTooltip metric={metric} standard={standard} measure={measure} />}
            cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
          />

          {measure ? (
            <Line
              name={labelFor(measure)}
              dataKey="value"
              stroke="var(--series-1)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={{ r: 2.5, strokeWidth: 0, fill: 'var(--series-1)' }}
              activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }}
              isAnimationActive={false}
            />
          ) : metric === 'bp' ? (
            <>
              {/* Individual sittings sit *behind* the average, thin and faint.
                  Day-to-day pressure swings 10–15 mmHg for no discoverable
                  reason, so at full weight the raw line is a hairball that buries
                  the trend it is supposed to support. Weight carries
                  signal-versus-noise; hue still carries identity. */}
              <Line
                name="Systolic"
                dataKey="systolic"
                stroke="var(--series-1)"
                strokeWidth={1}
                strokeOpacity={0.3}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }}
                isAnimationActive={false}
              />
              <Line
                name="Diastolic"
                dataKey="diastolic"
                stroke="var(--series-2)"
                strokeWidth={1}
                strokeOpacity={0.3}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }}
                isAnimationActive={false}
              />
              <Line
                name="Systolic 7-day"
                dataKey="systolicMean"
                stroke="var(--series-1)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                name="Diastolic 7-day"
                dataKey="diastolicMean"
                stroke="var(--series-2)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            </>
          ) : (
            <Line
              name="Pulse"
              dataKey="pulse"
              stroke="var(--series-1)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>

      {/* Always present for two or more series, so identity is never colour
          alone. A single-series pulse chart is named by the heading instead. */}
      {metric === 'bp' && (
        <ul className="legend">
          <li>
            <span className="legend-key" style={{ background: 'var(--series-1)' }} />
            Systolic
          </li>
          <li>
            <span className="legend-key" style={{ background: 'var(--series-2)' }} />
            Diastolic
          </li>
          <li>
            <span className="legend-key legend-key-faint" />
            Faint: each sitting
          </li>
          <li>
            <span className="legend-key legend-key-dashed" />
            Target {goal.systolic}/{goal.diastolic}
          </li>
        </ul>
      )}
    </div>
  )
}

interface TooltipProps {
  active?: boolean
  label?: number
  payload?: { name?: string; dataKey?: string; value?: number; stroke?: string }[]
  metric: Metric
  standard: GuidelineStandard
  measure?: BodyMeasure
}

/**
 * One tooltip listing every series at that x, so the pointer never has to land
 * on a line to get a number. The value leads and the series name follows: the
 * reader already knows which series they are looking at and wants the figure.
 */
function TrendTooltip({ active, label, payload, metric, standard, measure }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  const rows = payload.filter((row) => typeof row.value === 'number')
  if (rows.length === 0) return null

  const unit = measure ? unitFor(measure, standard) : metric === 'pulse' ? 'bpm' : 'mmHg'

  return (
    <div className="viz-tooltip">
      <div className="viz-tooltip-date">
        {label !== undefined ? formatDateTime(new Date(label), standard) : ''}
      </div>
      {rows.map((row) => (
        <div className="viz-tooltip-row" key={row.dataKey}>
          <span
            className="legend-key"
            style={{
              background: row.stroke,
              // Same hue, lighter weight — matching how the raw sittings are
              // drawn in the plot itself.
              opacity: row.dataKey?.endsWith('Mean') ? 1 : 0.4,
            }}
          />
          <strong>
            {measure ? formatNumber(row.value!) : row.value}
            <span className="bp-unit"> {unit}</span>
          </strong>
          <span className="viz-tooltip-name">{row.name}</span>
        </div>
      ))}
    </div>
  )
}
