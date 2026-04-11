import { useState, useEffect } from 'react'
import { Lock, X } from 'lucide-react'

interface LockScreenProps {
  isLocked: boolean
  onUnlock: (pin: string) => Promise<boolean>
}

export default function LockScreen({ isLocked, onUnlock }: LockScreenProps) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [shake, setShake] = useState(false)

  useEffect(() => {
    if (!isLocked) {
      setPin('')
      setError('')
    }
  }, [isLocked])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pin.trim()) return

    setIsLoading(true)
    setError('')

    try {
      const success = await onUnlock(pin)
      if (!success) {
        setError('Incorrect PIN')
        setShake(true)
        setTimeout(() => setShake(false), 500)
        setPin('')
      }
    } catch (err) {
      setError('Error checking PIN')
      setPin('')
    } finally {
      setIsLoading(false)
    }
  }

  if (!isLocked) return null

  return (
    <div className="fixed inset-0 bg-gray-900 z-50 flex items-center justify-center">
      <div className={`flex flex-col items-center gap-8 ${shake ? 'animate-pulse' : ''}`}>
        {/* Logo */}
        <img
          src="/logo.png"
          alt="Monero SuperPay"
          className="w-32 h-auto max-h-32 object-contain"
        />

        {/* Locked Text */}
        <div className="flex flex-col items-center gap-2">
          <Lock size={48} className="text-monero-600" />
          <h1 className="text-3xl font-bold text-white">Locked</h1>
          <p className="text-gray-400 text-sm">Enter your PIN to unlock the app</p>
        </div>

        {/* PIN Input Form */}
        <form onSubmit={handleSubmit} className="w-64 space-y-4">
          <div>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={pin}
              onChange={(e) => {
                const value = e.target.value.replace(/[^0-9]/g, '')
                if (value.length <= 6) {
                  setPin(value)
                  if (error) setError('')
                }
              }}
              placeholder="••••"
              maxLength={6}
              className={`w-full px-4 py-3 text-center text-2xl font-bold tracking-widest bg-gray-800 border-2 rounded-lg transition ${
                error ? 'border-red-500' : 'border-gray-700 focus:border-monero-600'
              } text-white placeholder:text-gray-600 focus:outline-none`}
              autoFocus
              disabled={isLoading}
            />
          </div>

          {error && (
            <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg text-red-300 text-sm text-center flex items-center justify-center gap-2">
              <X size={16} />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!pin || isLoading}
            className="w-full px-4 py-2 bg-monero-600 hover:bg-monero-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition"
          >
            {isLoading ? 'Unlocking...' : 'Unlock'}
          </button>
        </form>

        {/* PIN indicator dots */}
        <div className="flex gap-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition ${
                i < pin.length ? 'bg-monero-600' : 'bg-gray-700'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
