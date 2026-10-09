import type { GuidelineStandard } from './types'

/**
 * AHA/ACC (American Heart Association / American College of Cardiology).
 *
 *   Normal      <120  and    <80
 *   Elevated 120–129  and    <80     ← the only `and` band
 *   Stage 1  130–139  or   80–89
 *   Stage 2     ≥140  or     ≥90
 *   Crisis      ≥180  and/or ≥120
 *
 * Elevated is the trap. Every other band joins with `or`, so 122/84 is
 * Stage 1 — the diastolic drags it up — not Elevated. Giving Elevated a null
 * diastolic floor encodes that: no diastolic value maps to it, so 84 falls
 * through to Stage 1's floor of 80 and wins on severity.
 *
 * AHA's thresholds are lower than ESC's throughout, so the same readings will
 * classify worse here. That is the standards disagreeing, not a bug.
 */
export const AHA: GuidelineStandard = {
  id: 'aha',
  name: 'AHA/ACC (United States)',
  shortName: 'AHA/ACC',
  source:
    '2017 ACC/AHA Guideline for the Prevention, Detection, Evaluation and Management of High Blood Pressure in Adults',
  format: {
    flag: '🇺🇸',
    localeTag: 'en-US',
    date: 'MMM d, yyyy',
    dateShort: 'MMM d',
    dateNumeric: 'MM/dd/yyyy',
    time: 'h:mm a',
    dayFull: 'EEEE, MMMM d',
    dayMonth: 'MMM d',
    dayOnly: 'd',
    weightUnit: 'lb',
    lengthUnit: 'in',
  },
  bands: [
    {
      id: 'normal',
      label: 'Normal',
      tone: 'optimal',
      systolicFrom: -Infinity,
      diastolicFrom: -Infinity,
      description: 'The ideal range. Nothing here needs acting on.',
    },
    {
      id: 'elevated',
      label: 'Elevated',
      tone: 'watch',
      systolicFrom: 120,
      diastolicFrom: null,
      description:
        'Above ideal. Likely to turn into high blood pressure over time unless something changes.',
    },
    {
      id: 'stage-1',
      label: 'Stage 1',
      tone: 'warn',
      systolicFrom: 130,
      diastolicFrom: 80,
      description:
        'Stage 1 hypertension. Lifestyle changes, plus medication depending on your overall cardiovascular risk.',
    },
    {
      id: 'stage-2',
      label: 'Stage 2',
      tone: 'high',
      systolicFrom: 140,
      diastolicFrom: 90,
      description:
        'Stage 2 hypertension. Normally treated with medication alongside lifestyle changes.',
    },
    {
      id: 'crisis',
      label: 'Crisis',
      tone: 'severe',
      systolicFrom: 180,
      diastolicFrom: 120,
      description: 'Crisis range. Contact a doctor straight away, even if you feel well.',
    },
  ],
  homeThreshold: { systolic: 130, diastolic: 80 },
  // AHA has no separate "urgent" tier, but a diastolic of 110 warrants prompt
  // contact under any standard, so the warning floor matches ESC's.
  urgent: { systolic: 180, diastolic: 110 },
  emergency: { systolic: 180, diastolic: 120 },
  isolatedSystolic: { systolicFrom: 140, diastolicBelow: 90 },
}
