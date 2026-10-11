import { useEffect, useRef, useState } from 'react'
import { STANDARD_LIST } from '../domain/standards'
import type { StandardId } from '../domain/standards'
import { useAccount, useProfile, useSessions } from '../data/hooks'
import { exportAll, importBackup, type ImportMode } from '../data/repository'
import { parseBackup, RestoreError } from '../data/restore'
import { signOut, sendMagicLink, signInWithPassword, updatePassword } from '../data/auth'
import { syncNow } from '../data/sync'
import { isSyncConfigured } from '../data/supabase'
import { downloadFile, sessionsToCsv } from '../data/export'
import { deleteDatabaseFor, LOCAL_USER_ID } from '../data/db'
import { seedDemoData } from '../data/seed'

export function Settings() {
  const { profile, standard, save } = useProfile()
  const sessions = useSessions()
  const account = useAccount()

  const [targetSystolic, setTargetSystolic] = useState('')
  const [targetDiastolic, setTargetDiastolic] = useState('')
  const [newTag, setNewTag] = useState('')
  const [busy, setBusy] = useState(false)
  const [restoreNote, setRestoreNote] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [accountNote, setAccountNote] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  // Which button opened the picker. State would not be read back in time:
  // the dialog's onChange fires outside React's update for the click.
  const pendingMode = useRef<ImportMode>('merge')

  useEffect(() => {
    if (!profile) return
    setTargetSystolic(profile.targetSystolic === null ? '' : String(profile.targetSystolic))
    setTargetDiastolic(profile.targetDiastolic === null ? '' : String(profile.targetDiastolic))
  }, [profile])

  if (!profile) return <main className="page" />

  async function saveTarget() {
    const systolic = targetSystolic.trim() === '' ? null : Number(targetSystolic)
    const diastolic = targetDiastolic.trim() === '' ? null : Number(targetDiastolic)

    // Both or neither: half a target would silently fall back to the standard
    // on one axis and look like a bug.
    if (systolic === null || diastolic === null) {
      await save({ targetSystolic: null, targetDiastolic: null })
      setTargetSystolic('')
      setTargetDiastolic('')
      return
    }
    if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) return
    await save({ targetSystolic: systolic, targetDiastolic: diastolic })
  }

  async function addTag() {
    const tag = newTag.trim().toLowerCase()
    if (tag === '' || profile!.tags.includes(tag)) return
    await save({ tags: [...profile!.tags, tag] })
    setNewTag('')
  }

  async function signIn() {
    const address = email.trim()
    if (address === '' || password === '') return
    setAuthBusy(true)
    setAccountNote(null)
    try {
      await signInWithPassword(address, password)
      setPassword('')
      // No note on success: onAccountChange reloads, and boot() decides which
      // database to open from the new session.
    } catch (error) {
      setAccountNote(error instanceof Error ? error.message : 'Could not sign in.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function savePassword() {
    if (newPassword === '') return
    setAuthBusy(true)
    setAccountNote(null)
    try {
      await updatePassword(newPassword)
      setNewPassword('')
      setAccountNote('Password saved. You can use it to sign in on your other devices.')
    } catch (error) {
      setAccountNote(error instanceof Error ? error.message : 'Could not save the password.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function requestLink() {
    const address = email.trim()
    if (address === '') return
    setAccountNote(null)
    try {
      await sendMagicLink(address)
      setAccountNote(`Sign-in link sent to ${address}. Open it on this device.`)
    } catch (error) {
      setAccountNote(error instanceof Error ? error.message : 'Could not send the link.')
    }
  }

  async function runSync() {
    setSyncing(true)
    setAccountNote(null)
    try {
      const report = await syncNow()
      setAccountNote(
        report.ran ? `Sent ${report.pushed}, received ${report.pulled}.` : 'Nothing to sync.',
      )
    } catch (error) {
      setAccountNote(error instanceof Error ? error.message : 'Sync failed.')
    } finally {
      setSyncing(false)
    }
  }

  async function restore(file: File, mode: ImportMode) {
    setRestoreNote(null)
    try {
      const parsed = parseBackup(await file.text())
      if (parsed.sessions.length === 0 && parsed.rejected === 0) {
        setRestoreNote('That backup has no readings in it.')
        return
      }

      const summary = parsed.exportedAt
        ? `Restore the backup taken on ${parsed.exportedAt.slice(0, 10)}?`
        : 'Restore this backup?'
      const detail =
        mode === 'replace'
          ? '\n\nEvery reading currently on this device will be deleted first.'
          : `\n\n${parsed.sessions.length} sittings will be added to what is already here.`
      if (!confirm(summary + detail)) return

      const result = await importBackup(parsed, mode)
      const parts = [`${result.added} added`]
      if (result.updated > 0) parts.push(`${result.updated} updated`)
      if (result.superseded > 0) parts.push(`${result.superseded} already newer here`)
      if (result.rejected > 0) parts.push(`${result.rejected} unreadable and skipped`)
      if (result.profileAdopted) parts.push('settings adopted')
      setRestoreNote(parts.join(' · '))
    } catch (error) {
      setRestoreNote(
        error instanceof RestoreError ? error.message : 'That file could not be read.',
      )
    } finally {
      // Cleared so picking the same file twice fires onChange the second time.
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <main className="page">
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      <section className="card stack">
        <div className="card-title">Guideline standard</div>
        <div className="stack" style={{ gap: 8 }}>
          {STANDARD_LIST.map((option) => (
            <label
              key={option.id}
              className="row"
              style={{ alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}
            >
              <input
                type="radio"
                name="standard"
                checked={profile.standard === option.id}
                onChange={() => void save({ standard: option.id as StandardId })}
                style={{ width: 'auto', marginTop: 4 }}
              />
              <span>
                <strong>
                  <span aria-hidden="true">{option.format.flag}</span> {option.name}
                </strong>
                <br />
                <span className="faint">
                  Home target under {option.homeThreshold.systolic}/
                  {option.homeThreshold.diastolic} mmHg · {option.bands.length} categories ·{' '}
                  {option.format.localeTag === 'en-US' ? 'month/day/year' : 'day/month/year'}{' '}
                  dates
                </span>
              </span>
            </label>
          ))}
        </div>
        <p className="faint">
          Changing this re-labels every reading you have already taken, including on past
          reports, and switches dates and times to that region’s convention. Nothing is
          rewritten — the readings are stored as measured and the category is worked out fresh
          each time, so switching back restores the old view exactly.
        </p>
      </section>

      <section className="card stack">
        <div className="card-title">Personal target</div>
        <p className="faint">
          Leave blank to use {standard.shortName}’s home threshold of{' '}
          {standard.homeThreshold.systolic}/{standard.homeThreshold.diastolic}. Set both values
          if your doctor has given you a different goal.
        </p>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="target-sys">Systolic</label>
            <input
              id="target-sys"
              type="text"
              inputMode="numeric"
              value={targetSystolic}
              placeholder={String(standard.homeThreshold.systolic)}
              onChange={(e) => setTargetSystolic(e.target.value.replace(/\D/g, '').slice(0, 3))}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="target-dia">Diastolic</label>
            <input
              id="target-dia"
              type="text"
              inputMode="numeric"
              value={targetDiastolic}
              placeholder={String(standard.homeThreshold.diastolic)}
              onChange={(e) =>
                setTargetDiastolic(e.target.value.replace(/\D/g, '').slice(0, 3))
              }
            />
          </div>
        </div>
        <button className="btn btn-secondary" onClick={saveTarget}>
          Save target
        </button>
      </section>

      <section className="card stack">
        <div className="card-title">Context tags</div>
        <div className="chips">
          {profile.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="chip"
              onClick={() => void save({ tags: profile.tags.filter((t) => t !== tag) })}
              title="Remove tag"
            >
              {tag} ✕
            </button>
          ))}
        </div>
        <div className="row">
          <input
            type="text"
            value={newTag}
            placeholder="Add a tag"
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addTag()
            }}
          />
          <button className="btn btn-secondary" onClick={addTag}>
            Add
          </button>
        </div>
        <p className="faint">
          Removing a tag here stops it being offered on new readings. Readings that already
          carry it keep it.
        </p>
      </section>

      {isSyncConfigured && (
        <section className="card stack">
          <div className="card-title">Backup and devices</div>
          {account === undefined ? (
            <p className="faint">Checking…</p>
          ) : account ? (
            <>
              <p className="faint">
                Signed in as <strong>{account.email ?? account.userId}</strong>. Readings sync
                in the background; this device stays the one you read from.
              </p>
              <button className="btn btn-secondary" disabled={syncing} onClick={runSync}>
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
              <div className="row">
                <input
                  type="password"
                  value={newPassword}
                  placeholder="Set a password"
                  autoComplete="new-password"
                  onChange={(e) => setNewPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void savePassword()
                  }}
                />
                <button className="btn btn-secondary" disabled={authBusy} onClick={savePassword}>
                  Save
                </button>
              </div>
              <p className="faint">
                A password lets you sign in on another device without waiting for an email.
              </p>
              <button className="btn btn-secondary" onClick={() => void signOut()}>
                Sign out
              </button>
              <p className="faint">
                Signing out leaves every reading on this device. It does not delete anything.
              </p>
            </>
          ) : (
            <>
              <p className="faint">
                Sign in to back your readings up and log on more than one device. The app works
                without an account — this adds a copy, it does not gate anything.
              </p>
              <div className="row">
                <input
                  type="email"
                  value={email}
                  placeholder="you@example.com"
                  autoComplete="email"
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="row">
                <input
                  type="password"
                  value={password}
                  placeholder="Password"
                  autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void signIn()
                  }}
                />
                <button className="btn" disabled={authBusy} onClick={signIn}>
                  {authBusy ? 'Signing in…' : 'Sign in'}
                </button>
              </div>
              <p className="faint">
                No password yet? Send yourself a link, then set one below once you are in.
              </p>
              <button className="btn btn-secondary" disabled={authBusy} onClick={requestLink}>
                Email me a sign-in link
              </button>
            </>
          )}
          {accountNote && <p className="faint">{accountNote}</p>}
        </section>
      )}

      <section className="card stack">
        <div className="card-title">Your data</div>
        <p className="faint">
          Everything is stored on this device. Take a copy whenever you like — a tool that holds
          your health history should never be the only place it exists.
        </p>
        <button
          className="btn btn-secondary"
          onClick={async () => {
            const bundle = await exportAll()
            downloadFile(
              `bp-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`,
              JSON.stringify(bundle, null, 2),
              'application/json',
            )
          }}
        >
          Download everything (JSON)
        </button>
        <button
          className="btn btn-secondary"
          disabled={!sessions || sessions.length === 0}
          onClick={() =>
            downloadFile(
              `bp-tracker-all-${new Date().toISOString().slice(0, 10)}.csv`,
              sessionsToCsv(sessions ?? []),
              'text/csv',
            )
          }
        >
          Download everything (CSV)
        </button>
      </section>

      <section className="card stack">
        <div className="card-title">Restore from a backup</div>
        <p className="faint">
          Reads a JSON backup back in. Readings are matched by id, so restoring the same file
          twice is harmless — and where a sitting exists on both sides, the more recently edited
          one is kept.
        </p>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void restore(file, pendingMode.current)
          }}
        />
        <button
          className="btn btn-secondary"
          onClick={() => {
            pendingMode.current = 'merge'
            fileInput.current?.click()
          }}
        >
          Merge a backup into this device
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => {
            pendingMode.current = 'replace'
            fileInput.current?.click()
          }}
        >
          Replace everything with a backup
        </button>
        {restoreNote && <p className="faint">{restoreNote}</p>}
        <p className="faint">
          This writes into the browser&rsquo;s storage on this device — the same storage a
          &ldquo;clear site data&rdquo; removes. Keep the file.
        </p>
      </section>

      {import.meta.env.DEV && (
        <section className="card stack">
          <div className="card-title">Development</div>
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const count = await seedDemoData()
                alert(`Added ${count} sample sittings.`)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Seeding…' : 'Add 4 months of sample data'}
          </button>
          <p className="faint">Only visible while running the dev server.</p>
        </section>
      )}

      <section className="card stack">
        <div className="card-title">Danger zone</div>
        <button
          className="btn btn-danger"
          onClick={async () => {
            if (!confirm('Delete every reading on this device? This cannot be undone.')) return
            await deleteDatabaseFor(LOCAL_USER_ID)
            location.reload()
          }}
        >
          Delete all local data
        </button>
      </section>

      <p className="disclaimer">
        BP Tracker keeps a record of readings you take yourself. It is not a medical device,
        does not diagnose anything, and cannot tell you whether your treatment is working.
        Categories follow {standard.name}.
      </p>
    </main>
  )
}
