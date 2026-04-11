import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock, Check, LogOut, Package } from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import { posApi, isDevicePaired, pairDevice, unpairDevice, getDeviceInfo, getDeviceType } from '../lib/deviceApi'
import { useWebSocket } from '../lib/websocket'

export default function OrderMonitor() {
    const queryClient = useQueryClient()
    const deviceInfo = getDeviceInfo()
    const [isPaired, setIsPaired] = useState(isDevicePaired())
    const [pairingInProgress, setPairingInProgress] = useState(false)
    const [pairingError, setPairingError] = useState('')

    // Redirect pos devices to /pos
    useEffect(() => {
      if (isPaired && getDeviceType() === 'pos') {
        window.location.href = '/pos'
      }
    }, [isPaired])

    // Auto-pair from URL param
    useEffect(() => {
      const params = new URLSearchParams(window.location.search)
      const pairToken = params.get('pair')
      if (pairToken && !isPaired) {
        setPairingInProgress(true)
        pairDevice(pairToken)
          .then((result) => {
            if (result.device_type === 'pos') {
              window.location.href = '/pos'
              return
            }
            setIsPaired(true)
            setPairingError('')
            window.history.replaceState({}, '', '/monitor')
          })
          .catch((err) => {
            setPairingError(err.message || 'Pairing failed')
          })
          .finally(() => setPairingInProgress(false))
      }
    }, [isPaired])

    // Fetch only active (pending, paid) or recently delivered orders 
    // We'll fetch all and filter client-side for simplicity, or we could rely on limits.
    const { data: orders = [] } = useQuery({
        queryKey: ['monitor-orders'],
        queryFn: () => posApi.orders.list({ limit: 50 }),
        enabled: isPaired,
        refetchInterval: 10000,
    })

    const deliverOrderMutation = useMutation({
        mutationFn: (id: string) => posApi.orders.deliverOrder(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['monitor-orders'] })
        },
    })

    // Listen for real-time order updates
    useWebSocket('order_created', () => {
        queryClient.invalidateQueries({ queryKey: ['monitor-orders'] })
    })
    useWebSocket('order_paid', () => {
        queryClient.invalidateQueries({ queryKey: ['monitor-orders'] })
    })
    useWebSocket('order_delivered', () => {
        queryClient.invalidateQueries({ queryKey: ['monitor-orders'] })
    })
    useWebSocket('order_cancelled', () => {
        queryClient.invalidateQueries({ queryKey: ['monitor-orders'] })
    })
    useWebSocket('orders_expired', () => {
        queryClient.invalidateQueries({ queryKey: ['monitor-orders'] })
    })

    if (!isPaired) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
                <div className="bg-gray-800 p-8 rounded-2xl max-w-md w-full text-center border border-gray-700">
                    <img src="/logo.png" alt="Monero SuperPay" className="w-16 h-16 rounded-2xl object-contain mx-auto mb-6" />
                    <h2 className="text-2xl font-bold mb-2">Order Monitor</h2>
                    <p className="text-gray-400 mb-6">Kitchen / Counter Display</p>

                    {pairingInProgress ? (
                      <div className="space-y-4">
                        <div className="w-12 h-12 border-4 border-monero-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                        <p className="text-gray-300">Pairing device...</p>
                      </div>
                    ) : pairingError ? (
                      <div className="space-y-4">
                        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4">
                          <p className="text-red-300">{pairingError}</p>
                        </div>
                        <p className="text-gray-400 text-sm">
                          Ask your administrator to generate a new pairing QR code from the dashboard.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="bg-gray-700/50 rounded-lg p-6">
                          <p className="text-gray-300 mb-4">
                            Scan a pairing QR code from the admin dashboard to connect this device.
                          </p>
                          <div className="text-6xl">📺</div>
                        </div>
                        <p className="text-gray-500 text-xs">
                          Dashboard → Devices → Add Device → select "Order Monitor"
                        </p>
                      </div>
                    )}
                </div>
            </div>
        )
    }

    const handleLogout = () => {
        if (confirm('Are you sure you want to unpair this device?')) {
            unpairDevice()
            window.location.reload()
        }
    }

    // Filter orders: show pending, paid, and recently delivered (limit 10 for delivered)
    const displayOrders = orders
        .filter(o => ['pending', 'paid', 'delivered'].includes(o.status))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    // Separate active from completed
    const activeOrders = displayOrders.filter(o => ['pending', 'paid'].includes(o.status))
    const deliveredOrders = displayOrders.filter(o => o.status === 'delivered').slice(0, 10)

    return (
        <div className="min-h-screen bg-gray-900 flex flex-col">
            {/* Top Navigation */}
            <header className="bg-gray-800 border-b border-gray-700 p-4 sticky top-0 z-10">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Package className="text-monero-500 w-8 h-8" />
                        <div>
                            <h1 className="font-bold text-xl leading-tight">Order Monitor</h1>
                            <p className="text-sm text-gray-400">{deviceInfo.name}</p>
                        </div>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition"
                        title="Unpair Device"
                    >
                        <LogOut size={20} />
                    </button>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 p-4 overflow-auto">
                <div className="max-w-7xl mx-auto space-y-8">

                    {/* Active Orders Section */}
                    <section>
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></span>
                            Active Orders ({activeOrders.length})
                        </h2>

                        {activeOrders.length === 0 ? (
                            <div className="text-center py-12 bg-gray-800/50 rounded-2xl border border-gray-700/50">
                                <Package className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                                <p className="text-gray-400 text-lg">No active orders</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {activeOrders.map(order => (
                                    <OrderCard
                                        key={order.id}
                                        order={order}
                                        onDeliver={() => deliverOrderMutation.mutate(order.id)}
                                        isDelivering={deliverOrderMutation.isPending && deliverOrderMutation.variables === order.id}
                                    />
                                ))}
                            </div>
                        )}
                    </section>

                    {/* Recently Delivered Section */}
                    {deliveredOrders.length > 0 && (
                        <section>
                            <h2 className="text-xl font-bold mb-4 text-gray-400 flex items-center gap-2">
                                <Check className="w-5 h-5 text-green-500" />
                                Recently Delivered
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 opacity-75">
                                {deliveredOrders.map(order => (
                                    <OrderCard key={order.id} order={order} readonly />
                                ))}
                            </div>
                        </section>
                    )}

                </div>
            </main>
        </div>
    )
}

