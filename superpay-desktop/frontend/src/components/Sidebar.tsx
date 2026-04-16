import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Home,
  ShoppingCart,
  Package,
  Smartphone,
  Settings,
  Menu,
  X,
  Zap,
  Loader2,
  Wifi,
  WifiOff,
  Wallet,
  PieChart, // Added for Analytics icon
  Lock,
} from 'lucide-react'
import { wallet as walletApi } from '../lib/api'
import StoreSwitcher from './StoreSwitcher'
import { useLock } from '../context/LockContext'

const navItems = [
  { path: '/', label: 'Dashboard', icon: Home },
  { path: '/orders', label: 'Orders', icon: ShoppingCart },
  { path: '/analytics', label: 'Analytics', icon: PieChart },
  { path: '/products', label: 'Products', icon: Package },
  { path: '/devices', label: 'Devices', icon: Smartphone },
  { path: '/point-of-sale', label: 'Point of Sale', icon: Zap },
  { path: '/settings', label: 'Settings', icon: Settings },
]

export default function Sidebar() {
  const location = useLocation()
  const [isOpen, setIsOpen] = useState(false)
  const { hasPinSet } = useLock()

  const { data: walletStatus } = useQuery({
    queryKey: ['wallet-status'],
    queryFn: () => walletApi.status(),
    refetchInterval: 15000,
  })

  const daemonOnline = walletStatus?.daemon_connected ?? false
  const walletConnected = walletStatus?.configured ?? false
  const isSyncing = walletStatus?.syncing ?? false
  const blocksLeft = walletStatus?.blocks_to_sync ?? 0
  const walletHeight = walletStatus?.height ?? 0
  const daemonHeight = walletStatus?.daemon_height ?? 0

  const syncPct =
    isSyncing && daemonHeight > 0 && walletHeight > 0
      ? Math.min(99, Math.round((walletHeight / daemonHeight) * 100))
      : walletConnected && daemonOnline
        ? 100
        : 0

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="md:hidden fixed top-4 left-4 z-40 p-2 bg-gray-800 rounded-lg border border-gray-700"
      >
        {isOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 md:hidden z-30"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 h-screen w-64 bg-gray-800 border-r border-gray-700 transition-transform duration-300 ease-out z-40 md:translate-x-0 flex flex-col ${isOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
      >
        {/* Drag region — macOS traffic light buttons sit in this area */}
        <div className="pt-8 px-6 pb-4 border-b border-gray-700" style={{ '--wails-draggable': 'drag' } as React.CSSProperties}>
          <img
            src="/logo.png"
            alt="Monero SuperPay"
            className="w-full h-auto max-h-14 object-contain pointer-events-none"
          />
        </div>

        {/* Store Switcher */}
        <StoreSwitcher onStoreSwitch={() => setIsOpen(false)} />

        {/* Nav */}
        <nav className="p-4 space-y-2 flex-1 overflow-y-auto">
          {navItems.map(({ path, label, icon: Icon }) => (
            <Link
              key={path}
              to={path}
              onClick={() => setIsOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition ${location.pathname === path
                ? 'bg-monero-600 text-white'
                : 'text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
            >
              <Icon size={20} />
              <span className="font-medium">{label}</span>
            </Link>
          ))}
        </nav>

        {/* Lock Button — only visible when a PIN is configured */}
        {hasPinSet && (
          <div className="p-4 border-t border-gray-700">
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent('lock-app'))
              }}
              className="w-full flex items-center justify-center gap-2 p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition text-gray-300 hover:text-white text-sm"
              title="Lock app"
            >
              <Lock size={16} />
              Lock
            </button>
          </div>
        )}

        {/* Status Footer */}
        <div className="p-4 border-t border-gray-700 space-y-3">
          {/* Monero Node */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              {daemonOnline ? (
                <Wifi size={14} className="text-green-400" />
              ) : (
                <WifiOff size={14} className="text-gray-500" />
              )}
              <span className={daemonOnline ? 'text-gray-300' : 'text-gray-500'}>
                Node
              </span>
            </div>
            <span
              className={`text-xs font-medium ${daemonOnline ? 'text-green-400' : 'text-gray-500'
                }`}
            >
              {daemonOnline
                ? daemonHeight > 0
                  ? daemonHeight.toLocaleString()
                  : 'Connected'
                : 'Offline'}
            </span>
          </div>

          {/* Wallet */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              <Wallet
                size={14}
                className={walletConnected ? 'text-monero-400' : 'text-gray-500'}
              />
              <span className={walletConnected ? 'text-gray-300' : 'text-gray-500'}>
                {walletStatus?.filename
                  ? walletStatus.filename.length > 12
                    ? walletStatus.filename.slice(0, 12) + '…'
                    : walletStatus.filename
                  : 'Wallet'}
              </span>
            </div>
            {walletConnected ? (
              <span className="text-xs font-medium text-monero-400">
                {isSyncing ? (
                  <span className="flex items-center gap-1 text-yellow-400">
                    <Loader2 size={12} className="animate-spin" />
                    {syncPct}%
                  </span>
                ) : (
                  'Synced'
                )}
              </span>
            ) : (
              <Link
                to="/settings"
                onClick={() => setIsOpen(false)}
                className="text-xs text-yellow-400 hover:text-yellow-300"
              >
                Setup
              </Link>
            )}
          </div>

          {/* Sync progress bar */}
          {walletConnected && isSyncing && (
            <div className="space-y-1">
              <div className="w-full bg-gray-700 rounded-full h-1.5">
                <div
                  className="bg-yellow-500 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${syncPct}%` }}
                />
              </div>
              <p className="text-[10px] text-gray-500 text-right">
                {blocksLeft.toLocaleString()} blocks left
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* Main content margin */}
      <div className="md:ml-64" />
    </>
  )
}
