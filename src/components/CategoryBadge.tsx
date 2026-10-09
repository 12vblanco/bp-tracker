import { useId } from 'react'
import type { BP } from '../domain/types'
import type { GuidelineStandard } from '../domain/standards'
import { bandRange, classify } from '../domain/classify'

interface Props {
  bp: BP
  standard: GuidelineStandard
  target?: BP | null
}

/**
 * Classification is computed here, at render time, from the standard passed in.
 * Nothing is read from the session record — that is what lets switching
 * standards relabel every reading you have ever taken.
 *
 * The label always accompanies the colour: on a screen about a red/green health
 * judgement, colour alone would exclude anyone who cannot separate the two.
 *
 * A category name like "Grade 1" or "Elevated" means nothing on its own, so the
 * badge explains itself on hover, on keyboard focus, and on tap — a `button`
 * rather than a `span` precisely so all three work without extra handlers.
 */
export function CategoryBadge({ bp, standard, target }: Props) {
  const { band, severity } = classify(bp, standard, target)
  const range = bandRange(standard, severity)
  const tooltipId = useId()

  const numbers = [
    range.systolic && `${range.systolic} systolic`,
    range.diastolic && `${range.diastolic} diastolic`,
  ]
    .filter(Boolean)
    .join(range.diastolic ? ' or ' : '')

  return (
    <span className="badge-wrap">
      <button
        type="button"
        className={`badge tone-${band.tone}`}
        aria-describedby={tooltipId}
        // The tooltip is the whole point of the control; clicking it does
        // nothing on a pointer device, and on touch the tap reveals it.
        onClick={(e) => e.preventDefault()}
      >
        {band.label}
      </button>
      <span className="badge-tip" id={tooltipId} role="tooltip">
        <strong>{band.label}</strong>
        {numbers && <span className="badge-tip-range">{numbers}</span>}
        {band.description}
        <span className="badge-tip-source">{standard.shortName}</span>
      </span>
    </span>
  )
}
