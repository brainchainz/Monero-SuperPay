import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { settings as settingsApi } from '../lib/api'
import LockScreen from '../components/LockScreen'

interface LockContextType {
  isLocked: boolean
  lock: () => void
  unlock: (pin: string) => Promise<boolean>
}

const LockContext = createContext<LockContextType | undefined>(undefined)

export function LockProvider({ children }: { children: ReactNode }) {
  const [isLocked, setIsLocked] = useState(false)
  const [pinHash, setPinHash] = useState<string | null>(null)
  const [checkingLock, setCheckingLock] = useState(true)

  // Load settings to check if PIN is set
  useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(),
  })

  // Initialize lock state from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('superpay_lock_pin_hash')
      setPinHash(stored)
    } catch (err) {
      console.error('Failed to load lock PIN from localStorage:', err)
    } finally {
      setCheckingLock(false)
    }
  }, [])

  // Listen for lock events
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

    // Simple hash comparison
    // In production, use proper password hashing (bcrypt, argon2, etc)
    const inputHash = await hashPin(pin)
    const isCorrect = inputHash === pinHash

    if (isCorrect) {
      setIsLocked(false)
    }

    return isCorrect
  }

  // Simple hash function for demonstration
  // In production, use proper password hashing on the backend
  async function hashPin(pin: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(pin)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  if (checkingLock) {
    return <>{children}</>
  }

  return (
    <LockContext.Provider value={{ isLocked, lock, unlock }}>
      <LockScreen isLocked={isLocked} onUnlock={unlock} />
      {children}
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
