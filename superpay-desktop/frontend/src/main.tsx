import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import Dashboard from './pages/Dashboard'
import Orders from './pages/Orders'
import Products from './pages/Products'
import Devices from './pages/Devices'
import PointOfSale from './pages/PointOfSale'
import Settings from './pages/Settings'
import PosTerminal from './pages/PosTerminal'
import OrderMonitor from './pages/OrderMonitor'
import Analytics from './pages/Analytics'
import SplashScreen from './components/SplashScreen'
import { markApiReady, cacheApiBase } from './lib/api'
import { ThemeProvider, applyTheme, getStoredTheme } from './context/ThemeContext'
import './index.css'

// Apply the saved theme synchronously, before first paint, to avoid a flash.
applyTheme(getStoredTheme())

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes
    },
  },
})

// Wait for Wails runtime to be available (it's injected asynchronously)
function waitForWailsRuntime(maxWaitMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    if ((window as any).go?.main?.App?.GetServerURL) {
      resolve(true)
      return
    }
    const start = Date.now()
    const check = setInterval(() => {
      if ((window as any).go?.main?.App?.GetServerURL) {
        clearInterval(check)
        resolve(true)
      } else if (Date.now() - start > maxWaitMs) {
        clearInterval(check)
        resolve(false) // Not in Wails, or runtime didn't load
      }
    }, 50)
  })
}

function Root() {
  const [splashDone, setSplashDone] = useState(false)

  return (
    <>
      {!splashDone && <SplashScreen onComplete={() => setSplashDone(true)} />}
      <div style={{ opacity: splashDone ? 1 : 0, transition: 'opacity 0.3s ease-in' }}>
        <BrowserRouter>
          <Routes>
            {/* Device PoS terminal - standalone, no sidebar/admin chrome */}
            <Route path="/pos" element={<PosTerminal />} />

            {/* Order Monitor - standalone kitchen/counter view */}
            <Route path="/monitor" element={<OrderMonitor />} />

            {/* Admin dashboard - with sidebar */}
            <Route element={<App />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/products" element={<Products />} />
              <Route path="/devices" element={<Devices />} />
              <Route path="/point-of-sale" element={<PointOfSale />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </div>
    </>
  )
}

// Initialize API base URL for Wails mode
async function initApp() {
  try {
    const wailsReady = await waitForWailsRuntime()
    if (wailsReady) {
      const serverURL = await (window as any).go.main.App.GetServerURL()
      if (serverURL) {
        cacheApiBase(serverURL + '/api')
        console.log('[SuperPay] API base:', serverURL + '/api')
      }
    } else {
      console.log('[SuperPay] Not in Wails mode, using relative URLs')
    }
  } catch (e) {
    console.log('[SuperPay] Failed to get server URL:', e)
  }

  // Mark API as ready — queries can now fire
  markApiReady()

  // Now render the app
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <Root />
        </QueryClientProvider>
      </ThemeProvider>
    </React.StrictMode>
  )
}

initApp()
