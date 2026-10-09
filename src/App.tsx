import { useMemo } from 'react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Log } from './screens/Log'
import { Dashboard } from './screens/Dashboard'
import { History } from './screens/History'
import { Report } from './screens/Report'
import { Settings } from './screens/Settings'
import { useProfile, useSessions } from './data/hooks'
import { currentUserId, LOCAL_USER_ID } from './data/db'
import { isSyncConfigured } from './data/supabase'
import { useTheme } from './data/useTheme'
import { formatDate } from './domain/format'
import { sessionsToCsv, downloadFile } from './data/export'
import { toIsoDay } from './domain/format'

/**
 * App shell, following the "Instrument" artboard: a nav rail plus a status top
 * bar on desktop, collapsing to the bottom tab bar on phones. Dashboard sits at
 * `/` — opening the app to your current numbers answers the question you had
 * before you opened it.
 */
const TABS = [
  { to: '/', label: 'Dashboard', short: 'HOME', icon: 'M4 18l5-6 4 3 6-8', end: true },
  { to: '/log', label: 'Log a sitting', short: 'LOG', icon: 'M12 5v14M5 12h14', end: false },
  {
    to: '/history',
    label: 'History',
    short: 'HISTORY',
    icon: 'M4 6h16M4 12h16M4 18h10',
    end: false,
  },
  {
    to: '/report',
    label: 'Doctor report',
    short: 'REPORT',
    icon: 'M7 3h7l5 5v13H7zM14 3v5h5',
    end: false,
  },
  {
    to: '/settings',
    label: 'Settings',
    short: 'SETUP',
    icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM4 12h2m12 0h2M12 4v2m0 12v2',
    end: false,
  },
]

export function App() {
  const sessions = useSessions()
  const { standard, target } = useProfile()
  const theme = useTheme()
  const location = useLocation()
  const navigate = useNavigate()

  const stats = useMemo(() => {
    if (!sessions || sessions.length === 0) return null
    const readings = sessions.reduce((n, s) => n + s.readings.length, 0)
    // The list is newest-first, so the last row is the earliest reading.
    const first = sessions[sessions.length - 1]
    return {
      sittings: sessions.length,
      readings,
      since: first ? new Date(first.takenAt) : null,
    }
  }, [sessions])

  const counts: Record<string, string> = {
    '/history': sessions && sessions.length > 0 ? String(sessions.length) : '',
  }

  const current = TABS.find((t) =>
    t.end ? location.pathname === t.to : location.pathname.startsWith(t.to),
  )
  const goal = target ?? standard.homeThreshold

  // Read straight rather than hooked: boot() resolves the account before
  // anything mounts, and a genuine identity change reloads the page, so this
  // cannot go stale while mounted.
  const syncLabel = !isSyncConfigured
    ? 'not configured'
    : currentUserId() === LOCAL_USER_ID
      ? 'signed out'
      : 'on'

  return (
    <div className="app">
      <nav className="nav">
        <div className="rail-head">
          {/* The favicon's gauge, inlined rather than loaded from /favicon.svg
              so it follows the in-app theme toggle through the tokens instead
              of the OS colour scheme, which is all an <img> would see. */}
          <div className="rail-brand">
            <svg
              className="rail-mark"
              viewBox="0 0 32 32"
              fill="none"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path stroke="var(--dia-line)" d="M6.031 23.849A11 11 0 1 1 26.625 16.353" />
              <path stroke="var(--tone-high-dot)" d="M26.625 16.353A11 11 0 0 1 25.969 23.849" />
              <path stroke="var(--sys-line)" d="M16 19.2 21.193 10.889" />
              <circle cx="16" cy="19.2" r="2.9" fill="var(--sys-line)" />
            </svg>
            <div className="eyebrow">BP Tracker</div>
          </div>
          <div className="rail-title">Personal log</div>
          <div className="rail-badge">
            {standard.format.flag} {standard.shortName} · ≥{goal.systolic}/{goal.diastolic}
          </div>
        </div>

        <div className="nav-links">
          {TABS.map((tab) => (
            <NavLink key={tab.to} to={tab.to} end={tab.end}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={tab.icon} />
              </svg>
              <span className="nav-label-full">{tab.label}</span>
              <span className="nav-label-short">{tab.short}</span>
              <span className="nav-count">{counts[tab.to] ?? ''}</span>
            </NavLink>
          ))}
        </div>

        {/* The storage line is not decoration: this app keeps everything in the
            browser, and that is worth stating where it cannot be missed. */}
        <div className="rail-foot">
          <div>LOCAL · IndexedDB</div>
          <div>SYNC · {syncLabel}</div>
          <div>{stats ? `${stats.readings} READINGS STORED` : 'NO READINGS YET'}</div>
        </div>
      </nav>

      <div className="shell">
        <div className="topbar no-print">
          <div className="topbar-screen">{current?.label ?? 'BP Tracker'}</div>
          <div className="topbar-stats">
            {stats
              ? `${stats.sittings} sittings · ${stats.readings} readings${
                  stats.since ? ` · since ${formatDate(stats.since, standard)}` : ''
                }`
              : 'No readings yet'}
          </div>
          <div className="topbar-actions">
            <button
              className="btn-mono"
              onClick={theme.cycle}
              title="Light, dark, or follow the system"
            >
              <span className={`theme-dot theme-${theme.choice}`} />
              {theme.label}
            </button>
            <button
              className="btn-mono"
              disabled={!sessions || sessions.length === 0}
              onClick={() =>
                downloadFile(
                  `bp-tracker-${toIsoDay(new Date())}.csv`,
                  sessionsToCsv(sessions ?? []),
                  'text/csv',
                )
              }
            >
              CSV
            </button>
            <button className="btn-accent-sm" onClick={() => navigate('/log')}>
              + Sitting
            </button>
          </div>
        </div>

        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/log" element={<Log />} />
          <Route path="/log/:id" element={<Log />} />
          <Route path="/history" element={<History />} />
          <Route path="/report" element={<Report />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </div>
    </div>
  )
}
