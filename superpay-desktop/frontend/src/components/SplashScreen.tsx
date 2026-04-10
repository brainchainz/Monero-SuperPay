import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * SplashScreen — Plays the opening animation on app launch.
 *
 * Supports two animation sources (checked in order):
 *   1. Lottie JSON  →  /splash.json   (vector, best quality)
 *   2. WebM video   →  /splash.webm   (fallback for video-based animations)
 *
 * If neither file exists the splash is skipped instantly.
 *
 * Props:
 *   onComplete  — called when the animation finishes (or is skipped)
 *   minDuration — minimum ms to show splash even if animation is shorter (default 2000)
 */

interface SplashScreenProps {
  onComplete: () => void
  minDuration?: number
}

export default function SplashScreen({ onComplete, minDuration = 2000 }: SplashScreenProps) {
  const [fadeOut, setFadeOut] = useState(false)
  const [mode, setMode] = useState<'lottie' | 'video' | 'skip' | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const lottieContainer = useRef<HTMLDivElement>(null)
  const startTime = useRef(Date.now())

  // Finish handler — ensures minimum duration, then fades out
  const finish = useCallback(() => {
    const elapsed = Date.now() - startTime.current
    const remaining = Math.max(0, minDuration - elapsed)

    setTimeout(() => {
      setFadeOut(true)
      setTimeout(onComplete, 500) // matches CSS fade-out duration
    }, remaining)
  }, [minDuration, onComplete])

  // Detect which asset is available
  useEffect(() => {
    let cancelled = false

    async function detect() {
      // Try Lottie first
      // Use GET (not HEAD) and check content-type because Wails asset server
      // returns 200 + index.html for unknown paths (SPA fallback).
      try {
        const res = await fetch('/splash.json', { method: 'GET' })
        const ct = res.headers.get('content-type') || ''
        if (res.ok && ct.includes('json') && !cancelled) {
          setMode('lottie')
          return
        }
      } catch { /* not found */ }

      // Try WebM
      try {
        const res = await fetch('/splash.webm', { method: 'GET' })
        const ct = res.headers.get('content-type') || ''
        if (res.ok && ct.includes('video') && !cancelled) {
          setMode('video')
          return
        }
      } catch { /* not found */ }

      // Neither found — skip splash
      if (!cancelled) setMode('skip')
    }

    detect()
    return () => { cancelled = true }
  }, [])

  // Skip immediately if no assets
  useEffect(() => {
    if (mode === 'skip') onComplete()
  }, [mode, onComplete])

  // Load Lottie dynamically (avoids bundling if not used)
  useEffect(() => {
    if (mode !== 'lottie' || !lottieContainer.current) return

    let anim: any = null

    import('lottie-web').then((lottie) => {
      if (!lottieContainer.current) return
      anim = lottie.default.loadAnimation({
        container: lottieContainer.current,
        renderer: 'svg',
        loop: false,
        autoplay: true,
        path: '/splash.json',
      })
      anim.addEventListener('complete', finish)
      // Safety: if the JSON fails to load/parse, lottie fires data_failed
      anim.addEventListener('data_failed', finish)
    }).catch(() => {
      // lottie-web not installed — fall through to skip
      finish()
    })

    return () => {
      if (anim) {
        anim.removeEventListener('complete', finish)
        anim.destroy()
      }
    }
  }, [mode, finish])

  // Video end handler
  useEffect(() => {
    if (mode !== 'video') return
    const v = videoRef.current
    if (!v) return

    v.addEventListener('ended', finish)
    v.addEventListener('error', finish)
    v.play().catch(finish)

    return () => {
      v.removeEventListener('ended', finish)
      v.removeEventListener('error', finish)
    }
  }, [mode, finish])

  // Don't render anything if skipping
  if (mode === null || mode === 'skip') return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#0e0e0e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: fadeOut ? 0 : 1,
        transition: 'opacity 0.5s ease-out',
      }}
    >
      {mode === 'lottie' && (
        <div
          ref={lottieContainer}
          style={{ width: '60vw', maxWidth: 800, maxHeight: '80vh' }}
        />
      )}

      {mode === 'video' && (
        <video
          ref={videoRef}
          muted
          playsInline
          style={{ width: '60vw', maxWidth: 800, maxHeight: '80vh', objectFit: 'contain' }}
        >
          <source src="/splash.webm" type="video/webm" />
        </video>
      )}
    </div>
  )
}
