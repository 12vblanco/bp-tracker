import { useCallback, useEffect, useState } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'bp-tracker:theme'

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    // Private browsing and locked-down storage settings both throw here.
    return 'system'
  }
}

/**
 * Light / dark / follow-the-system.
 *
 * `system` stamps no attribute at all, which is what lets the CSS
 * `prefers-color-scheme` block stay in charge; the explicit choices stamp
 * `data-theme` so the toggle beats the OS in both directions.
 */
export function useTheme(): { choice: ThemeChoice; label: string; cycle: () => void } {
  const [choice, setChoice] = useState<ThemeChoice>(read)

  useEffect(() => {
    const root = document.documentElement
    if (choice === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', choice)
    try {
      if (choice === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, choice)
    } catch {
      // Not being able to remember the choice is not a reason to fail to apply it.
    }
  }, [choice])

  const cycle = useCallback(() => {
    setChoice((c) => (c === 'system' ? 'light' : c === 'light' ? 'dark' : 'system'))
  }, [])

  return { choice, label: choice.toUpperCase(), cycle }
}
