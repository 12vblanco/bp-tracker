import type { GuidelineStandard, StandardId } from './types'
import { ESC } from './esc'
import { AHA } from './aha'

export type { Band, GuidelineStandard, StandardId, Tone } from './types'
export { ESC } from './esc'
export { AHA } from './aha'

export const STANDARDS: Record<StandardId, GuidelineStandard> = {
  esc: ESC,
  aha: AHA,
}

export const STANDARD_LIST: GuidelineStandard[] = [ESC, AHA]

export const DEFAULT_STANDARD_ID: StandardId = 'esc'

export function isStandardId(value: unknown): value is StandardId {
  return value === 'esc' || value === 'aha'
}

/**
 * The only lookup. Adding NICE or JNC means adding a file and one entry above —
 * no classification, chart, or report code changes.
 *
 * Falls back to the default rather than throwing: a profile row carrying an
 * unknown id (rolled-back deploy, hand-edited database) should degrade to a
 * working app, not a blank screen.
 */
export function getStandard(id: string | null | undefined): GuidelineStandard {
  return isStandardId(id) ? STANDARDS[id] : STANDARDS[DEFAULT_STANDARD_ID]
}
