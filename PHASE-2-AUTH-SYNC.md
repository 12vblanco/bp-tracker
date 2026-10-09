# Phase 2 — Supabase auth and sync

Notes to self, written 2026-09-28. Not built, deliberately. The app works on
localhost and that is enough for now; this is the decision and the design so
neither has to be rederived when it stops being enough.

## Verdict

Do it — the codebase was designed for it — but not yet, and not as a login wall.

## Why to do it eventually

The argument is **durability, not multi-device**. IndexedDB is script-writable
storage: Safari's ITP evicts it after ~7 days without a visit for sites that
are not installed, and any "clear site data" wipes the history with no undo.
The only backup today is a manual JSON export you have to remember to run. For
a log you intend to hand to a doctor, that is thin.

Multi-device is real but secondary — log on the phone, print the report from
the laptop.

## Why not yet

Blood pressure history is special-category health data. Local-only means there
is no breach surface at all. A server means one RLS policy becomes the thing
standing between your readings and everyone else's. That is manageable, but it
is an obligation the app does not currently carry, and carrying it for a
single-user localhost app buys nothing.

Trigger conditions — do it when any of these become true:

- The history is worth more than the effort of re-entering it (roughly: once
  there are months of data you could not reconstruct from paper).
- You want to log on a phone and report from a laptop.
- You have been bitten once by a cleared browser, or nearly were.
- Someone other than you starts using it.

Until then a calendar reminder to run Settings → Export is the honest
cost-equivalent.

## What is already in place

The groundwork is done and currently unused. It costs nothing to leave sitting
there, and it is what makes this a wiring job rather than a redesign.

- `userId` on every `Session` — `src/domain/types.ts`
- `syncState: 'clean' | 'pending' | 'deleted'` on every session and on the
  profile — `src/data/db.ts`
- `deletedAt` soft delete, never a hard delete — `src/data/repository.ts`
- `pendingSessions()`, already written, called by nothing — `src/data/repository.ts`
- Per-user database namespacing, `databaseNameFor(userId)` — `src/data/db.ts`
- Settings in a profile *record*, not localStorage, so they sync like any row
- `@supabase/supabase-js` already in `package.json`
- Screens import `repository.ts` and nothing below it, so the sync layer can be
  added underneath without touching a component

## Sequencing

### Step 1 — auth, with the app still usable signed out

Supabase Auth, email magic link (nothing to store, nothing to reset). Signing
in is framed as *back this up / add a device*, not as the price of entry.
`LOCAL_USER_ID` stays the default and the app keeps working with no account at
all.

This matters more than it sounds: the README promises a reading saves instantly
and survives a dead connection. That promise dies the moment a session check
stands between you and your own numbers. A login wall also makes the app useless
on a plane, which is exactly when a four-month history is most annoying to lose.

`src/main.tsx` opens the database before the first render, on purpose — no
component has to guard against a missing store or a missing profile. Keep that.
Resolve the session first, then `openDatabase(session?.user.id ?? LOCAL_USER_ID)`,
then `ensureProfile()`, then render. Do not move database opening into a hook.

### Step 2 — background sync

- **Push**: `pendingSessions()` → upsert → mark `clean`. Same for the profile.
- **Pull**: rows where `updatedAt > lastPulledAt`; store the watermark in the
  `meta` table (that is what it is for).
- **Conflicts**: last-write-wins on `updatedAt`. For a single person's own
  readings on two devices this is correct, not a compromise — the losing write
  is nearly always a stale echo of the same sitting.
- **Deletes**: already handled. Soft delete propagates; a hard delete would
  resurrect the row on the next pull from a device that had not heard about it.
- Sync runs in the background and never blocks a render. Dexie stays the source
  of truth the UI reads from; Supabase is a replica that catches up.

## The gotcha to plan around

`databaseNameFor()` means signing in opens `bp-tracker:<uuid>` — a **fresh,
empty database**. Every existing reading stays orphaned in `bp-tracker:local`
and the app goes blank the instant you sign in. From the user's chair that is
indistinguishable from data loss.

