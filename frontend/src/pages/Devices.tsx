import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, QrCode, Wifi, Globe, Shield, CheckCircle2 } from 'lucide-react'
import { QRCodeSVG as QRCode } from 'qrcode.react'
import { useState, useEffect } from 'react'
import Card from '../components/Card'
import StatusBadge from '../components/StatusBadge'
import Modal from '../components/Modal'
import { devices as devicesApi, settings as settingsApi } from '../lib/api'

type ConnectionTab = 'local' | 'tor' | 'tailscale'

export default function Devices() {
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isQRModalOpen, setIsQRModalOpen] = useState(false)
  const [newDeviceName, setNewDeviceName] = useState('') // Renamed from deviceName
  const [newDeviceType, setNewDeviceType] = useState<'pos' | 'order_monitor'>('pos') // Added new state
  const [useTailscale, setUseTailscale] = useState(false) // Added new state
  const [pairingData, setPairingData] = useState<any>(null)
  const [activeTab, setActiveTab] = useState<ConnectionTab>('local')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [isPaired, setIsPaired] = useState(false)

  const { data: devices, isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesApi.list(),
    refetchInterval: 20000,
  })

  // Added query for app settings to get tailscale_ip
  const { data: appSettings } = useQuery({
    queryKey: ['appSettings'],
    queryFn: () => settingsApi.get(),
  })

  const createTokenMutation = useMutation({
    mutationFn: () =>
      devicesApi.createPairingToken(newDeviceName, newDeviceType, useTailscale ? appSettings?.tailscale_ip : undefined),
    onSuccess: (data) => {
      setPairingData(data)
      setIsQRModalOpen(true)
    },
  })

  const deleteDeviceMutation = useMutation({
    mutationFn: (id: string) => devicesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      setDeleteConfirm(null)
    },
  })

  const handleCreateToken = (e: React.FormEvent) => {
    e.preventDefault()
    if (newDeviceName.trim()) {
      setIsPaired(false)
      createTokenMutation.mutate() // Call mutate without arguments, it uses state variables
      setIsModalOpen(false)
    }
  }

  // Poll for pairing status
  useEffect(() => {
    let interval: any
    if (isQRModalOpen && pairingData?.token && !isPaired) {
      interval = setInterval(async () => {
        try {
          const status = await devicesApi.getPairingTokenStatus(pairingData.token)
          if (status.used) {
            setIsPaired(true)
            clearInterval(interval)
            // Show checkmark for 2s then close
            setTimeout(() => {
              setIsQRModalOpen(false)
              setPairingData(null)
              setNewDeviceName('') // Updated state variable
              setNewDeviceType('pos') // Reset device type
              setUseTailscale(false) // Reset tailscale usage
              setIsPaired(false)
              queryClient.invalidateQueries({ queryKey: ['devices'] })
            }, 2000)
          }
        } catch (err) {
          console.error('Failed to poll pairing status:', err)
        }
      }, 2000)
    }
    return () => clearInterval(interval)
  }, [isQRModalOpen, pairingData?.token, isPaired, queryClient])

  // Build QR value — encode a direct URL so any phone camera can open it
  const getQRValue = () => {
    if (!pairingData) return ''

    const connections = pairingData.connections || []
    const selected = connections.find((c: any) => c.type === activeTab)

    if (selected?.url) {
      // URL already includes /pos?pair=TOKEN from the backend
      return selected.url
    }

    // Fallback: use current origin (preserves the actual server port)
    const pairPath = newDeviceType === 'order_monitor' ? '/monitor' : '/pos'
    return `${window.location.origin}${pairPath}?pair=${pairingData.token}`
  }

  // Check which connection methods are available
  const availableConnections = pairingData?.connections || []
  const hasTor = availableConnections.some((c: any) => c.type === 'tor')
  const hasTailscale = availableConnections.some((c: any) => c.type === 'tailscale')

  const tabs: { key: ConnectionTab; label: string; icon: any; available: boolean; description: string }[] = [
    {
      key: 'local',
      label: 'Local',
      icon: Wifi,
      available: true, // always available
      description: 'Connect via local network (same WiFi)',
    },
    {
      key: 'tor',
      label: 'Tor',
      icon: Globe,
      available: hasTor,
      description: 'Connect via Tor .onion address (private, works anywhere)',
    },
    {
      key: 'tailscale',
      label: 'Tailscale',
      icon: Shield,
      available: hasTailscale,
      description: 'Connect via Tailscale VPN (fast, secure, works anywhere)',
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold mb-2">Devices</h1>
          <p className="text-gray-400">Manage your paired PoS devices</p>
        </div>
        <button
          onClick={() => {
            setNewDeviceName('') // Updated state variable
            setNewDeviceType('pos') // Reset device type
            setUseTailscale(false) // Reset tailscale usage
            setPairingData(null)
            setIsModalOpen(true)
          }}
          className="px-4 py-2 bg-monero-600 hover:bg-monero-700 rounded-lg transition flex items-center gap-2"
        >
          <Plus size={18} />
          Add Device
        </button>
      </div>

      {/* Devices List */}
      {isLoading ? (
        <Card>
          <p className="text-gray-400">Loading devices...</p>
        </Card>
      ) : devices && devices.length > 0 ? (
        <div className="space-y-4">
          {devices.map((device: any) => (
            <Card key={device.id}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className={`w-3 h-3 rounded-full ${device.is_active ? 'bg-green-500' : 'bg-gray-500'
                        }`}
                    />
                    <h3 className="text-lg font-bold">{device.name}</h3>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${device.device_type === 'order_monitor'
                        ? 'bg-blue-900/30 text-blue-300 border border-blue-700'
                        : 'bg-monero-900/30 text-monero-300 border border-monero-700'
                      }`}>
                      {device.device_type === 'order_monitor' ? 'Monitor' : 'PoS'}
                    </span>
                    <StatusBadge status={device.is_active ? 'online' : 'offline'} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-gray-400">
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Device ID</p>
                      <p className="font-mono text-white">{device.id?.slice(0, 12)}...</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Paired</p>
                      <p>{device.paired_at ? new Date(device.paired_at).toLocaleDateString() : '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Last Seen</p>
                      <p>{device.last_seen ? new Date(device.last_seen).toLocaleTimeString() : 'Never'}</p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setDeleteConfirm(device.id)}
                  className="ml-4 px-3 py-2 bg-red-900/30 hover:bg-red-900/50 rounded text-red-200 transition flex items-center gap-2"
                >
                  <Trash2 size={16} />
                  Remove
                </button>
              </div>

              {deleteConfirm === device.id && (
                <div className="mt-4 p-3 bg-red-900/20 border border-red-700 rounded flex items-center justify-between">
                  <p className="text-sm">Are you sure you want to remove this device?</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => deleteDeviceMutation.mutate(device.id)}
                      className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm transition"
                    >
                      Remove
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <div className="text-center py-8">
            <QrCode size={48} className="mx-auto mb-4 text-gray-500" />
            <p className="text-gray-400 mb-4">No devices paired yet</p>
            <button
              onClick={() => {
                setNewDeviceName('') // Updated state variable
                setNewDeviceType('pos') // Reset device type
                setUseTailscale(false) // Reset tailscale usage
                setPairingData(null)
                setIsModalOpen(true)
              }}
              className="px-4 py-2 bg-monero-600 hover:bg-monero-700 rounded-lg transition"
            >
              Pair Your First Device
            </button>
          </div>
        </Card>
      )}

      {/* Add Device Modal — just device name, Tailscale IP is in Settings */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setNewDeviceName('') // Updated state variable
          setNewDeviceType('pos') // Reset device type
          setUseTailscale(false) // Reset tailscale usage
        }}
        title="Add Device"
      >
        <form onSubmit={handleCreateToken} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Device Name</label>
            <input
              type="text"
              value={newDeviceName}
              onChange={(e) => setNewDeviceName(e.target.value)}
              className="w-full bg-gray-800"
              placeholder="e.g., Kiosk 1, Kitchen Tablet"
              autoFocus
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              Give this device a name so you can identify it later.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Device Type</label>
            <select
              value={newDeviceType}
              onChange={(e) => setNewDeviceType(e.target.value as 'pos' | 'order_monitor')}
              className="w-full bg-gray-800"
            >
              <option value="pos">Point of Sale</option>
              <option value="order_monitor">Order Monitor</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Choose the primary function of this device.
            </p>
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="submit"
              disabled={createTokenMutation.isPending}
              className="flex-1 px-4 py-2 bg-monero-600 hover:bg-monero-700 rounded-lg transition font-medium disabled:opacity-50"
            >
              Generate QR Code
            </button>
            <button
              onClick={() => {
                setIsModalOpen(false)
                setNewDeviceName('')
              }}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {/* QR Code Pairing Modal — 3 Tabs */}
      <Modal
        isOpen={isQRModalOpen}
        onClose={() => {
          setIsQRModalOpen(false)
          setPairingData(null)
          setNewDeviceName('')
          queryClient.invalidateQueries({ queryKey: ['devices'] })
        }}
        title={`Pair: ${pairingData?.device_name || 'Device'}`}
      >
        <div className="space-y-4">
          {/* Connection Type Tabs */}
          <div className="flex rounded-lg bg-gray-800 p-1">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.key
              const isAvailable = tab.available

              return (
                <button
                  key={tab.key}
                  onClick={() => isAvailable && setActiveTab(tab.key)}
                  disabled={!isAvailable}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium transition ${isActive
                    ? 'bg-monero-600 text-white'
                    : isAvailable
                      ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                      : 'text-gray-600 cursor-not-allowed'
                    }`}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* Tab Description */}
          <p className="text-sm text-gray-400 text-center">
            {tabs.find((t) => t.key === activeTab)?.description}
          </p>

          {/* QR Code or Success Animation */}
          <div className="bg-white p-8 rounded-lg flex justify-center items-center min-h-[364px]">
            {isPaired ? (
              <div className="text-center animate-in zoom-in duration-300">
                <CheckCircle2 size={120} className="text-green-500 mx-auto mb-4" />
                <p className="text-gray-900 text-xl font-bold">Successfully Paired!</p>
                <p className="text-gray-500">This modal will close automatically...</p>
              </div>
            ) : (
              <QRCode value={getQRValue()} size={300} level="H" />
            )}
          </div>

          {/* Connection URL display */}
          {pairingData?.connections && (
            <div className="p-3 bg-gray-800 rounded-lg font-mono text-xs text-gray-300 break-all text-center">
              {pairingData.connections.find((c: any) => c.type === activeTab)?.url ||
                window.location.origin}
            </div>
          )}

          {/* Tailscale hint if not available */}
          {activeTab === 'tailscale' && !hasTailscale && (
            <div className="p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-lg text-sm text-yellow-200">
              No Tailscale IP configured. Set this computer's Tailscale IP in Settings to enable remote PoS access.
            </div>
          )}

          {/* Tor hint */}
          {activeTab === 'tor' && !hasTor && (
            <div className="p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-lg text-sm text-yellow-200">
              Tor address not detected. Make sure Tor is running on this computer and the .onion address is configured in Settings.
            </div>
          )}

          <div className="p-4 bg-gray-700/50 rounded-lg border border-gray-600">
            <p className="text-sm text-gray-400 mb-1">
              Scan this QR code with the device's camera. The browser will open and the device will automatically pair.
            </p>
            <p className="text-xs text-gray-500">
              Once paired, the device goes straight into PoS mode — no admin access.
            </p>
          </div>

          <button
            onClick={() => {
              setIsQRModalOpen(false)
              setPairingData(null)
              setNewDeviceName('')
              queryClient.invalidateQueries({ queryKey: ['devices'] })
            }}
            className="w-full px-4 py-2 bg-monero-600 hover:bg-monero-700 rounded-lg transition font-medium"
          >
            Done
          </button>
        </div>
      </Modal>
    </div>
  )
}
