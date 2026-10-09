import { format } from 'date-fns'
import { enGB, enUS } from 'date-fns/locale'
import type { Locale } from 'date-fns'
import type { GuidelineStandard } from './standards/types'

/**
 * Region-aware date and time formatting.
 *
 * Every date the app shows goes through here. Screens never call `format()`
 * with a literal pattern, for the same reason they never hardcode a threshold:
 * the convention belongs to the active standard, and 08/09 means two different
 * days depending on which side of the Atlantic you read it on.
 */

const LOCALES: Record<string, Locale> = {
  'en-GB': enGB,
  'en-US': enUS,
}

function localeFor(standard: GuidelineStandard): Locale {
  return LOCALES[standard.format.localeTag] ?? enGB
}

function fmt(date: Date, pattern: string, standard: GuidelineStandard): string {
  return format(date, pattern, { locale: localeFor(standard) })
}

/** "20 Aug 2026" / "Aug 20, 2026" */
export function formatDate(date: Date, standard: GuidelineStandard): string {
  return fmt(date, standard.format.date, standard)
}

/** "20 Aug" / "Aug 20" — chart axes and compact tables. */
export function formatDateShort(date: Date, standard: GuidelineStandard): string {
  return fmt(date, standard.format.dateShort, standard)
}

/** "20/08/2026" / "08/20/2026" — filenames and dense columns. */
export function formatDateNumeric(date: Date, standard: GuidelineStandard): string {
  return fmt(date, standard.format.dateNumeric, standard)
}

/** "20:06" / "8:06 PM" */
export function formatTime(date: Date, standard: GuidelineStandard): string {
  return fmt(date, standard.format.time, standard)
}

/** "Thursday 20 August" / "Thursday, August 20" — history day headings. */
export function formatDayFull(date: Date, standard: GuidelineStandard): string {
  return fmt(date, standard.format.dayFull, standard)
}

/** "Thu 20 Aug, 20:06" / "Thu, Aug 20, 8:06 PM" — chart tooltips. */
export function formatDateTime(date: Date, standard: GuidelineStandard): string {
  const day = fmt(
    date,
    standard.format.localeTag === 'en-US' ? 'EEE, MMM d' : 'EEE d MMM',
    standard,
  )
  return `${day}, ${formatTime(date, standard)}`
}

/**
 * "10–16 Aug" / "Aug 10–16" within a month; "27 Jul–2 Aug" / "Jul 27–Aug 2"
 * across one. Naming only the far month on a straddling week reads backwards.
 */
export function formatWeekRange(
  weekStart: Date,
  weekEnd: Date,
  standard: GuidelineStandard,
): string {
  const { dayMonth, dayOnly, localeTag } = standard.format

  if (weekStart.getMonth() === weekEnd.getMonth()) {
    // US puts the month first, so the bare number belongs on the far end;
    // Europe puts it last, so the bare number belongs on the near end.
    return localeTag === 'en-US'
      ? `${fmt(weekStart, dayMonth, standard)}–${fmt(weekEnd, dayOnly, standard)}`
      : `${fmt(weekStart, dayOnly, standard)}–${fmt(weekEnd, dayMonth, standard)}`
  }

  return `${fmt(weekStart, dayMonth, standard)}–${fmt(weekEnd, dayMonth, standard)}`
}

/** Value for an `<input type="datetime-local">` — always ISO, never localised. */
export function toDateTimeInput(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm")
}

/** ISO day for filenames and keys, where a stable sort order matters more than habit. */
export function toIsoDay(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}
