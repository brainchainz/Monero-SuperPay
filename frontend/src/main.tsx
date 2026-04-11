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
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes
    },
  },
})

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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </React.StrictMode>
)
