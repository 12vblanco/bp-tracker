# BP Tracker

A personal blood pressure log. Records sittings, produces weekly averages, and
prints a report to take to an appointment.

Not a medical device. It records what you measure and nothing more.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 172 tests
npm run build
```

Settings → Development → *Add 4 months of sample data* seeds realistic history
(dev server only) so the charts and report can be judged on real-looking data.

## What it does

- **Sittings, not readings.** Guidelines want two or three measurements a minute
  apart, averaged. Each row saves on its own and later rows join the *same*
  sitting, so an interruption does not split one sitting into three.
- **Two guideline standards**, switchable in Settings: ESC/ESH 🇪🇺 and AHA/ACC 🇺🇸.
  Switching relabels your whole history — see below.
- **Home thresholds, not clinic ones.** ESC treats ≥135/85 as hypertension for
  self-measurement, AHA ≥130/80; both are lower than the clinic figures. Using
  the office numbers here would quietly under-report.
- **Morning/evening split**, weekly averages by ISO week, and a 7-day rolling mean.
- **Weight and waist**, optional on any sitting. Both are occasional by design —
  a chart metric, a dashboard card, and a report table appear once there is
  something to show, and stay out of the way when there is not. Stored in
  kilograms and centimetres whatever unit is on screen.
- **Tag insights** — average BP with vs without a tag, shown only when there are
  ≥5 sittings on both sides.
- **Doctor report** — printable summary plus a CSV of every individual reading.
- **Backup and restore.** Settings exports everything as JSON and reimports it.
  Readings are matched by id, so restoring the same file twice is harmless, and
  where a sitting exists on both sides the more recently edited one wins. Keep
  the file somewhere that is not this browser — see Durability.
- **Offline-first.** Everything lives in IndexedDB; a reading saves instantly and
  survives a dead connection.

## Architecture

```
src/domain/      pure logic — no React, no storage, no ambient clock
  standards/     ESC and AHA as data files behind a registry
  classify.ts    band, urgency, isolated systolic, in-target
  averages.ts    session/rolling/weekly/AM-PM math
  body.ts        weight and waist: units, per-day figures, first-to-last change
  series.ts      chart points + trailing rolling mean
  format.ts      region-aware dates and times
  reading.ts     bounds of a plausible cuff output, shared by Log and restore
src/data/        Dexie store behind repository.ts, the only door to storage
  restore.ts     parses a backup file, treating every value in it as hostile
