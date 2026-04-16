import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import LockScreen from '../components/LockScreen'

interface LockContextType {
  isLocked: boolean
  hasPinSet: boolean
  lock: () => void
  unlock: (pin: string) => Promise<boolean>
  setPin: (newPin: string) => Promise<void>
  removePin: (currentPin: string) => Promise<boolean>
}

const LockContext = createContext<LockContextType | undefined>(undefined)

// Hash function for PIN — uses crypto.subtle when available (HTTPS/localhost),
// falls back to a simple hash for plain HTTP (e.g. Umbrel at http://umbrel.local)
async function hashPin(pin: string): Promise<string> {
  // crypto.subtle is only available in secure contexts (HTTPS or localhost)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder()
    const data = encoder.encode(pin)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  // Fallback: simple DJB2-based hash (good enough for a local UI PIN)
  let h1 = 5381
  let h2 = 52711
  for (let i = 0; i < pin.length; i++) {
    const c = pin.charCodeAt(i)
    h1 = ((h1 << 5) + h1 + c) >>> 0
    h2 = ((h2 << 5) + h2 + c) >>> 0
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

export function LockProvider({ children }: { children: ReactNode }) {
  const [isLocked, setIsLocked] = useState(false)
  const [pinHash, setPinHash] = useState<string | null>(null)
  const [checkingLock, setCheckingLock] = useState(true)

  // Initialize lock state from localStorage — auto-lock if a PIN is set
  useEffect(() => {
    try {
      const stored = localStorage.getItem('superpay_lock_pin_hash')
      setPinHash(stored)
      // Auto-lock on app load if a PIN has been configured
      if (stored) {
        setIsLocked(true)
      }
    } catch (err) {
      console.error('Failed to load lock PIN from localStorage:', err)
    } finally {
      setCheckingLock(false)
    }
  }, [])

  // Listen for lock events from the sidebar lock button
  useEffect(() => {
    const handleLockEvent = () => {
      if (pinHash) {
        setIsLocked(true)
      }
    }

    window.addEventListener('lock-app', handleLockEvent)
    return () => window.removeEventListener('lock-app', handleLockEvent)
  }, [pinHash])

  const lock = () => {
    if (pinHash) {
      setIsLocked(true)
    }
  }

  const unlock = async (pin: string): Promise<boolean> => {
    if (!pin || !pinHash) {
      return false
    }

    const inputHash = await hashPin(pin)
    const isCorrect = inputHash === pinHash

    if (isCorrect) {
      setIsLocked(false)
    }

    return isCorrect
  }

  const setPin = async (newPin: string): Promise<void> => {
    const newHash = await hashPin(newPin)
    localStorage.setItem('superpay_lock_pin_hash', newHash)
    setPinHash(newHash)
  }

  const removePin = async (currentPin: string): Promise<boolean> => {
    if (!pinHash) return true

    const inputHash = await hashPin(currentPin)
    if (inputHash !== pinHash) {
      return false
    }

    localStorage.removeItem('superpay_lock_pin_hash')
    setPinHash(null)
    setIsLocked(false)
    return true
  }

  const hasPinSet = !!pinHash

  // Always wrap in the provider so useLock() never throws,
  // even during the initial localStorage check.
  return (
    <LockContext.Provider value={{ isLocked, hasPinSet, lock, unlock, setPin, removePin }}>
      {checkingLock ? (
        <div className="min-h-screen bg-gray-900" />
      ) : (
        <>
          <LockScreen isLocked={isLocked} onUnlock={unlock} />
          {children}
        </>
      )}
    </LockContext.Provider>
  )
}

export function useLock() {
  const context = useContext(LockContext)
  if (context === undefined) {
    throw new Error('useLock must be used within a LockProvider')
  }
  return context
}