So first sign-in needs an explicit adoption step:

1. Open `bp-tracker:local` and read all sessions plus the profile.
2. Rewrite `userId` to the real id, write them into the new store as `pending`.
3. Push.
4. Only then drop the local database — and only after the push confirms.

The namespacing itself is right and should stay: it is what makes it impossible
(rather than merely unlikely) for two accounts on one browser to merge into one
history. It just has to ship with the migration, or step 1 looks like a bug.

Adopt once, and record that it happened in `meta` — a second adoption on a
later sign-in would duplicate every row.

## Schema sketch

Mirrors `StoredSession` minus `syncState`, which is local-only bookkeeping and
has no business on the server.

```sql
create table sessions (
  id            uuid primary key,
  user_id       uuid not null references auth.users on delete cascade,
  taken_at      timestamptz not null,
  period        text not null check (period in ('morning','evening','other')),
  arm           text check (arm in ('left','right')),
  readings      jsonb not null,
  avg_systolic  numeric not null,
  avg_diastolic numeric not null,
  avg_pulse     numeric,
  tags          text[] not null default '{}',
  notes         text,
  weight_kg     numeric,
  waist_cm      numeric,
  updated_at    timestamptz not null,
  deleted_at    timestamptz
);

create index on sessions (user_id, updated_at);

create table profiles (
  user_id          uuid primary key references auth.users on delete cascade,
  standard         text not null,
  target_systolic  int,
  target_diastolic int,
  tags             text[] not null default '{}',
  timezone         text,
  updated_at       timestamptz not null
);
```

RLS on both, no exceptions:

```sql
alter table sessions enable row level security;
alter table profiles enable row level security;

create policy own_sessions on sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy own_profile on profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

`readings` stays `jsonb` rather than becoming a child table. Nothing queries
inside it — every aggregate the app computes runs on `avg_systolic` /
`avg_diastolic`, and the CSV export reads the whole session anyway.

`weight_kg` and `waist_cm` are nullable and metric, matching Dexie. Both are
occasional measurements, so null is the common case rather than the exception,
and the unit lives in the column name for the same reason it does locally: a
column headed `weight` is how 78 kg becomes 78 lb on a settings change.

**No category, band, or "in target" column, ever.** Persisting one would break
the rule the whole design rests on: switching standards must reclassify history
retroactively. The server stores raw numbers and their averages, same as Dexie.

## Things that will be easy to get wrong

- **The anon key is not a secret and is not the protection.** It ships in the
  client by design. RLS is the only thing between accounts — if a policy is
  missing on one table, that table is world-readable to any authenticated user.
  Verify by querying as a second account, not by reading the policy.
- **Pick an EU region.** ESC is the default standard and the tests pin
  `TZ=Europe/Madrid`. Health data in an EU region, for boring GDPR reasons.
- **Add `.env` to `.gitignore` before writing one.** It currently covers
  `*.local` but not `.env`, and this repo is not under git yet — the first
  `git init` is exactly when that bites.
- **`updatedAt` must be set by the client, not by a database default.** A
  server-side `now()` on upsert would reorder writes that were made offline
  hours earlier and hand last-write-wins the wrong winner.
- **Do not sync `syncState`.** It describes this device's relationship to the
  server; a round trip would overwrite a pending local edit with `clean`.
- **Dexie live queries run in read-only transactions.** Same trap as
  `ensureProfile()` — the sync layer must never write from inside one.
- **Sign-out closes the database; it must not delete it.** A reading logged
  offline and not yet pushed would be destroyed by a wipe. `closeDatabase()`
  already gets this right; keep it that way, and keep the explicit destructive
  wipe in Settings as the only path that deletes.

## Still outstanding after this

Phase 4 — PWA install and service worker. Worth noting that *installing* the
app is also the thing that stops Safari evicting IndexedDB, so Phase 4 is a
partial substitute for Phase 2's durability argument, and a much cheaper one.
If the only motivation turns out to be "don't lose the data", do Phase 4 first.
