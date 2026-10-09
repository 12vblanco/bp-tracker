import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Arm, Period, Reading } from '../domain/types'
import type { GuidelineStandard } from '../domain/standards'
import { periodFor, sessionAverage } from '../domain/averages'
import { inReadingRange, type ReadingField } from '../domain/reading'
import { urgencyOf } from '../domain/classify'
import { formatDate, formatDayFull, formatTime, toDateTimeInput } from '../domain/format'
import {
  formatBody,
  labelFor,
  latestBody,
  parseBody,
  sanitizeDecimal,
  toBodyInput,
  unitFor,
  type BodyMeasure,
} from '../domain/body'
import { useProfile, useSessions } from '../data/hooks'
import { createSession, updateSession, getSession, deleteSession } from '../data/repository'
import { CategoryBadge } from '../components/CategoryBadge'
import { UrgentBanner } from '../components/UrgentBanner'

const MAX_READINGS = 3

interface Draft {
  systolic: string
  diastolic: string
  pulse: string
}

const EMPTY_DRAFT: Draft = { systolic: '', diastolic: '', pulse: '' }

function parseField(value: string, field: ReadingField): number | null {
  if (!/^\d{2,3}$/.test(value)) return null
  const n = Number(value)
  return inReadingRange(n, field) ? n : null
}

/** A row counts once both pressures are valid; pulse stays optional throughout. */
function parseDraft(draft: Draft): Reading | null {
  const systolic = parseField(draft.systolic, 'systolic')
  const diastolic = parseField(draft.diastolic, 'diastolic')
  if (systolic === null || diastolic === null) return null
  return { systolic, diastolic, pulse: parseField(draft.pulse, 'pulse') }
}

function toDraft(reading: Reading): Draft {
  return {
    systolic: String(reading.systolic),
    diastolic: String(reading.diastolic),
    pulse: reading.pulse === null ? '' : String(reading.pulse),
  }
}

interface Meta {
  takenAt: Date
  period: Period
  arm: Arm | null
  tags: string[]
  notes: string
  weightKg: number | null
  waistCm: number | null
}

/**
 * A comparable fingerprint of everything about a sitting that is not a reading.
 * String comparison beats a field-by-field diff here because tags are an array
 * whose order the chips can change without anything meaningful having changed.
 *
 * Body measurements go in as canonical numbers, not as the typed text: "78.40"
 * and "78.4" are the same measurement, and a text diff would light up the save
 * button over a trailing zero.
 */
function metaKey(meta: Meta): string {
  return JSON.stringify([
    meta.takenAt.getTime(),
    meta.period,
    meta.arm,
    [...meta.tags].sort(),
    meta.notes.trim(),
    meta.weightKg,
    meta.waistCm,
  ])
}

function sameReading(a: Reading | null, b: Reading | null): boolean {
  if (a === null || b === null) return a === b
  return a.systolic === b.systolic && a.diastolic === b.diastolic && a.pulse === b.pulse
}

/**
 * Log a sitting.
 *
 * Readings save one at a time. Guidelines want two or three measurements a
 * minute apart, and a minute is long enough to be interrupted — so each row
 * commits on its own, and a later row is appended to the *same* sitting rather
 * than starting a new one. The average recalculates as they arrive.
 *
 * Editing an existing sitting reuses this screen: same fields, same validation,
 * same warnings, only the starting state differs.
 */
