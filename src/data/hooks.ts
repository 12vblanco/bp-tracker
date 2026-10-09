import { useLiveQuery } from 'dexie-react-hooks'
import type { BP, Session } from '../domain/types'
import type { GuidelineStandard } from '../domain/standards'
import { getStandard } from '../domain/standards'
import { listSessions, readProfile, saveProfile, type ProfilePatch } from './repository'
import type { ProfileRecord } from './db'

/**
 * React's view of the repository. Dexie's live queries re-run whenever a table
 * changes, so a save on the Log screen updates the Dashboard with no store,
 * no invalidation, and no refetch.
 *
 * `undefined` means "still loading"; an empty array means "no readings yet".
 * Screens must tell those apart or they will flash an empty state on every load.
 */
export function useSessions(): Session[] | undefined {
  return useLiveQuery(() => listSessions(), [])
}

export interface ProfileView {
  profile: ProfileRecord | undefined
  /** Never undefined — falls back to the default so screens can render immediately. */
  standard: GuidelineStandard
  /** Personal goal, or null to use the standard's own home threshold. */
  target: BP | null
  save: (patch: ProfilePatch) => Promise<void>
}

export function useProfile(): ProfileView {
  // Read-only: the row is created once at startup by `ensureProfile`, because a
  // live query cannot write.
  const profile = useLiveQuery(() => readProfile(), [])

  const target =
    profile && profile.targetSystolic !== null && profile.targetDiastolic !== null
      ? { systolic: profile.targetSystolic, diastolic: profile.targetDiastolic }
      : null

  return {
    profile,
    standard: getStandard(profile?.standard),
    target,
    save: async (patch: ProfilePatch) => {
      await saveProfile(patch)
    },
  }
}