src/screens/     Dashboard, Log, History, Report, Settings
```

Two rules hold the design together:

1. **No category is ever persisted.** The database stores raw readings and their
   numeric averages. Band, "in target", and target lines are computed at render
   time from the active standard, so switching standards reclassifies everything
   retroactively and switching back restores the old view exactly.
2. **No literal threshold outside `domain/standards/`.** Chart target lines,
   badge colours, and report percentages all read from the active standard.
   Adding NICE or JNC is a new file in `standards/` and one registry entry.

A third rule joins them once a measurement has a unit:

3. **No region-specific value is ever persisted.** Weight goes into the database
   in kilograms and waist in centimetres, whichever unit the active standard puts
   on screen. Storing a bare `78` would turn a 78 kg person into a 78 lb one on a
   trip to Settings — the unit version of persisting a category.

Screens import `data/repository.ts` and nothing below it, so the storage backend
can change without touching a component.

## Design

The visual system comes from the **"Instrument"** artboard of the design
mockups (`BP Tracker.dc.html`): a 232px nav rail
with live counts and a storage footer, a status top bar, a six-cell KPI strip,
IBM Plex Sans with IBM Plex Mono for every figure, and traffic-light bands. The
rail collapses to the existing bottom tab bar below 1024px.

Three deliberate departures from the artboard:

- **Band thresholds are the real ones.** The artboard redefines the bands
  (High normal 130–134, Grade 1 135–149, Grade 2 ≥150) and has **no Grade 3**.
  Grade 3 is what drives the crisis banner, so the app keeps the ESC/ESH
  thresholds and all six bands, and takes only the artboard's *visual*
  treatment. A sixth tone was derived with the artboard's own hue/chroma/
  lightness formula; every band's text clears 7:1 on its chip.
- **The diastolic chart line was re-stepped.** The artboard's step measured
  chroma 0.079 against a 0.1 floor — it read as a gridline, not data — and 2.75:1
  contrast. The systolic step is the artboard's exactly; the diastolic moved to
  L 0.69 / C 0.12. Validated with the dataviz palette checker in both modes.
- **Print keeps its own layout.** The artboard has no print state, and the
  desktop grid collapses badly under `@media print` (see below).

Theme is light / dark / follow-the-system, cycled from the top bar.

## Things that are easy to get wrong

- **AHA's Elevated band uses `and`, every other band uses `or`.** 122/84 is
  Stage 1, not Elevated. Encoded by giving Elevated a null diastolic floor;
  covered by a test named after the case.
- **Both standards put the crisis line at a systolic of 180**, so the `urgent`
  tier is reachable only by a diastolic of 110–119. A systolic of 180 goes
  straight to `emergency` — that is what "≥180 and/or ≥120" means.
- **A native `datetime-local` renders in the browser's locale**, which the app
  cannot override. The Log screen echoes the value back in the chosen region's
  wording underneath rather than giving up the native picker.
- **Dexie live queries run in read-only transactions.** `readProfile()` is safe
  inside one; `ensureProfile()` writes and is called once at startup.
- **Grid items default to `min-width: auto`**, so `.page` uses
  `grid-template-columns: minmax(0, 1fr)` — otherwise a wide table sizes the
  track to its own content and the whole page scrolls sideways.
- **`display: none` on a grid child removes it from grid flow.** Hiding the rail
  for print promoted `.shell` into the 232px rail track and squeezed the report
  into a narrow clipped column, so the print block sets `.app { display: block }`
  to drop the grid entirely.
- **Body measurements belong to a day, not to a sitting.** They ride along on a
  sitting because that is the trip you already make, but a day measured twice
  reports the mean of the two — the same treatment readings inside a sitting get.
  `dailyBody` is the only thing charts and deltas read.
- **Rows written before the v2 migration carry `undefined`, not `null`**, and
  `undefined` is the one value a `=== null` check misses. The Dexie upgrade
  backfills them and `repository.ts` normalises on read, so nothing above that
  seam has to be defensive.
- **A restored row's `userId` comes from the live session, never from the file.**
  A backup exported under a different id would otherwise write rows that the
  per-user database namespace guarantees this user can never see — a restore
  that reports success and shows nothing. Restored rows are also `pending`, not
  `clean`: they are edits no server has heard about yet.
- **A backup's averages are recomputed, not trusted.** They are derived data, and
  a file is exactly where a stored mean stops agreeing with the readings under
  it. Recomputing is a no-op on an intact file and a repair on a damaged one.
- **Weight deltas carry no colour.** Down is good for blood pressure and the
  trend deltas are green for it. "Down is good" is not true of body weight for
  everyone who might use this, so those deltas get a sign and a figure and no
  judgement. Waist is not classified at all: the published thresholds depend on
  sex and ethnicity, which the app does not know and should not start asking for.
- **The dark chart pair cannot clear 3:1 on both lines.** On a dark surface the
  recessive line has to be darker, and every step that gains contrast collapses
  the pair's separation below the ΔE 15 floor. The contrast WARN is accepted with
  the relief the rule requires: a legend naming both lines, and the weekly table
  carrying every number.

## Deploying

Netlify, gated by HTTP basic auth in an edge function — no database, no auth
provider, no account to manage.

```
netlify.toml                      build command, publish dir, SPA fallback
netlify/edge-functions/auth.ts    401s every request without the credentials
```

Set `BP_USER` and `BP_PASSWORD` in **Site configuration → Environment variables**
and nowhere else. The function fails closed, so an unset variable locks the site
rather than opening it.

**The login gates the app, not the data.** Readings live in IndexedDB in whichever
browser you logged them from, so hosting buys access from anywhere, not a backup
and not a shared history — the phone and the laptop keep two unrelated logs that
never meet. That is Phase 2's job, not this one's.

Two consequences worth knowing before relying on it:

- **Offline stops working** until Phase 4 ships a service worker. On localhost the
  shell comes off disk; hosted, it comes over the network, and the README's
  "survives a dead connection" promise only holds for a tab already open.
- **Basic auth and an installed PWA sit badly together.** An iOS home-screen
  webview does not reliably share Safari's credential cache, so the native dialog
  can reappear where there is no good place to show it. If it comes to that, swap
  the function for a login form that sets an HMAC-signed cookie — same shape, same
  absence of a database, roughly sixty lines instead of twenty.

## Durability

The readings live in IndexedDB, which is script-writable storage the browser is
free to discard. Two things take it out with no undo and no warning:

- **"Clear browsing data" with "Cookies and other site data" ticked** — which is
  on by default in Chrome's dialog, and is a separate box from the cache. Clearing
  only cached files leaves the readings alone; clearing site data does not.
- **Safari's ITP**, which evicts storage for sites not visited in ~7 days unless
  the site is installed.

So the JSON backup is the durable copy and IndexedDB is the working one. Export
to somewhere synced — iCloud, Dropbox — rather than `~/Downloads`, which is on
the same disk and gets tidied. A restored backup lands back in IndexedDB, which
means a restore is not itself protection against the next clear.

`PHASE-2-AUTH-SYNC.md` holds the server-side answer and the conditions for
reaching for it. Phase 4 (install as a PWA) is the cheaper half: installing is
also what stops Safari evicting.

## Status

Phase 1 (local-first app) and Phase 3 (report and export) are done. Phase 2 —
Supabase auth and background sync — is not built yet, and is deferred on
purpose: the app runs on localhost for one person, where a server buys nothing
and adds an RLS obligation. `PHASE-2-AUTH-SYNC.md` holds the decision, the
trigger conditions for revisiting it, the schema and RLS policy, and the sync
design. The groundwork is in place: `user_id` on every row, per-user Dexie
namespacing, settings in a profile record rather than localStorage, and a
`syncState` field on every session. Phase 4 (PWA install, service worker) is
also outstanding, and is what the hosted deployment needs before it can claim to
work offline.
