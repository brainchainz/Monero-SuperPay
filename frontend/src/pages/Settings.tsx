import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle, Wallet, Eye, Server, Globe, Wifi, Shield, XCircle, Loader2, Download, Upload, Edit2, Trash2, Package, Lock } from 'lucide-react'
import Card from '../components/Card'
import { settings as settingsApi, wallet as walletApi, stores as storesApi, node as nodeApi, getApiBase } from '../lib/api'
import { Store } from '../lib/types'
import { useLock } from '../context/LockContext'
import { useTheme, THEMES, Theme } from '../context/ThemeContext'
import { Palette, Check } from 'lucide-react'
// BrowserOpenURL — use Wails runtime if available, otherwise window.open
const BrowserOpenURL = (url: string) => {
  if ((window as any).runtime?.BrowserOpenURL) {
    ;(window as any).runtime.BrowserOpenURL(url)
  } else {
    window.open(url, '_blank')
  }
}

const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'AUD', 'CAD', 'CHF', 'SEK', 'NZD']

// Preview swatches for the Appearance theme selector (mirror src/index.css palettes)
const THEME_SWATCH: Record<string, { bg: string; chip: string; bar: string; bar2: string }> = {
  glass: {
    bg: 'radial-gradient(70px 50px at 12% 8%, rgba(255,102,0,.7), transparent 70%), radial-gradient(70px 50px at 92% 18%, rgba(122,59,255,.6), transparent 70%), radial-gradient(80px 60px at 45% 115%, rgba(255,45,120,.6), transparent 70%), #0a0a0f',
    chip: 'linear-gradient(135deg, #ff6600, #ff8a3d)',
    bar: 'rgba(255,255,255,.6)', bar2: 'rgba(255,255,255,.25)',
  },
  classic: {
    bg: '#1f2937', chip: '#ff6600',
    bar: 'rgba(255,255,255,.55)', bar2: 'rgba(255,255,255,.22)',
  },
  carbon: {
    bg: 'radial-gradient(120px 80px at 50% 0%, rgba(255,122,24,.16), transparent), #171719',
    chip: 'linear-gradient(135deg, #ff7a18, #ffa64d)',
    bar: 'rgba(255,255,255,.5)', bar2: 'rgba(255,255,255,.2)',
  },
  ocean: {
    bg: 'radial-gradient(120px 80px at 20% 0%, rgba(34,211,184,.22), transparent), #11192b',
    chip: 'linear-gradient(135deg, #22d3b8, #38bdf8)',
    bar: 'rgba(180,210,255,.55)', bar2: 'rgba(120,160,230,.3)',
  },
  fintech: {
    bg: '#f4f5f7', chip: 'linear-gradient(135deg, #ff7a18, #ff6600)',
    bar: 'rgba(20,24,40,.4)', bar2: 'rgba(20,24,40,.16)',
  },
}

