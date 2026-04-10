import { useQuery } from '@tanstack/react-query'
import { Activity, DollarSign, ShoppingCart, Smartphone } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Card from '../components/Card'
import StatusBadge from '../components/StatusBadge'
import { stats, devices as devicesApi, wallet as walletApi } from '../lib/api'
import { useWebSocket } from '../lib/websocket'
import { useState, useEffect } from 'react'

export default function Dashboard() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState<any[]>([])

  const { data: statsData } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => stats.dashboard(),
    refetchInterval: 30000, // Refetch every 30 seconds
  })

  const { data: devicesData, isLoading: devicesLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesApi.list(),
    refetchInterval: 20000,
  })

  const { data: walletStatus, isLoading: walletStatusLoading } = useQuery({
    queryKey: ['wallet-status'],
    queryFn: () => walletApi.status(),
    refetchInterval: 15000,
  })

  // Listen for new orders via WebSocket
  useWebSocket('order_created', (data: any) => {
    if (data) {
      setOrders((prev) => [data, ...prev.slice(0, 9)])
    }
  })

  // Listen for order status updates
  useWebSocket('order_paid', (data: any) => {
    if (data) {
      setOrders((prev) =>
        prev.map((order) => (order.id === data.id ? { ...order, ...data } : order))
      )
    }
  })

  // Initialize orders from statsData
  useEffect(() => {
    if (statsData?.recent_orders) {
      setOrders(statsData.recent_orders)
    }
  }, [statsData])

  const statCards = [
    {
      label: "Today's Orders",
      value: statsData?.today_orders || 0,
      icon: ShoppingCart,
      color: 'text-monero-500',
    },
    {
      label: "Today's Revenue",
      value: `${statsData?.fiat_currency || 'USD'} ${(statsData?.today_revenue_fiat || 0).toFixed(2)}`,
      icon: DollarSign,
      color: 'text-green-500',
    },
    {
      label: "Today's XMR Revenue",
      value: (statsData?.today_revenue_xmr || 0).toFixed(4),
      icon: Activity,
      color: 'text-orange-500',
    },
    {
      label: 'Active Devices',
      value: `${statsData?.active_devices || 0}/${statsData?.total_devices || 0}`,
      icon: Smartphone,
      color: 'text-blue-500',
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
        <p className="text-gray-400">Welcome to Monero SuperPay</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.label}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-gray-400 text-sm mb-2">{stat.label}</p>
                  <p className="text-2xl font-bold">{stat.value}</p>
                </div>
                <Icon className={`${stat.color}`} size={24} />
              </div>
            </Card>
          )
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Monero Node Status */}
        <Card>
          <h2 className="text-lg font-bold mb-4">Monero Node Status</h2>
          {walletStatusLoading ? (
            <p className="text-gray-400">Checking connection...</p>
          ) : (
            <div className="flex items-center justify-between p-4 bg-gray-700/50 rounded-lg border border-gray-600">
              <div className="flex items-center gap-3">
                <div
                  className={`w-3 h-3 rounded-full ${walletStatus?.daemon_connected ? 'bg-green-500' : 'bg-red-500'
                    }`}
                />
                <div>
                  <span className="font-medium">
                    {walletStatus?.daemon_connected ? 'Connected' : 'Offline'}
                  </span>
                  {walletStatus?.daemon_connected && (
                    <p className="text-sm text-gray-400 mt-1">
                      Height: {walletStatus.daemon_height?.toLocaleString() || 'Unknown'}
                    </p>
                  )}
                </div>
              </div>

              {walletStatus?.daemon_connected && (
                <div className="text-right">
                  {!walletStatus.syncing ? (
                    <span className="text-green-400 font-medium flex items-center gap-1">
                      Synced
                    </span>
                  ) : (
                    <div className="flex flex-col items-end">
                      <span className="text-yellow-400 font-medium">Syncing</span>
                      {walletStatus.blocks_to_sync > 0 && (
                        <span className="text-xs text-yellow-500 mt-1">
                          {walletStatus.blocks_to_sync.toLocaleString()} blocks left
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Connected Devices */}
        <Card>
          <h2 className="text-lg font-bold mb-4">Connected Devices</h2>
          {devicesLoading ? (
            <p className="text-gray-400">Loading devices...</p>
          ) : devicesData && devicesData.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {devicesData.map((device) => (
                <div key={device.id} className="p-4 bg-gray-700/50 rounded-lg border border-gray-600">
                  <div className="flex items-center gap-3 mb-2">
                    <div
                      className={`w-3 h-3 rounded-full ${device.is_active ? 'bg-green-500' : 'bg-gray-500'
                        }`}
                    />
                    <span className="font-medium">{device.name}</span>
                  </div>
                  <p className="text-sm text-gray-400">
                    Last seen:{' '}
                    {device.last_seen ? new Date(device.last_seen).toLocaleTimeString() : 'Never'}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400">No devices connected</p>
          )}
        </Card>
      </div>

      {/* Recent Orders */}
      <Card>
        <h2 className="text-lg font-bold mb-4">Recent Orders</h2>
        {orders.length === 0 ? (
          <p className="text-gray-400">No orders yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-3 px-4 font-semibold">Order</th>
                  <th className="text-left py-3 px-4 font-semibold">Customer</th>
                  <th className="text-right py-3 px-4 font-semibold">Total</th>
                  <th className="text-right py-3 px-4 font-semibold">XMR</th>
                  <th className="text-left py-3 px-4 font-semibold">Status</th>
                  <th className="text-left py-3 px-4 font-semibold">Device</th>
                  <th className="text-left py-3 px-4 font-semibold">Time</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    onClick={() => navigate(`/orders?expand=${order.id}`)}
                    className="border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer"
                  >
                    <td className="py-3 px-4 font-mono text-monero-400 hover:underline">#{order.order_number}</td>
                    <td className="py-3 px-4">{order.customer_name || '-'}</td>
                    <td className="py-3 px-4 text-right">${order.total_fiat.toFixed(2)}</td>
                    <td className="py-3 px-4 text-right font-mono">{parseFloat(String(order.total_xmr || '0')).toFixed(4)}</td>
                    <td className="py-3 px-4">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-400">{order.device_name}</td>
                    <td className="py-3 px-4 text-sm text-gray-400">
                      {new Date(order.created_at).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