function OrderCard({ order, onDeliver, isDelivering, readonly = false }: { order: any, onDeliver?: () => void, isDelivering?: boolean, readonly?: boolean }) {
    return (
        <div className={`bg-gray-800 border ${order.status === 'paid' ? 'border-monero-500/50 shadow-[0_0_15px_rgba(242,104,34,0.15)]' : 'border-gray-700'} rounded-xl p-4 flex flex-col h-full`}>
            <div className="flex justify-between items-start mb-3">
                <div>
                    <span className="font-mono text-lg font-bold text-white">
                        #{order.order_number || order.id.slice(0, 8)}
                    </span>
                    <p className="text-sm text-gray-400">
                        {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {order.device_name && <span className="ml-2 text-gray-500">· {order.device_name}</span>}
                    </p>
                </div>
                <StatusBadge status={order.status} />
            </div>

            {order.customer_name && (
                <div className="mb-3 px-3 py-2 bg-gray-900/50 rounded-lg border border-gray-700/50 isolate">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">Customer</p>
                    <p className="font-medium text-gray-200">{order.customer_name}</p>
                </div>
            )}

            <div className="flex-1">
                <ul className="space-y-2 mb-4">
                    {order.items?.map((item: any, idx: number) => (
                        <li key={idx} className="flex justify-between items-start text-sm">
                            <span className="text-gray-300">
                                <span className="text-monero-400 font-medium mr-2">{item.quantity}x</span>
                                {item.product_name}
                                {item.note && <span className="ml-2 text-xs text-yellow-400 italic">* {item.note}</span>}
                            </span>
                        </li>
                    ))}
                </ul>

                {order.note && (
                    <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-700/30 rounded-lg">
                        <p className="text-xs text-yellow-500 uppercase tracking-wider mb-1">Note</p>
                        <p className="text-sm text-yellow-200">{order.note}</p>
                    </div>
                )}
            </div>

            {!readonly && (
                <div className="mt-auto pt-4 border-t border-gray-700">
                    {order.status === 'pending' ? (
                        <div className="flex items-center justify-center gap-2 py-3 bg-gray-900/50 rounded-lg border border-gray-700 text-gray-400">
                            <Clock className="w-5 h-5" />
                            <span className="font-medium">Waiting for payment...</span>
                        </div>
                    ) : order.status === 'paid' ? (
                        <button
                            onClick={onDeliver}
                            disabled={isDelivering}
                            className="w-full flex items-center justify-center gap-2 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg font-bold transition shadow-lg shadow-green-900/20"
                        >
                            <Check className="w-5 h-5" />
                            {isDelivering ? 'Marking...' : 'Mark Delivered'}
                        </button>
                    ) : null}
                </div>
            )}
        </div>
    )
}