export default function Settings() {
  const { theme, setTheme } = useTheme()
  const [formData, setFormData] = useState({
    business_name: '',
    fiat_currency: 'USD',
    tax_rate: 8,
    confirmation_threshold: 0,
    tailscale_ip: '',
    tor_address: '',
    show_prices_in_xmr: 'true',
    show_fiat_price: 'true',
  })

  const [walletForm, setWalletForm] = useState({
    primary_address: '',
    secret_view_key: '',
    restore_height: 0,
    wallet_name: '',
  })
  const [showViewKey, setShowViewKey] = useState(false)

  // PIN Lock state
  const { hasPinSet, setPin: saveLockPin, removePin: removeLockPin } = useLock()
  const [showSetPinModal, setShowSetPinModal] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinRemoveInput, setPinRemoveInput] = useState('')
  const [showRemovePinModal, setShowRemovePinModal] = useState(false)
  const [pinError, setPinError] = useState('')
  const [pinSuccess, setPinSuccess] = useState('')

  // Store management state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [showCreateStoreModal, setShowCreateStoreModal] = useState(false)
  const [newStoreName, setNewStoreName] = useState('')
  const [newStoreDescription, setNewStoreDescription] = useState('')
  const [createStoreError, setCreateStoreError] = useState('')
  const [editingStore, setEditingStore] = useState<Store | null>(null)
  const [editStoreName, setEditStoreName] = useState('')
  const [editStoreDescription, setEditStoreDescription] = useState('')
  const [importingStore, setImportingStore] = useState(false)
  const [importError, setImportError] = useState('')
  const [importSuccess, setImportSuccess] = useState('')

  // Manual node picker state
  const [showNodePicker, setShowNodePicker] = useState(false)
  const [nodeType, setNodeType] = useState<'public' | 'custom' | 'tor'>('public')
  const [nodeAddress, setNodeAddress] = useState('xmr-node.cakewallet.com:18081')
  const [nodeUser, setNodeUser] = useState('')
  const [nodePass, setNodePass] = useState('')
  const [savedNodes, setSavedNodes] = useState<string[]>([])
  const [testResult, setTestResult] = useState<{ connected: boolean; height?: number; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [connecting, setConnecting] = useState(false)

  const queryClient = useQueryClient()

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(),
  })

  const { data: walletStatus } = useQuery({
    queryKey: ['wallet-status'],
    queryFn: () => walletApi.status(),
    refetchInterval: 15000, // poll every 15s
  })

  const { data: walletFiles } = useQuery({
    queryKey: ['wallet-files'],
    queryFn: () => walletApi.list(),
  })

  const { data: nodeStatusData } = useQuery({
    queryKey: ['node-status'],
    queryFn: () => nodeApi.status(),
    refetchInterval: 30000, // poll every 30s
  })

  const { data: storesData } = useQuery({
    queryKey: ['stores'],
    queryFn: () => storesApi.list(),
  })
  const storeList = storesData?.stores || []
  const activeStoreId = storesData?.active_store_id

  const updateSettingsMutation = useMutation({
    mutationFn: (data: Partial<import('../lib/types').Settings>) => settingsApi.update(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  const walletSetupMutation = useMutation({
    mutationFn: walletApi.setup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallet-status'] })
      queryClient.invalidateQueries({ queryKey: ['wallet-files'] })
      setWalletForm({ primary_address: '', secret_view_key: '', restore_height: 0, wallet_name: '' })
    },
  })

  const createStoreMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) => storesApi.create(data),
    onSuccess: () => {
      setNewStoreName('')
      setNewStoreDescription('')
      setCreateStoreError('')
      setShowCreateStoreModal(false)
      queryClient.invalidateQueries({ queryKey: ['stores'] })
    },
    onError: (error: any) => {
      setCreateStoreError(error?.message || 'Failed to create store')
    },
  })

  const updateStoreMutation = useMutation({
    mutationFn: (data: { id: string; name: string; description?: string }) =>
      storesApi.update(data.id, { name: data.name, description: data.description }),
    onSuccess: () => {
      setEditingStore(null)
      setEditStoreName('')
      setEditStoreDescription('')
      queryClient.invalidateQueries({ queryKey: ['stores'] })
    },
  })

  const deleteStoreMutation = useMutation({
    mutationFn: (id: string) => storesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stores'] })
    },
  })

  const switchStoreMutation = useMutation({
    mutationFn: (id: string) => storesApi.switch(id),
    onSuccess: () => {
      // Invalidate all queries to refresh data from the new store's DB
      queryClient.invalidateQueries()
      // Small delay to ensure backend has finished the switch before refetching
      setTimeout(() => queryClient.refetchQueries(), 300)
    },
  })

  useEffect(() => {
    if (settingsData) {
      setFormData({
        business_name: settingsData.business_name || '',
        fiat_currency: settingsData.fiat_currency || 'USD',
        tax_rate: settingsData.tax_rate || 0,
        confirmation_threshold: settingsData.confirmation_threshold || 0,
        tailscale_ip: settingsData.tailscale_ip || '',
        tor_address: settingsData.tor_address || '',
        show_prices_in_xmr: settingsData.show_prices_in_xmr !== false ? 'true' : 'false',
        show_fiat_price: settingsData.show_fiat_price !== false ? 'true' : 'false',
      })

      // Load node connection settings if user has overridden
      if (settingsData.monero_node_url) {
        setNodeAddress(settingsData.monero_node_url)
        setNodeUser(settingsData.monero_node_user || '')
        setNodePass(settingsData.monero_node_pass || '')
      }
      if (settingsData.monero_node_type) {
        setNodeType(settingsData.monero_node_type as 'public' | 'custom' | 'tor')
      } else if (settingsData.monero_node_url) {
        const url = settingsData.monero_node_url
        if (url.includes('.onion')) {
          setNodeType('tor')
        } else if (
          url.includes('cakewallet.com') ||
          url.includes('moneroworld.com') ||
          url.includes('sethforprivacy.com') ||
          url.includes('hashvault.pro')
        ) {
          setNodeType('public')
        } else {
          setNodeType('custom')
        }
      }

      // Load saved custom nodes from localStorage
      const saved = localStorage.getItem('superpay_saved_nodes')
      if (saved) {
        try { setSavedNodes(JSON.parse(saved)) } catch {}
      }
    }
  }, [settingsData])

  const handleSubmit = () => {
    updateSettingsMutation.mutate(formData as any)
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const response = await fetch(getApiBase() + '/node/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: nodeAddress,
          username: nodeUser,
          password: nodePass,
        }),
      })
      const json = await response.json()
      const result = json.data || json
      if (response.ok && result.connected) {
        setTestResult({ connected: true, height: result.height })
      } else {
        setTestResult({ connected: false, error: result.error || json.error || 'Connection failed' })
      }
    } catch (err) {
      setTestResult({ connected: false, error: (err as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const handleSaveNodeConnection = async () => {
    setConnecting(true)
    try {
      const response = await fetch(getApiBase() + '/node/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: nodeAddress,
          username: nodeUser,
          password: nodePass,
          type: nodeType,
        }),
      })
      const json = await response.json()
      const result = json.data || json
      if (response.ok) {
        await queryClient.invalidateQueries({ queryKey: ['settings'] })
        await queryClient.invalidateQueries({ queryKey: ['wallet-status'] })
        await queryClient.invalidateQueries({ queryKey: ['node-status'] })
        setTestResult({ connected: true, height: testResult?.height })
      } else {
        setTestResult({ connected: false, error: result.error || 'Failed to save node settings' })
      }
    } catch (err) {
      setTestResult({ connected: false, error: (err as Error).message })
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold mb-2">Settings</h1>
        <p className="text-gray-400">Manage your business configuration</p>
      </div>

      {/* Appearance / Theme */}
      <Card>
        <h2 className="text-lg font-bold mb-2 flex items-center gap-2">
          <Palette size={20} />
          Appearance
        </h2>
        <p className="text-sm text-gray-400 mb-5">
          Choose a theme. Changes apply instantly and are remembered on this device.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {THEMES.map((t) => {
            const selected = theme === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTheme(t.id as Theme)}
                className={`relative text-left rounded-xl p-3 border-2 transition ${
                  selected
                    ? 'border-monero-600 ring-2 ring-monero-600/40'
                    : 'border-gray-700 hover:border-gray-500'
                }`}
              >
                {selected && (
                  <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-monero-600 text-white flex items-center justify-center">
                    <Check size={12} strokeWidth={3} />
                  </span>
                )}
                <div
                  className="h-14 rounded-lg mb-2.5 relative overflow-hidden border border-gray-700"
                  style={{ background: THEME_SWATCH[t.id].bg }}
                >
                  <span
                    className="absolute left-2 right-2 top-3 h-1.5 rounded"
                    style={{ background: THEME_SWATCH[t.id].bar }}
                  />
                  <span
                    className="absolute left-2 top-6 h-1.5 w-1/2 rounded"
                    style={{ background: THEME_SWATCH[t.id].bar2 }}
                  />
                  <span
                    className="absolute right-2 bottom-2 w-6 h-6 rounded-md"
                    style={{ background: THEME_SWATCH[t.id].chip }}
                  />
                </div>
                <p className="text-sm font-semibold">{t.name}</p>
                <p className="text-[11px] text-gray-500 leading-tight mt-0.5">{t.description}</p>
              </button>
            )
          })}
        </div>
      </Card>

      {/* Business Settings */}
      <Card>
        <h2 className="text-lg font-bold mb-6">Business Information</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Business Name</label>
            <input
              type="text"
              value={formData.business_name}
              onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
              placeholder="Your business name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Fiat Currency</label>
            <select
              value={formData.fiat_currency}
              onChange={(e) => setFormData({ ...formData, fiat_currency: e.target.value })}
              className="w-24"
            >
              {currencies.map((curr) => (
                <option key={curr} value={curr}>
                  {curr}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-3">Price Display</label>
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={formData.show_fiat_price === 'true'}
                    onChange={(e) => setFormData({ ...formData, show_fiat_price: e.target.checked ? 'true' : 'false' })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-monero-600 peer-checked:after:bg-[#fff]" />
                </div>
                <span className="text-sm text-gray-300">Show fiat prices</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={formData.show_prices_in_xmr === 'true'}
                    onChange={(e) => setFormData({ ...formData, show_prices_in_xmr: e.target.checked ? 'true' : 'false' })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-monero-600 peer-checked:after:bg-[#fff]" />
                </div>
                <span className="text-sm text-gray-300">Show XMR prices</span>
              </label>
            </div>
            <p className="text-xs text-gray-400 mt-2">Control which price formats are shown in PoS and Products.</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Tax Rate (%)
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={formData.tax_rate}
              onChange={(e) => setFormData({ ...formData, tax_rate: parseFloat(e.target.value) })}
            />
            <p className="text-xs text-gray-400 mt-1">Applied to all orders</p>
          </div>

          {/* Remote Access */}
          <div className="pt-4 border-t border-gray-700">
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-4">Remote Device Access</h3>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Umbrel's Tailscale IP <span className="text-gray-500">(optional)</span>
            </label>
            <input
              type="text"
              value={formData.tailscale_ip}
              onChange={(e) => setFormData({ ...formData, tailscale_ip: e.target.value })}
              placeholder="e.g., 100.64.0.5"
            />
            <p className="text-xs text-gray-400 mt-1">
              Click the Tailscale icon in your menu bar, then click "This Device" to copy this computer's Tailscale IP and paste it here.
              PoS devices on your Tailscale network can connect remotely. Install Tailscale on your Android or iOS device.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              This Computer's Tor .onion Address <span className="text-gray-500">(optional)</span>
            </label>
            <input
              type="text"
              value={formData.tor_address}
              onChange={(e) => setFormData({ ...formData, tor_address: e.target.value })}
              placeholder="e.g., abc123...xyz.onion"
            />
            <p className="text-xs text-gray-400 mt-1">
              Your Tor hidden service address for this app. PoS devices with Orbot can connect over Tor.
            </p>
          </div>

          <div className="pt-4 border-t border-gray-700">
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-4">Payment</h3>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Confirmation Threshold
            </label>
            <select
              value={formData.confirmation_threshold}
              onChange={(e) =>
                setFormData({ ...formData, confirmation_threshold: parseInt(e.target.value) })
              }
            >
              <option value={0}>0 - Unconfirmed</option>
              <option value={1}>1 - Standard</option>
              <option value={10}>10 - High Security</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Number of blockchain confirmations required to mark order as paid
            </p>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={updateSettingsMutation.isPending}
            className="mt-6 px-6 py-2 bg-monero-600 hover:bg-monero-700 disabled:opacity-50 rounded-lg font-medium transition"
          >
            {updateSettingsMutation.isPending ? 'Saving...' : 'Save Settings'}
          </button>

          {updateSettingsMutation.isSuccess && (
            <div className="p-3 bg-green-900/30 border border-green-700 rounded-lg text-green-200 text-sm">
              Settings saved successfully!
            </div>
          )}

          {updateSettingsMutation.isError && (
            <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-sm">
              Failed to save settings
            </div>
          )}
        </div>
      </Card>

      {/* PIN Lock */}
      <Card>
        <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
          <Lock size={20} />
          PIN Lock
        </h2>

        {hasPinSet ? (
          <div className="space-y-4">
            <div className="p-4 bg-green-900/20 border border-green-700 rounded-lg flex items-center gap-3">
              <Lock size={18} className="text-green-400" />
              <div>
                <p className="text-sm font-medium text-green-300">PIN lock is active</p>
                <p className="text-xs text-gray-400">The app will require your PIN on launch and when locked from the sidebar.</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowSetPinModal(true)
                  setPinInput('')
                  setPinConfirm('')
                  setPinError('')
                  setPinSuccess('')
                }}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white text-sm font-medium transition"
              >
                Change PIN
              </button>
              <button
                onClick={() => {
                  setShowRemovePinModal(true)
                  setPinRemoveInput('')
                  setPinError('')
                  setPinSuccess('')
                }}
                className="flex-1 px-4 py-2 bg-red-900/30 border border-red-700 hover:bg-red-900/50 rounded-lg text-red-200 text-sm font-medium transition"
              >
                Remove PIN
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">
              Set a 4-6 digit PIN to lock the app. You'll need to enter it when the app opens and when you lock it from the sidebar.
            </p>
            <button
              onClick={() => {
                setShowSetPinModal(true)
                setPinInput('')
                setPinConfirm('')
                setPinError('')
                setPinSuccess('')
              }}
              className="w-full px-4 py-2 bg-monero-600 hover:bg-monero-700 rounded-lg text-white font-medium transition flex items-center justify-center gap-2"
            >
              <Lock size={16} />
              Set PIN
            </button>
          </div>
        )}

        {pinSuccess && (
          <div className="mt-4 p-3 bg-green-900/30 border border-green-700 rounded-lg text-green-200 text-sm flex items-center gap-2">
            <CheckCircle size={16} />
            {pinSuccess}
          </div>
        )}
      </Card>

      {/* Set / Change PIN Modal */}
      {showSetPinModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm">
            <h2 className="text-xl font-bold mb-4">{hasPinSet ? 'Change PIN' : 'Set PIN'}</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                setPinError('')
                if (pinInput.length < 4 || pinInput.length > 6) {
                  setPinError('PIN must be 4-6 digits')
                  return
                }
                if (pinInput !== pinConfirm) {
                  setPinError('PINs do not match')
                  return
                }
                await saveLockPin(pinInput)
                setShowSetPinModal(false)
                setPinSuccess('PIN set successfully')
                setTimeout(() => setPinSuccess(''), 3000)
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium mb-2">New PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={pinInput}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, '')
                    if (v.length <= 6) setPinInput(v)
                    if (pinError) setPinError('')
                  }}
                  placeholder="4-6 digits"
                  maxLength={6}
                  className="w-full px-4 py-3 text-center text-2xl font-bold tracking-widest bg-gray-800 border border-gray-700 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:border-monero-600"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Confirm PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={pinConfirm}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, '')
                    if (v.length <= 6) setPinConfirm(v)
                    if (pinError) setPinError('')
                  }}
                  placeholder="Repeat PIN"
                  maxLength={6}
                  className="w-full px-4 py-3 text-center text-2xl font-bold tracking-widest bg-gray-800 border border-gray-700 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:border-monero-600"
                />
              </div>

              {pinError && (
                <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg text-red-300 text-sm text-center">
                  {pinError}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSetPinModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pinInput.length < 4 || pinConfirm.length < 4}
                  className="flex-1 px-4 py-2 bg-monero-600 hover:bg-monero-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-white font-medium transition"
                >
                  Save
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Remove PIN Modal */}
      {showRemovePinModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm">
            <h2 className="text-xl font-bold mb-4">Remove PIN</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                setPinError('')
                const success = await removeLockPin(pinRemoveInput)
                if (success) {
                  setShowRemovePinModal(false)
                  setPinSuccess('PIN removed')
                  setTimeout(() => setPinSuccess(''), 3000)
                } else {
                  setPinError('Incorrect PIN')
                  setPinRemoveInput('')
                }
              }}
              className="space-y-4"
            >
              <p className="text-sm text-gray-400">Enter your current PIN to remove it.</p>
              <div>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={pinRemoveInput}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, '')
                    if (v.length <= 6) setPinRemoveInput(v)
                    if (pinError) setPinError('')
                  }}
                  placeholder="Current PIN"
                  maxLength={6}
                  className="w-full px-4 py-3 text-center text-2xl font-bold tracking-widest bg-gray-800 border border-gray-700 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:border-monero-600"
                  autoFocus
                />
              </div>

              {pinError && (
                <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg text-red-300 text-sm text-center">
                  {pinError}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRemovePinModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pinRemoveInput.length < 4}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-white font-medium transition"
                >
                  Remove
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Monero Node Connection — Auto-configured on Umbrel */}
      <Card>
        <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
          <Server size={20} />
          Monero Node
        </h2>

        {/* Auto-configured status */}
        {nodeStatusData?.connected ? (
          <div className="space-y-4">
            <div className="p-4 bg-green-900/20 border border-green-700 rounded-lg">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm font-medium text-green-300">
                  Connected to Umbrel Monero Node
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-gray-500 text-xs">Node Address</p>
                  <p className="text-gray-300 font-mono text-xs">{nodeStatusData.node_address}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Network</p>
                  <p className="text-gray-300 capitalize">{nodeStatusData.network || 'mainnet'}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Block Height</p>
                  <p className="text-gray-300">{nodeStatusData.height?.toLocaleString()}</p>
                </div>
                {nodeStatusData.version && (
                  <div>
                    <p className="text-gray-500 text-xs">Daemon Version</p>
                    <p className="text-gray-300">{nodeStatusData.version}</p>
                  </div>
                )}
              </div>
              {nodeStatusData.syncing && (
                <div className="mt-3 p-2 bg-yellow-900/20 border border-yellow-700 rounded text-yellow-300 text-xs flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Node is syncing — {(nodeStatusData.target_height - nodeStatusData.height).toLocaleString()} blocks remaining
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500">
              Your Monero node is managed by the Umbrel Monero app. Node credentials are auto-detected.
            </p>
          </div>
        ) : nodeStatusData ? (
          <div className="space-y-4">
            <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div>
                <span className="text-sm font-medium text-red-300">Not Connected</span>
                <p className="text-xs text-gray-400 mt-1">
                  Trying to reach: <code className="text-gray-300">{nodeStatusData.node_address}</code>
                </p>
              </div>
            </div>
            <div className="p-3 bg-gray-800 rounded-lg text-sm text-gray-400">
              <p className="font-medium text-gray-300 mb-2">Troubleshooting:</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>Make sure the <strong>Monero Node</strong> app is installed and running on Umbrel</li>
                <li>The node may still be syncing the blockchain (this can take hours on first run)</li>
                <li>Try restarting the Monero Node app from your Umbrel dashboard</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-gray-800 rounded-lg flex items-center gap-3">
            <Loader2 size={18} className="animate-spin text-gray-500" />
            <span className="text-sm text-gray-400">Checking node connection...</span>
          </div>
        )}

        {/* Manual Node Override Toggle */}
        <div className="mt-4 pt-4 border-t border-gray-700">
          <button
            onClick={() => setShowNodePicker(!showNodePicker)}
            className="text-sm text-gray-400 hover:text-gray-300 transition flex items-center gap-2"
          >
            <Server size={14} />
            {showNodePicker ? 'Hide manual node options' : 'Use a different node (public, custom, or Tor)'}
          </button>
        </div>

        {/* Manual Node Picker (collapsible) */}
        {showNodePicker && (
          <div className="mt-4 pt-4 border-t border-gray-700 space-y-6">
            {/* Connection Type Selection */}
            <div>
              <label className="block text-sm font-bold mb-3 text-gray-300">Connection Type</label>
              <div className="space-y-3">
                {/* Public Node */}
                <label className="flex items-start gap-3 p-3 bg-gray-800 border border-gray-700 rounded-lg cursor-pointer hover:border-gray-600 transition">
                  <input
                    type="radio"
                    name="nodeType"
                    value="public"
                    checked={nodeType === 'public'}
                    onChange={() => {
                      setNodeType('public')
                      setNodeAddress('xmr-node.cakewallet.com:18081')
                    }}
                    className="mt-1"
                  />
                  <div>
                    <p className="text-sm font-medium flex items-center gap-2">
                      <Globe size={16} /> Public Node (easiest)
                    </p>
                    {nodeType === 'public' && (
                      <select
                        value={nodeAddress}
                        onChange={(e) => setNodeAddress(e.target.value)}
                        className="mt-2 w-full text-sm"
                      >
                        <option value="xmr-node.cakewallet.com:18081">xmr-node.cakewallet.com:18081</option>
                        <option value="node.moneroworld.com:18089">node.moneroworld.com:18089</option>
                        <option value="node.sethforprivacy.com:18089">node.sethforprivacy.com:18089</option>
                        <option value="nodes.hashvault.pro:18081">nodes.hashvault.pro:18081</option>
                      </select>
                    )}
                  </div>
                </label>

                {/* Custom Node */}
                <label className="flex items-start gap-3 p-3 bg-gray-800 border border-gray-700 rounded-lg cursor-pointer hover:border-gray-600 transition">
                  <input
                    type="radio"
                    name="nodeType"
                    value="custom"
                    checked={nodeType === 'custom'}
                    onChange={() => setNodeType('custom')}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Custom Node</p>
                    {nodeType === 'custom' && (
                      <div className="mt-2 space-y-2">
                        <input
                          type="text"
                          value={nodeAddress}
                          onChange={(e) => setNodeAddress(e.target.value)}
                          placeholder="host:port"
                          className="w-full text-sm"
                        />
                        {savedNodes.length > 0 && (
                          <div>
                            <p className="text-xs text-gray-500 mb-1">Saved nodes:</p>
                            <div className="space-y-1">
                              {savedNodes.map((node) => (
                                <div key={node} className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setNodeAddress(node)}
                                    className={`flex-1 text-left text-xs px-2 py-1.5 rounded transition ${
                                      nodeAddress === node
                                        ? 'bg-monero-600/30 text-monero-300 border border-monero-600'
                                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600 border border-gray-600'
                                    }`}
                                  >
                                    {node}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updated = savedNodes.filter((n) => n !== node)
                                      setSavedNodes(updated)
                                      localStorage.setItem('superpay_saved_nodes', JSON.stringify(updated))
                                    }}
                                    className="p-1 text-gray-500 hover:text-red-400 transition"
                                    title="Remove saved node"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {nodeAddress && !savedNodes.includes(nodeAddress) && (
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...savedNodes, nodeAddress]
                              setSavedNodes(updated)
                              localStorage.setItem('superpay_saved_nodes', JSON.stringify(updated))
                            }}
                            className="text-xs text-monero-400 hover:text-monero-300 transition"
                          >
                            + Save this node
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </label>

                {/* Tor Node */}
                <label className="flex items-start gap-3 p-3 bg-gray-800 border border-gray-700 rounded-lg cursor-pointer hover:border-gray-600 transition">
                  <input
                    type="radio"
                    name="nodeType"
                    value="tor"
                    checked={nodeType === 'tor'}
                    onChange={() => setNodeType('tor')}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <Shield size={14} /> Tor (.onion)
                    </p>
                    {nodeType === 'tor' && (
                      <>
                        <input
                          type="text"
                          value={nodeAddress}
                          onChange={(e) => setNodeAddress(e.target.value)}
                          placeholder=".onion address:port"
                          className="mt-2 w-full text-sm"
                        />
                        <p className="text-xs text-gray-400 mt-2">
                          Requires Tor proxy accessible to the Umbrel container (typically via the Tor app on Umbrel)
                        </p>
                      </>
                    )}
                  </div>
                </label>
              </div>
            </div>

            {/* Credentials (for custom/tor) */}
            {(nodeType === 'custom' || nodeType === 'tor') && (
              <div className="space-y-3 pt-4 border-t border-gray-700">
                <p className="text-sm text-gray-400">Only needed if the node requires authentication</p>
                <div>
                  <label className="block text-sm font-medium mb-2">Username</label>
                  <input
                    type="text"
                    value={nodeUser}
                    onChange={(e) => setNodeUser(e.target.value)}
                    placeholder="(optional)"
                    className="w-full text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Password</label>
                  <input
                    type="password"
                    value={nodePass}
                    onChange={(e) => setNodePass(e.target.value)}
                    placeholder="(optional)"
                    className="w-full text-sm"
                  />
                </div>
              </div>
            )}

            {/* Test Connection */}
            <div className="pt-4 border-t border-gray-700 space-y-3">
              <button
                onClick={handleTestConnection}
                disabled={testing || !nodeAddress}
                className="w-full px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg font-medium transition flex items-center justify-center gap-2"
              >
                {testing ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <Wifi size={18} />
                    Test Connection
                  </>
                )}
              </button>

              {testResult && (
                <div
                  className={`p-3 rounded-lg border flex items-start gap-2 ${
                    testResult.connected
                      ? 'bg-green-900/20 border-green-700 text-green-200'
                      : 'bg-red-900/20 border-red-700 text-red-200'
                  }`}
                >
                  {testResult.connected ? (
                    <>
                      <CheckCircle size={18} className="flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Connected!</p>
                        {testResult.height && (
                          <p className="text-xs text-gray-300">Height: {testResult.height.toLocaleString()}</p>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <XCircle size={18} className="flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Connection Failed</p>
                        <p className="text-xs text-gray-300">{testResult.error}</p>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Save Connection */}
            <button
              onClick={handleSaveNodeConnection}
              disabled={!testResult?.connected || connecting}
              className="w-full px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition flex items-center justify-center gap-2"
            >
              {connecting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Saving...
                </>
              ) : (
                'Save & Connect'
              )}
            </button>
          </div>
        )}
      </Card>

      {/* Wallet Setup */}
      <Card>
        <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
          <Wallet size={20} />
          Monero Wallet
        </h2>

        {/* Current wallet status */}
        {walletStatus?.configured && (
          <div className="space-y-3 mb-6">
            <div className="p-4 bg-green-900/20 border border-green-700 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <CheckCircle size={18} className="text-green-400" />
                  <span className="font-medium text-green-300 font-mono">
                    {walletStatus.filename || 'merchant_wallet'}.keys
                  </span>
                </div>
                <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded uppercase">Connected</span>
              </div>
              <p className="text-sm text-gray-400 truncate">
                Address: <code className="text-gray-300">{walletStatus.address}</code>
              </p>
              {walletStatus.height > 0 && (
                <p className="text-sm text-gray-400 mt-1">
                  Wallet height: {walletStatus.height.toLocaleString()}
                </p>
              )}
            </div>
            <p className="text-xs text-gray-500">
              This is a view-only wallet. Your funds are safe — the app can only monitor
              incoming payments and generate subaddresses, never spend.
            </p>
          </div>
        )}

        {/* Saved Wallets — always shown when files exist */}
        {walletFiles && walletFiles.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-3">Saved Wallets</h3>
            <div className="space-y-2">
              {walletFiles.map((file) => (
                <div key={file.name} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg border border-gray-700">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-gray-700 flex items-center justify-center text-gray-400">
                      <Wallet size={16} />
                    </div>
                    <div>
                      <p className="text-sm font-medium font-mono">{file.name}.keys</p>
                      {walletStatus?.filename === file.name && (
                        <span className="text-[10px] text-green-500 font-bold uppercase">Active</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {walletStatus?.filename !== file.name && (
                      <button
                        onClick={() => {
                          walletSetupMutation.mutate({
                            primary_address: 'REUSED',
                            secret_view_key: 'REUSED',
                            restore_height: 0,
                            wallet_name: file.name
                          })
                        }}
                        disabled={walletSetupMutation.isPending}
                        className="text-xs px-3 py-1.5 bg-monero-600 hover:bg-monero-700 rounded text-white font-medium transition disabled:opacity-50"
                      >
                        {walletSetupMutation.isPending ? 'Connecting...' : 'Connect'}
                      </button>
                    )}
                    {walletStatus?.filename !== file.name && (
                      <button
                        onClick={() => {
                          walletApi.deleteFile(file.name).then(() => {
                            queryClient.invalidateQueries({ queryKey: ['wallet-files'] })
                          })
                        }}
                        className="text-xs px-3 py-1.5 bg-red-900/30 hover:bg-red-900/50 border border-red-700 rounded text-red-300 transition"
                        title="Delete wallet file"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add new wallet form — always accessible */}
        <div className="space-y-4">
          {!walletStatus?.configured && !walletStatus?.daemon_connected && (
            <div className="p-4 bg-yellow-900/20 border border-yellow-700 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle size={18} className="text-yellow-400" />
                <span className="font-medium text-yellow-300">No Wallet Connected</span>
              </div>
              <p className="text-sm text-gray-400">
                Connect to a Monero node first (above), then add your wallet below.
              </p>
            </div>
          )}

          <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wide">
            {walletStatus?.configured ? 'Add Another Wallet' : 'Add Wallet'}
          </h3>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              walletSetupMutation.mutate(walletForm)
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium mb-2">Primary Address</label>
              <input
                type="text"
                value={walletForm.primary_address}
                onChange={(e) => setWalletForm({ ...walletForm, primary_address: e.target.value })}
                placeholder="4... (95 character Monero address)"
                required
                className="font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                Secret View Key
                <button
                  type="button"
                  onClick={() => setShowViewKey(!showViewKey)}
                  className="text-gray-500 hover:text-gray-300"
                >
                  <Eye size={14} />
                </button>
              </label>
              <input
                type={showViewKey ? 'text' : 'password'}
                value={walletForm.secret_view_key}
                onChange={(e) => setWalletForm({ ...walletForm, secret_view_key: e.target.value })}
                placeholder="64 hex characters"
                required
                className="font-mono text-xs"
              />
              <p className="text-xs text-gray-500 mt-1">
                Find this in your wallet app under "Show keys" or "Wallet info"
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Restore Height <span className="text-gray-500">(optional)</span>
              </label>
              <input
                type="number"
                min="0"
                value={walletForm.restore_height || ''}
                onChange={(e) =>
                  setWalletForm({ ...walletForm, restore_height: parseInt(e.target.value) || 0 })
                }
                placeholder="0 (scan from beginning — slow but safe)"
              />
              <p className="text-xs text-gray-500 mt-1">
                Block height when your wallet was created. Higher = faster initial sync.
                Use 0 if unsure.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Wallet Name <span className="text-gray-500">(optional)</span>
              </label>
              <input
                type="text"
                value={walletForm.wallet_name}
                onChange={(e) =>
                  setWalletForm({ ...walletForm, wallet_name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })
                }
                placeholder="merchant_wallet"
              />
              <p className="text-xs text-gray-500 mt-1">
                Filename for your wallet files. No spaces.
              </p>
            </div>

            <button
              type="submit"
              disabled={walletSetupMutation.isPending}
              className="px-6 py-2 bg-monero-600 hover:bg-monero-700 disabled:opacity-50 rounded-lg font-medium transition"
            >
              {walletSetupMutation.isPending ? 'Saving...' : 'Save Wallet'}
            </button>

            {walletSetupMutation.isSuccess && (
              <div className="p-3 bg-green-900/30 border border-green-700 rounded-lg text-green-200 text-sm">
                Wallet connected! It will now sync with the blockchain.
              </div>
            )}

            {walletSetupMutation.isError && (
              <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-sm">
                {(walletSetupMutation.error as Error)?.message || 'Failed to setup wallet'}
              </div>
            )}
          </form>
        </div>
      </Card>

      {/* Store Management */}
      <Card>
        <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
          <Package size={20} />
          Stores
        </h2>

        {/* Stores List */}
        <div className="space-y-3 mb-6">
          {!storesData ? (
            <div className="p-4 bg-gray-700 rounded-lg text-center text-gray-300 text-sm">Loading stores...</div>
          ) : storeList.length === 0 ? (
            <div className="p-4 bg-gray-700 rounded-lg text-center text-gray-400 text-sm">No stores created yet</div>
          ) : (
            storeList.map((store) => (
              <div key={store.id} className="p-4 bg-gray-750 border border-gray-700 rounded-lg">
                {editingStore?.id === store.id ? (
                  // Edit mode
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editStoreName}
                      onChange={(e) => setEditStoreName(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white focus:outline-none focus:border-monero-600"
                      placeholder="Store name"
                    />
                    <textarea
                      value={editStoreDescription}
                      onChange={(e) => setEditStoreDescription(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white focus:outline-none focus:border-monero-600 resize-none"
                      rows={2}
                      placeholder="Description (optional)"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          updateStoreMutation.mutate({
                            id: store.id,
                            name: editStoreName || store.name,
                            description: editStoreDescription || undefined,
                          })
                        }}
                        disabled={updateStoreMutation.isPending}
                        className="flex-1 px-3 py-2 bg-monero-600 hover:bg-monero-700 disabled:opacity-50 rounded text-white text-sm font-medium transition"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingStore(null)}
                        className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white text-sm font-medium transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  // Display mode
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-bold text-white truncate">{store.name}</h3>
                        {activeStoreId === store.id && (
                          <span className="text-xs bg-monero-600/30 text-monero-300 px-2 py-0.5 rounded uppercase font-bold flex-shrink-0">
                            Active
                          </span>
                        )}
                      </div>
                      {store.description && (
                        <p className="text-xs text-gray-400 truncate">{store.description}</p>
                      )}
                      <p className="text-xs text-gray-500 mt-2">
                        Node: <code className="text-gray-400">{store.node_address}</code>
                      </p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0 items-center">
                      {activeStoreId !== store.id && (
                        <button
                          onClick={() => switchStoreMutation.mutate(store.id)}
                          disabled={switchStoreMutation.isPending}
                          className="px-3 py-1.5 bg-monero-600 hover:bg-monero-700 rounded text-white text-xs font-medium transition disabled:opacity-50"
                          title="Open this store"
                        >
                          {switchStoreMutation.isPending ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            'Open Store'
                          )}
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          try {
                            const exportUrl = storesApi.exportStore(store.id)
                            const resp = await fetch(exportUrl)
                            if (!resp.ok) throw new Error('Export failed')
                            const blob = await resp.blob()
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement('a')
                            a.href = url
                            a.download = `${store.name}.superpay`
                            document.body.appendChild(a)
                            a.click()
                            document.body.removeChild(a)
                            URL.revokeObjectURL(url)
                          } catch (err) {
                            console.error('Export failed:', err)
                          }
                        }}
                        className="p-2 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 hover:text-white transition"
                        title="Export store"
                      >
                        <Download size={14} />
                      </button>
                      {activeStoreId !== store.id && (
                        <>
                          <button
                            onClick={() => {
                              setEditingStore(store)
                              setEditStoreName(store.name)
                              setEditStoreDescription(store.description || '')
                            }}
                            className="p-2 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 hover:text-white transition"
                            title="Edit store"
                          >
                            <Edit2 size={14} />
                          </button>
                          {confirmDeleteId === store.id ? (
                            <button
                              onClick={() => {
                                deleteStoreMutation.mutate(store.id, {
                                  onSettled: () => setConfirmDeleteId(null),
                                })
                              }}
                              disabled={deleteStoreMutation.isPending}
                              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded text-white text-xs font-bold transition disabled:opacity-50 animate-pulse"
                            >
                              {deleteStoreMutation.isPending ? 'Deleting...' : 'Confirm Delete'}
                            </button>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(store.id)}
                              className="p-2 bg-red-900/30 hover:bg-red-900/50 rounded text-red-400 hover:text-red-300 transition"
                              title="Delete store"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Import status messages */}
        {importError && (
          <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg text-red-300 text-sm flex items-center gap-2">
            <AlertCircle size={16} />
            {importError}
          </div>
        )}
        {importSuccess && (
          <div className="p-3 bg-green-900/20 border border-green-700 rounded-lg text-green-300 text-sm flex items-center gap-2">
            <CheckCircle size={16} />
            {importSuccess}
          </div>
        )}

        {/* Create + Import Buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => {
              setShowCreateStoreModal(true)
              setCreateStoreError('')
              setNewStoreName('')
              setNewStoreDescription('')
            }}
            className="flex-1 px-4 py-2 bg-monero-600 hover:bg-monero-700 rounded text-white font-medium transition flex items-center justify-center gap-2"
          >
            <Package size={16} />
            Create New Store
          </button>

          {/* Hidden file input for import */}
          <input
            id="import-store-file"
            type="file"
            accept=".superpay"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              e.target.value = '' // reset so same file can be re-selected
              setImportError('')
              setImportSuccess('')
              setImportingStore(true)
              try {
                const result = await storesApi.importStore(file)
                setImportSuccess(`Store "${result.name}" imported successfully`)
                setTimeout(() => setImportSuccess(''), 5000)
                queryClient.invalidateQueries({ queryKey: ['stores'] })
              } catch (err: any) {
                setImportError(err?.message || 'Failed to import store')
                setTimeout(() => setImportError(''), 5000)
              } finally {
                setImportingStore(false)
              }
            }}
          />
          <button
            onClick={() => document.getElementById('import-store-file')?.click()}
            disabled={importingStore}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-white font-medium transition flex items-center justify-center gap-2"
          >
            {importingStore ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload size={16} />
                Import .superpay
              </>
            )}
          </button>
        </div>
      </Card>

      {/* Create Store Modal */}
      {showCreateStoreModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Create New Store</h2>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!newStoreName.trim()) {
                  setCreateStoreError('Store name is required')
                  return
                }
                createStoreMutation.mutate({
                  name: newStoreName.trim(),
                  description: newStoreDescription.trim() || undefined,
                })
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium mb-2">Store Name</label>
                <input
                  type="text"
                  value={newStoreName}
                  onChange={(e) => {
                    setNewStoreName(e.target.value)
                    if (createStoreError) setCreateStoreError('')
                  }}
                  placeholder="e.g., Downtown Location"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Description <span className="text-gray-500">(optional)</span>
                </label>
                <textarea
                  value={newStoreDescription}
                  onChange={(e) => setNewStoreDescription(e.target.value)}
                  placeholder="e.g., Main storefront on 5th Avenue"
                  rows={2}
                  className="w-full"
                />
              </div>

              {createStoreError && (
                <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg text-red-300 text-sm">
                  {createStoreError}
                </div>
              )}

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateStoreModal(false)
                    setNewStoreName('')
                    setNewStoreDescription('')
                    setCreateStoreError('')
                  }}
                  disabled={createStoreMutation.isPending}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createStoreMutation.isPending || !newStoreName.trim()}
                  className="flex-1 px-4 py-2 bg-monero-600 hover:bg-monero-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-white font-medium transition flex items-center justify-center gap-2"
                >
                  {createStoreMutation.isPending ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create'
                  )}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Support Development */}
      <Card>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-monero-600/20 flex items-center justify-center">
            <span className="text-monero-400 text-lg">{'\u2764'}</span>
          </div>
          <h2 className="text-lg font-bold">Support Monero SuperPay</h2>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          Monero SuperPay is free and open source. If you find it useful, consider supporting ongoing development with a Monero donation.
        </p>
        <div className="flex flex-col items-center gap-4 p-4 bg-[#ffffff] rounded-lg">
          <img
            src="/donate-qr.png"
            alt="Donation QR Code"
            className="w-48 h-48 object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        </div>
        <div className="mt-4 space-y-2">
          <label className="block text-xs text-gray-500 uppercase tracking-wider">Donation Address</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value="489mHXbSehCF5oraCQvmRYSe9mkxyqZ6XJBS8A4af6qzbKBx3b26bLSRUVso9R6PTSgEX7RggVPc5hxcZnAaRKCT7iekvDX"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300 font-mono truncate"
            />
            <button
              onClick={() => {
                navigator.clipboard.writeText('489mHXbSehCF5oraCQvmRYSe9mkxyqZ6XJBS8A4af6qzbKBx3b26bLSRUVso9R6PTSgEX7RggVPc5hxcZnAaRKCT7iekvDX')
              }}
              className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-white transition shrink-0"
            >
              Copy
            </button>
          </div>
        </div>
        <div className="mt-3">
          <button
            onClick={() => BrowserOpenURL('https://kuno.anne.media/fundraiser/ufmp/')}
            className="inline-flex items-center gap-2 text-sm text-monero-400 hover:text-monero-300 transition cursor-pointer bg-transparent border-none"
          >
            View public fundraiser on Kuno
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
          </button>
        </div>
      </Card>
    </div>
  )
}
