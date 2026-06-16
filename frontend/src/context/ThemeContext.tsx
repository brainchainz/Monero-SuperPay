import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

export type Theme = 'glass' | 'classic' | 'carbon' | 'ocean' | 'fintech'

export const THEMES: { id: Theme; name: string; description: string }[] = [
  { id: 'glass', name: 'Glass', description: 'Crystal · color mesh through frost' },
  { id: 'classic', name: 'Classic', description: 'The original SuperPay dark' },
  { id: 'carbon', name: 'Carbon', description: 'Neutral graphite · minimal' },
  { id: 'ocean', name: 'Ocean', description: 'Deep blue · cyan accent' },
  { id: 'fintech', name: 'Fintech', description: 'Soft light · clean & bright' },
]

const STORAGE_KEY = 'superpay_theme'
const DEFAULT_THEME: Theme = 'glass'

export function getStoredTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && THEMES.some((t) => t.id === saved)) return saved as Theme
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_THEME
}

/** Apply a theme to <html> immediately. Safe to call before React mounts. */
export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme)

  useEffect(() => {
    applyTheme(theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeState }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
