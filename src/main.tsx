import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { App } from './App'
import { openDatabase, LOCAL_USER_ID } from './data/db'
import { ensureProfile } from './data/repository'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')

// Opened and seeded before the first render, so no component has to guard
// against a missing database or a missing profile row. The profile has to be
// created here rather than lazily in a hook: Dexie's live queries run in
// read-only transactions and throw on a write.
//
// Phase 2 replaces the fixed id with the signed-in user's, which swaps the
// whole store rather than filtering it.
openDatabase(LOCAL_USER_ID)

void ensureProfile().then(() => {
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
})
