import { format } from 'date-fns'
import type { Session } from '../domain/types'

/**
 * CSV is one row per *reading*, not per sitting.
 *
 * A spreadsheet holding pre-averaged rows cannot be un-averaged, so exporting
 * the raw readings keeps the file a full substitute for the app rather than a
 * summary of it. The session id and its average travel on every row so the
 * grouping survives the trip.
 */
const COLUMNS = [
  'session_id',
  'taken_at_utc',
  'local_date',
  'local_time',
  'period',
  'reading_number',
  'systolic',
  'diastolic',
  'pulse',
  'arm',
  'session_avg_systolic',
  'session_avg_diastolic',
  // Metric regardless of the display unit, and named so there is no doubt. A
  // spreadsheet column headed "weight" is exactly how 78 kg becomes 78 lb, and
  // clinicians read kilograms and centimetres anyway.
  'weight_kg',
  'waist_cm',
  'tags',
  'notes',
] as const

function escapeCell(value: string | number | null): string {
  if (value === null) return ''
  const text = String(value)
  // Quote when the cell could otherwise break the row, and double any quotes
  // inside it. Notes are free text, so this is not theoretical.
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function sessionsToCsv(sessions: Session[]): string {
  const rows: string[] = [COLUMNS.join(',')]

  // Oldest first: a spreadsheet reads as a timeline, unlike the app's
  // newest-first list.
  const ordered = [...sessions].sort((a, b) => a.takenAt.localeCompare(b.takenAt))

  for (const session of ordered) {
    const at = new Date(session.takenAt)
    session.readings.forEach((reading, index) => {
      rows.push(
        [
          session.id,
          session.takenAt,
          format(at, 'yyyy-MM-dd'),
          format(at, 'HH:mm'),
          session.period,
          index + 1,
          reading.systolic,
          reading.diastolic,
          reading.pulse,
          session.arm,
          session.avgSystolic,
          session.avgDiastolic,
          // Repeated on every reading of the sitting, like the averages beside
          // them: one row per reading means session-level values travel along.
          session.weightKg,
          session.waistCm,
          session.tags.join('; '),
          session.notes,
        ]
          .map(escapeCell)
          .join(','),
      )
    })
  }

  return rows.join('\r\n')
}

/** Triggers a browser download. Revokes the URL so the blob is not retained. */
export function downloadFile(filename: string, contents: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: `${mime};charset=utf-8` }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
