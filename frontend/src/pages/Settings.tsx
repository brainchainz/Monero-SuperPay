import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle, Wallet, Eye, Download, Edit2, Trash2, Package, Loader2 } from 'lucide-react'
import Card from '../components/Card'
import { settings as settingsApi, wallet as walletApi, stores as storesApi } from '../lib/api'
import { Store } from '../lib/types'

const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'AUD', 'CAD', 'CHF', 'SEK', 'NZD']

export default function Settings() {
  const [formData, setFormData] = useState({
    business_name: '',
    fiat_currency: 'USD',
    tax_rate: 8,
    confirmation_threshold: 1,
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

  // Store management state
  const [showCreateStoreModal, setShowCreateStoreModal] = useState(false)
  const [newStoreName, setNewStoreName] = useState('')
  const [newStoreDescription, setNewStoreDescription] = useState('')
  const [createStoreError, setCreateStoreError] = useState('')
  const [editingStore, setEditingStore] = useState<Store | null>(null)
  const [editStoreName, setEditStoreName] = useState('')
  const [editStoreDescription, setEditStoreDescription] = useState('')

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

  const deleteWalletMutation = useMutation({
    mutationFn: () => walletApi.delete(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallet-status'] })
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
    }
  }, [settingsData])

  const handleSubmit = () => {
    updateSettingsMutation.mutate(formData as any)
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold mb-2">Settings</h1>
        <p className="text-gray-400">Manage your business configuration</p>
      </div>

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
                  <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-monero-600 peer-checked:after:bg-white" />
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
                  <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-monero-600 peer-checked:after:bg-white" />
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
              Tailscale IP <span className="text-gray-500">(optional)</span>
            </label>
            <input
              type="text"
              value={formData.tailscale_ip}
              onChange={(e) => setFormData({ ...formData, tailscale_ip: e.target.value })}
              placeholder="e.g., 100.64.0.5"
            />
            <p className="text-xs text-gray-400 mt-1">
              Your Umbrel's Tailscale IP. PoS devices on your Tailscale network can connect remotely.
              Install Tailscale on your Umbrel and Android device.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Tor .onion Address <span className="text-gray-500">(optional)</span>
            </label>
            <input
              type="text"
              value={formData.tor_address}
              onChange={(e) => setFormData({ ...formData, tor_address: e.target.value })}
              placeholder="e.g., abc123...xyz.onion"
            />
            <p className="text-xs text-gray-400 mt-1">
              Umbrel's Tor hidden service address for this app. PoS devices with Orbot can connect over Tor.
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

      {/* Wallet Setup */}
      <Card>
        <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
          <Wallet size={20} />
          Monero Wallet
        </h2>

        {walletStatus?.configured ? (
          <div className="space-y-3">
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
        ) : (
          <div className="space-y-4">
            <div className="p-4 bg-yellow-900/20 border border-yellow-700 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle size={18} className="text-yellow-400" />
                <span className="font-medium text-yellow-300">Wallet Not Configured</span>
              </div>
              <p className="text-sm text-gray-400">
                To accept payments, enter your Monero wallet's primary address and secret view key below.
                This creates a <strong>view-only wallet</strong> — your funds stay safe because
                the spend key never leaves your personal wallet (Cake Wallet, Feather, etc).
              </p>
            </div>

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
                  Wallet created! It will now sync with the blockchain. This may take a while.
                </div>
              )}

              {walletSetupMutation.isError && (
                <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-sm">
                  {(walletSetupMutation.error as Error)?.message || 'Failed to setup wallet'}
                </div>
              )}
            </form>
          </div>
        )}

        {/* Existing Wallets Manager */}
        {walletFiles && walletFiles.length > 0 && (
          <div className="mt-8 pt-6 border-t border-gray-700">
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-4">Saved Wallets</h3>
            <div className="space-y-2">
              {walletFiles.map((file) => (
                <div key={file.name} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 transition group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-gray-700 flex items-center justify-center text-gray-400">
                      <Wallet size={16} />
                    </div>
                    <div>
                      <p className="text-sm font-medium font-mono">{file.name}.keys</p>
                      {walletStatus?.filename === file.name && (
                        <span className="text-[10px] text-green-500 font-bold uppercase">Active Now</span>
                      )}
                    </div>
                  </div>
                  {walletStatus?.filename !== file.name && (
                    <button
                      onClick={() => {
                        if (confirm(`Switch to "${file.name}"? This will disconnect the current wallet.`)) {
                          walletSetupMutation.mutate({
                            primary_address: 'REUSED', // Backend will handle opening if file exists
                            secret_view_key: 'REUSED',
                            restore_height: 0,
                            wallet_name: file.name
                          })
                        }
                      }}
                      className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 opacity-0 group-hover:opacity-100 transition"
                    >
                      Connect
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-500 mt-3 text-center">
              Wallet keys are stored securely in the app's encrypted data volume.
            </p>
          </div>
        )}
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
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => {
                          const exportUrl = storesApi.export(store.id)
                          const a = document.createElement('a')
                          a.href = exportUrl
                          a.download = `${store.name}.superpay`
                          document.body.appendChild(a)
                          a.click()
                          document.body.removeChild(a)
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
                          <button
                            onClick={() => {
                              if (confirm(`Delete store "${store.name}"? This cannot be undone.`)) {
                                deleteStoreMutation.mutate(store.id)
                              }
                            }}
                            disabled={deleteStoreMutation.isPending}
                            className="p-2 bg-red-900/30 hover:bg-red-900/50 rounded text-red-400 hover:text-red-300 transition disabled:opacity-50"
                            title="Delete store"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Create Store Button */}
        <button
          onClick={() => {
            setShowCreateStoreModal(true)
            setCreateStoreError('')
            setNewStoreName('')
            setNewStoreDescription('')
          }}
          className="w-full px-4 py-2 bg-monero-600 hover:bg-monero-700 rounded text-white font-medium transition flex items-center justify-center gap-2"
        >
          <Package size={16} />
          Create New Store
        </button>
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

      {/* Danger Zone */}
      <Card className="border-red-700">
        <h2 className="text-lg font-bold mb-4 text-red-400">Danger Zone</h2>
        <div className="space-y-3">
          <p className="text-sm text-gray-400">
            These actions cannot be undone. Please proceed with caution.
          </p>
          <button
            onClick={() => {
              if (confirm('Disconnect wallet? This will stop payment monitoring. The files will remain on disk.')) {
                deleteWalletMutation.mutate()
              }
            }}
            disabled={!walletStatus?.configured || deleteWalletMutation.isPending}
            className="w-full px-4 py-2 bg-red-900/30 border border-red-700 text-red-200 rounded-lg hover:bg-red-900/50 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deleteWalletMutation.isPending ? 'Disconnecting...' : 'Disconnect Wallet'}
          </button>
          <button
            disabled
            className="w-full px-4 py-2 bg-red-900/30 border border-red-700 text-red-200 rounded-lg hover:bg-red-900/50 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Clear All Orders
          </button>
        </div>
      </Card>

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
        <div className="flex flex-col items-center gap-4 p-4 bg-white rounded-lg">
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
          <a
            href="https://kuno.anne.media/fundraiser/ufmp/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-monero-400 hover:text-monero-300 transition"
          >
            View public fundraiser on Kuno
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
          </a>
        </div>
      </Card>
    </div>
  )
}