export function Log() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { standard, target, profile } = useProfile()
  const sessions = useSessions()

  const [drafts, setDrafts] = useState<Draft[]>(() => Array(MAX_READINGS).fill(EMPTY_DRAFT))
  /** What is actually persisted, index-aligned with `drafts`. */
  const [saved, setSaved] = useState<(Reading | null)[]>(() => Array(MAX_READINGS).fill(null))
  const [sessionId, setSessionId] = useState<string | null>(id ?? null)
  /** Metadata as last written, so the save button can tell edits from no-ops. */
  const [savedMeta, setSavedMeta] = useState<string | null>(null)

  const [takenAt, setTakenAt] = useState(() => toDateTimeInput(new Date()))
  const [periodOverride, setPeriodOverride] = useState<Period | null>(null)
  const [arm, setArm] = useState<Arm | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  /** Held as typed text in the display unit; `parseBody` converts on the way out. */
  const [weightText, setWeightText] = useState('')
  const [waistText, setWaistText] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)

  const inputs = useRef(new Map<string, HTMLInputElement>())

  useEffect(() => {
    if (!id) return
    let cancelled = false

    void getSession(id).then((session) => {
      if (cancelled) return
      if (!session) {
        setLoadFailed(true)
        return
      }
      const padded: (Reading | null)[] = Array(MAX_READINGS).fill(null)
      session.readings.slice(0, MAX_READINGS).forEach((r, i) => {
        padded[i] = r
      })

      setSaved(padded)
      setSavedMeta(
        metaKey({
          takenAt: new Date(session.takenAt),
          period: session.period,
          arm: session.arm,
          tags: session.tags,
          notes: session.notes ?? '',
          weightKg: session.weightKg,
          waistCm: session.waistCm,
        }),
      )
      setDrafts(padded.map((r) => (r ? toDraft(r) : EMPTY_DRAFT)))
      setSessionId(session.id)
      setTakenAt(toDateTimeInput(new Date(session.takenAt)))
      setPeriodOverride(session.period)
      setArm(session.arm)
      setTags(session.tags)
      setNotes(session.notes ?? '')
      setWeightText(toBodyInput(session.weightKg, 'weightKg', standard))
      setWaistText(toBodyInput(session.waistCm, 'waistCm', standard))
    })

    return () => {
      cancelled = true
    }
    // `standard` is in the list because the body fields render in *its* unit,
    // and the profile arrives a tick after mount — so the first pass can format
    // with the fallback standard. Re-running relabels 78.4 kg as 172.8 lb
    // instead of leaving a kilogram figure under a "lb" label. It cannot clobber
    // typing: the form does not render until the profile has loaded.
  }, [id, standard])

  const parsed = useMemo(() => drafts.map(parseDraft), [drafts])
  const savedReadings = useMemo(() => saved.filter((r): r is Reading => r !== null), [saved])

  // The live average previews everything on screen, saved or not, so typing a
  // third reading shows its effect before you commit it.
  const previewReadings = useMemo(
    () => parsed.filter((r): r is Reading => r !== null),
    [parsed],
  )
  const average = useMemo(() => sessionAverage(previewReadings), [previewReadings])
  const savedAverage = useMemo(() => sessionAverage(savedReadings), [savedReadings])

  // Warn on the worst individual reading, not the average. A 185 followed by
  // two calmer readings still happened, and averaging it away would hide it.
  const urgency = useMemo(() => {
    let worst: ReturnType<typeof urgencyOf> = 'none'
    for (const reading of previewReadings) {
      const level = urgencyOf(reading, standard)
      if (level === 'emergency') return 'emergency'
      if (level === 'urgent') worst = 'urgent'
    }
    return worst
  }, [previewReadings, standard])

  const takenAtDate = useMemo(() => new Date(takenAt), [takenAt])
  const takenAtValid = !Number.isNaN(takenAtDate.getTime())
  const derivedPeriod = useMemo(
    () => (takenAtValid ? periodFor(takenAtDate) : 'other'),
    [takenAtDate, takenAtValid],
  )
  const period = periodOverride ?? derivedPeriod

  const visibleRows = Math.min(
    MAX_READINGS,
    Math.max(1 + parsed.filter((r) => r !== null).length, savedReadings.length + 1),
  )

  const unsavedRows = parsed.filter(
    (r, i) => r !== null && !sameReading(r, saved[i] ?? null),
  ).length

  const weightKg = parseBody(weightText, 'weightKg', standard)
  const waistCm = parseBody(waistText, 'waistCm', standard)

  const currentMeta: Meta = {
    takenAt: takenAtDate,
    period,
    arm,
    tags,
    notes,
    weightKg,
    waistCm,
  }

  const metaDirty = savedMeta !== null && savedMeta !== metaKey(currentMeta)
  const hasChanges = unsavedRows > 0 || metaDirty

  // The previous figures, so the field has something to sanity-check against.
  // This sitting is excluded, or the hint would echo the number you just typed
  // back at you as though it had come from somewhere else.
  const previous = useMemo(
    () => (sessions ? latestBody(sessions.filter((s) => s.id !== sessionId)) : null),
    [sessions, sessionId],
  )

  /**
   * Writes `next` as the sitting's readings. Creating, updating and deleting all
   * funnel through here so the session id and the saved state can never drift
   * apart from what is on disk.
   */
  async function persist(next: (Reading | null)[]) {
    if (!takenAtValid) return
    setBusy(true)
    try {
      const readings = next.filter((r): r is Reading => r !== null)
      const savedKey = metaKey(currentMeta)
      const meta = {
        takenAt: takenAtDate,
        period,
        arm,
        tags,
        notes: notes.trim() === '' ? null : notes.trim(),
        weightKg,
        waistCm,
      }

      if (readings.length === 0) {
        // Removing the last reading removes the sitting. A zero-reading sitting
        // is not a thing, and leaving one behind would break every average.
        if (sessionId) {
          await deleteSession(sessionId)
          setSessionId(null)
        }
      } else if (sessionId) {
        await updateSession(sessionId, { ...meta, readings })
      } else {
        const created = await createSession({ ...meta, readings })
        setSessionId(created.id)
      }

      setSaved(next)
      setSavedMeta(readings.length === 0 ? null : savedKey)
    } finally {
      setBusy(false)
    }
  }

  function saveRow(index: number) {
    const reading = parsed[index]
    if (!reading) return
    void persist(saved.map((r, i) => (i === index ? reading : r)))
  }

  function deleteRow(index: number) {
    void persist(saved.map((r, i) => (i === index ? null : r)))
    setDrafts((current) => current.map((d, i) => (i === index ? EMPTY_DRAFT : d)))
  }

  function saveAll() {
    void persist(saved.map((r, i) => parsed[i] ?? r))
  }

  function setDraft(index: number, field: keyof Draft, value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 3)
    setDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, [field]: digits } : draft)),
    )

    // Three digits is as long as any of these values gets, so jumping on the
    // third keystroke saves a tab per field without ever trapping the cursor.
    if (digits.length === 3) {
      const next = field === 'systolic' ? 'diastolic' : field === 'diastolic' ? 'pulse' : null
      if (next) inputs.current.get(`${index}-${next}`)?.focus()
    }
  }

  function toggleTag(tag: string) {
    setTags((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag],
    )
  }

  async function removeSitting() {
    if (!sessionId) return
    if (!confirm('Delete this whole sitting and all its readings?')) return
    await deleteSession(sessionId)
    navigate('/history')
  }

  // Nothing renders until the profile is known. The body fields are labelled in
  // the standard's unit, and a field reading "kg" on one paint and "lb" on the
  // next is a field whose number you cannot trust.
  if (!profile) return <main className="page" />

  if (loadFailed) {
    return (
      <main className="page">
        <div className="empty">
          <p>That reading no longer exists.</p>
          <button className="btn btn-secondary" onClick={() => navigate('/history')}>
            Back to history
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="page">
      <div className="page-header page-header-titled">
        <h1>{id ? 'Edit sitting' : 'New reading'}</h1>
        {id && <p className="mono">EDITING AN EXISTING SITTING</p>}
      </div>

      <UrgentBanner urgency={urgency} />

      <section className="card stack">
        <div className="card-title">
          Readings{' '}
          <span style={{ textTransform: 'none', letterSpacing: 0 }}>
            · two or three, a minute apart
          </span>
        </div>

        <div className="reading-rows">
          {drafts.slice(0, visibleRows).map((draft, index) => (
            <ReadingRow
              key={index}
              index={index}
              draft={draft}
              reading={parsed[index] ?? null}
              savedReading={saved[index] ?? null}
              busy={busy}
              autoFocus={index === 0 && !id}
              onChange={setDraft}
              onSave={() => saveRow(index)}
              onDelete={() => deleteRow(index)}
              register={(field, el) => {
                if (el) inputs.current.set(`${index}-${field}`, el)
                else inputs.current.delete(`${index}-${field}`)
              }}
            />
          ))}
        </div>

        {average ? (
          <div className="row-between session-average">
            <div>
              <div className="bp-value bp-large">
                {average.systolic}/{average.diastolic} <span className="bp-unit">mmHg</span>
              </div>
              <div className="faint">
                Average of {previewReadings.length} reading
                {previewReadings.length === 1 ? '' : 's'}
                {average.pulse !== null ? ` · ${average.pulse} bpm` : ''}
                {unsavedRows > 0 && savedReadings.length > 0 ? ' · includes unsaved' : ''}
              </div>
            </div>
            <CategoryBadge bp={average} standard={standard} target={target} />
          </div>
        ) : (
          <p className="faint">Enter a systolic and diastolic value to see the average.</p>
        )}

        {savedReadings.length > 0 && (
          <p className="saved-note">
            Saved{savedAverage ? ` at ${savedAverage.systolic}/${savedAverage.diastolic}` : ''}{' '}
            with {savedReadings.length} reading{savedReadings.length === 1 ? '' : 's'}. Add
            another when you take it — it joins this same sitting rather than starting a new
            one.
          </p>
        )}
      </section>

      <section className="card stack">
        <div className="field">
          <label htmlFor="takenAt">When</label>
          <input
            id="takenAt"
            type="datetime-local"
            value={takenAt}
            onChange={(e) => {
              setTakenAt(e.target.value)
              setPeriodOverride(null)
            }}
          />
          {/* A native datetime-local renders in the *browser's* locale, which
              this app cannot override — so it can show 08/20 while every other
              date on screen shows 20 Aug. Echoing the value back in the chosen
              region's wording removes the ambiguity without giving up the
              native picker, which is far better on a phone than anything
              hand-rolled. */}
          {takenAtValid && (
            <span className="faint">
              {formatDayFull(takenAtDate, standard)} {takenAtDate.getFullYear()} ·{' '}
              {formatTime(takenAtDate, standard)}
            </span>
          )}
        </div>

        <div className="field">
          <label>Time of day</label>
          <div className="chips">
            {(['morning', 'evening', 'other'] as Period[]).map((option) => (
              <button
                key={option}
                type="button"
                className="chip"
                aria-pressed={period === option}
                onClick={() => setPeriodOverride(option)}
              >
                {option === 'other'
                  ? 'Midday / night'
                  : option[0]!.toUpperCase() + option.slice(1)}
              </button>
            ))}
          </div>
          {periodOverride === null && (
            <span className="faint">Set from the time above. Tap to override.</span>
          )}
        </div>

        <div className="field">
          <label>Arm</label>
          <div className="chips">
            {(['left', 'right'] as Arm[]).map((option) => (
              <button
                key={option}
                type="button"
                className="chip"
                aria-pressed={arm === option}
                onClick={() => setArm(arm === option ? null : option)}
              >
                {option[0]!.toUpperCase() + option.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card stack">
        <div className="card-title">
          Body{' '}
          <span style={{ textTransform: 'none', letterSpacing: 0 }}>
            · optional, whenever you happen to measure
          </span>
        </div>

        <div className="row">
          <BodyField
            measure="weightKg"
            value={weightText}
            parsed={weightKg}
            previous={previous?.weightKg ?? null}
            standard={standard}
            onChange={setWeightText}
          />
          <BodyField
            measure="waistCm"
            value={waistText}
            parsed={waistCm}
            previous={previous?.waistCm ?? null}
            standard={standard}
            onChange={setWaistText}
          />
        </div>

        {(weightText !== '' || waistText !== '') && previewReadings.length === 0 ? (
          // Body measurements travel on the sitting, so there has to be a
          // sitting. Saying so beats a disabled save button with no explanation.
          <p className="faint">
            These save with the sitting — enter a reading above and they go with it.
          </p>
        ) : (
          <p className="faint">
            Leave blank on the days you do not measure. Weight is most comparable taken at the
            same time of day, and a waist tape at the navel, breathing out.
          </p>
        )}
      </section>

      <section className="card stack">
        <div className="field">
          <label>Context</label>
          <div className="chips">
            {(profile?.tags ?? []).map((tag) => (
              <button
                key={tag}
                type="button"
                className="chip"
                aria-pressed={tags.includes(tag)}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="notes">Notes</label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth remembering about this reading"
          />
        </div>
      </section>

      <button
        className="btn btn-lg btn-block"
        onClick={saveAll}
        disabled={busy || !takenAtValid || !hasChanges}
      >
        {busy
          ? 'Saving…'
          : savedReadings.length > 0
            ? unsavedRows > 0
              ? `Save ${unsavedRows} more reading${unsavedRows === 1 ? '' : 's'}`
              : metaDirty
                ? 'Save changes'
                : 'Saved'
            : unsavedRows > 1
              ? `Save all ${unsavedRows} readings`
              : 'Save reading'}
      </button>

      {savedReadings.length > 0 && (
        <button
          className="btn btn-secondary btn-block"
          onClick={() => navigate(id ? '/history' : '/')}
        >
          Done
        </button>
      )}

      {sessionId && (
        <button className="btn btn-danger btn-block" onClick={removeSitting}>
          Delete this whole sitting
        </button>
      )}

      <p className="disclaimer">
        This app records what you measure and does nothing more. It is not a medical device and
        cannot diagnose anything. Categories follow {standard.name} and are a guide for talking
        to your doctor, not a substitute for one.
      </p>
    </main>
  )
}

const PLACEHOLDERS: Record<string, string> = { kg: '78.5', lb: '173', cm: '94', in: '37' }

interface BodyFieldProps {
  measure: BodyMeasure
  value: string
  /** The canonical value `value` parses to, or null when blank or implausible. */
  parsed: number | null
  previous: { value: number; takenAt: string } | null
  standard: GuidelineStandard
  onChange: (value: string) => void
}

/**
 * One body measurement. The unit is in the label rather than as a suffix inside
 * the box, because the number and its unit have to survive being read at a
 * glance next to a blood pressure — and 78.4 with nothing beside it is the sort
 * of figure someone later reads as pounds.
 */
function BodyField({ measure, value, parsed, previous, standard, onChange }: BodyFieldProps) {
  const unit = unitFor(measure, standard)
  const id = measure === 'weightKg' ? 'weight' : 'waist'
  // Typed something, and it did not survive validation. Silence here would drop
  // the measurement on save without ever saying so.
  const rejected = value.trim() !== '' && parsed === null

  return (
    <div className="field" style={{ flex: 1 }}>
      <label htmlFor={id}>
        {labelFor(measure)} <span className="bp-unit">{unit}</span>
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={PLACEHOLDERS[unit] ?? ''}
        value={value}
        aria-invalid={rejected || undefined}
        onChange={(e) => onChange(sanitizeDecimal(e.target.value))}
      />
      {rejected ? (
        <span className="field-warn">
          Not a plausible {labelFor(measure).toLowerCase()} in {unit}.
        </span>
      ) : previous ? (
        <span className="faint">
          Last {formatBody(previous.value, measure, standard)} on{' '}
          {formatDate(new Date(previous.takenAt), standard)}
        </span>
      ) : null}
    </div>
  )
}

interface RowProps {
  index: number
  draft: Draft
  reading: Reading | null
  savedReading: Reading | null
  busy: boolean
  autoFocus: boolean
  onChange: (index: number, field: keyof Draft, value: string) => void
  onSave: () => void
  onDelete: () => void
  register: (field: keyof Draft, el: HTMLInputElement | null) => void
}

const FIELDS: { key: keyof Draft; label: string; placeholder: string }[] = [
  { key: 'systolic', label: 'Systolic', placeholder: '120' },
  { key: 'diastolic', label: 'Diastolic', placeholder: '80' },
  { key: 'pulse', label: 'Pulse', placeholder: '70' },
]

function ReadingRow({
  index,
  draft,
  reading,
  savedReading,
  busy,
  autoFocus,
  onChange,
  onSave,
  onDelete,
  register,
}: RowProps) {
  const isSaved = savedReading !== null
  const isDirty = reading !== null && !sameReading(reading, savedReading)
  const isEmpty = draft.systolic === '' && draft.diastolic === '' && draft.pulse === ''

  return (
    <div className={`reading-row${isSaved ? ' is-saved' : ''}`}>
      <span className="reading-index">{index + 1}</span>

      <div className="reading-fields">
        {FIELDS.map((field) => (
          <label key={field.key} className="reading-field">
            <span className="faint">{field.label}</span>
            <input
              // A numeric keypad on a phone, but type="text" so leading-zero and
              // spinner behaviour stay predictable and the 3-digit cap can hold.
              type="text"
              inputMode="numeric"
              autoComplete="off"
              aria-label={`Reading ${index + 1} ${field.label}`}
              placeholder={field.placeholder}
              value={draft[field.key]}
              autoFocus={autoFocus && field.key === 'systolic'}
              ref={(el) => register(field.key, el)}
              onChange={(e) => onChange(index, field.key, e.target.value)}
              className="reading-input"
            />
          </label>
        ))}
      </div>

      <div className="reading-actions">
        {isDirty ? (
          <button
            type="button"
            className="btn btn-secondary btn-row"
            disabled={busy}
            onClick={onSave}
          >
            {isSaved ? 'Update' : 'Save'}
          </button>
        ) : (
          <span className={`reading-saved${isSaved ? '' : ' is-placeholder'}`}>✓ Saved</span>
        )}

        <button
          type="button"
          className="btn-icon"
          disabled={busy || (!isSaved && isEmpty)}
          onClick={onDelete}
          aria-label={`Delete reading ${index + 1}`}
          title={isSaved ? 'Delete this saved reading' : 'Clear this row'}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
