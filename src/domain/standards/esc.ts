import type { GuidelineStandard } from './types'

/**
 * ESC/ESH (European Society of Cardiology / European Society of Hypertension).
 *
 * Office categories, classified by the worse of the two values:
 *
 *   Optimal      <120  and      <80
 *   Normal    120–129  and/or  80–84
 *   High-norm 130–139  and/or  85–89
 *   Grade 1   140–159  and/or  90–99
 *   Grade 2   160–179  and/or 100–109
 *   Grade 3      ≥180  and/or   ≥110
 *
 * The home threshold is 135/85, not the 140/90 office figure — self-measured
 * readings run lower, and using the office number here would under-report.
 */
export const ESC: GuidelineStandard = {
  id: 'esc',
  name: 'ESC/ESH (Europe)',
  shortName: 'ESC/ESH',
  source: '2018 ESC/ESH Guidelines for the management of arterial hypertension',
  format: {
    flag: '🇪🇺',
    localeTag: 'en-GB',
    date: 'd MMM yyyy',
    dateShort: 'd MMM',
    dateNumeric: 'dd/MM/yyyy',
    time: 'HH:mm',
    dayFull: 'EEEE d MMMM',
    dayMonth: 'd MMM',
    dayOnly: 'd',
    weightUnit: 'kg',
    lengthUnit: 'cm',
  },
  bands: [
    {
      id: 'optimal',
      label: 'Optimal',
      tone: 'optimal',
      systolicFrom: -Infinity,
      diastolicFrom: -Infinity,
      description: 'The ideal range. Nothing here needs acting on.',
    },
    {
      id: 'normal',
      label: 'Normal',
      tone: 'normal',
      systolicFrom: 120,
      diastolicFrom: 80,
      description: 'Healthy, though a little above ideal.',
    },
    {
      id: 'high-normal',
      label: 'High-normal',
      tone: 'watch',
      systolicFrom: 130,
      diastolicFrom: 85,
      description:
        'Above ideal but below the treatment threshold. Worth keeping an eye on, and the range where lifestyle changes do the most good.',
    },
    {
      id: 'grade-1',
      label: 'Grade 1',
      tone: 'warn',
      systolicFrom: 140,
      diastolicFrom: 90,
      description:
        'Mild hypertension. Usually addressed with lifestyle changes first, with medication depending on your overall risk.',
    },
    {
      id: 'grade-2',
      label: 'Grade 2',
      tone: 'high',
      systolicFrom: 160,
      diastolicFrom: 100,
      description: 'Moderate hypertension. Normally treated with medication.',
    },
    {
      id: 'grade-3',
      label: 'Grade 3',
      tone: 'severe',
      systolicFrom: 180,
      diastolicFrom: 110,
      description: 'Severe hypertension. Contact your doctor without delay.',
    },
  ],
  homeThreshold: { systolic: 135, diastolic: 85 },
  urgent: { systolic: 180, diastolic: 110 },
  emergency: { systolic: 180, diastolic: 120 },
  isolatedSystolic: { systolicFrom: 140, diastolicBelow: 90 },
}
