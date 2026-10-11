import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { App } from './App'
import { openDatabase, LOCAL_USER_ID } from './data/db'
import { ensureProfile } from './data/repository'
import { currentAccount, ensureSignedIn, onAccountChange } from './data/auth'
import { adoptLocalHistory, startAutoSync, syncNow } from './data/sync'

/**
 * Boot order matters and is load-bearing.
 *
 * The session is resolved before the database opens, because which database to
 * open depends on who is signed in. Then the profile is created, because Dexie
 * runs live queries in read-only transactions and would throw on a write — so
 * no component can be allowed to be the first to need a profile row.
 *
 * Only then does anything render. Nothing here is moved into a hook: every
 * screen is written on the assumption that a store and a profile already exist.
 */
async function boot() {
  const root = document.getElementById('root')
  if (!root) throw new Error('Missing #root')

  // Before the session is read, so a configured single-user install is signed
  // in by the time the database name is chosen.
  await ensureSignedIn()
  const account = await currentAccount()
  const userId = account?.userId ?? LOCAL_USER_ID

  openDatabase(userId)
  await ensureProfile()

  // Signing in opens a fresh, empty store. This carries a pre-account history
  // across, and runs once per account.
  if (account) await adoptLocalHistory(account.userId)

  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )

  // After the first paint, never before it. A dead connection must cost nothing
  // but a late sync, and a failure here is not the user's problem to see.
  if (account) {
    void syncNow().catch(() => {})
    // From here on, a saved reading reaches the server without waiting for the
    // next load, and a reconnection retries whatever is still pending.
    startAutoSync()
  }

  // Signing in or out changes which database is the right one, and that is
  // decided in boot(). Reloading is how that decision gets made again — only
  // on a genuine identity change, or the initial session event would loop.
  onAccountChange(async () => {
    const next = await currentAccount()
    if ((next?.userId ?? LOCAL_USER_ID) !== userId) location.reload()
  })
}

void boot()
