import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Search, Copy, Check, Printer, Clock, QrCode } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import Card from '../components/Card'
import StatusBadge from '../components/StatusBadge'
import PaymentScreen from '../components/PaymentScreen'
import { orders as ordersApi, devices as devicesApi } from '../lib/api'
import { useWebSocket } from '../lib/websocket'
import { printReceipt } from '../lib/receipt'

const ITEMS_PER_PAGE = 20

export default function Orders() {
  const [status, setStatus] = useState<string>('')
  const [deviceId, setDeviceId] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [page, setPage] = useState(0)
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [viewPaymentOrder, setViewPaymentOrder] = useState<any>(null)
  const [countdown, setCountdown] = useState(900)
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [confirmAction, setConfirmAction] = useState<{ orderId: string; type: 'deliver' | 'refund' | 'cancel' } | null>(null)

  // Auto-expand an order when navigated from Dashboard with ?expand=<orderId>
  useEffect(() => {
    const expandId = searchParams.get('expand')
    if (expandId) {
      setExpandedOrder(expandId)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams])

  // Instantly refresh orders list when a new order is created
  useWebSocket('order_created', () => {
    queryClient.invalidateQueries({ queryKey: ['orders'] })
  })

  // Refresh orders list when an order is paid
  useWebSocket('order_paid', (data: any) => {
    queryClient.invalidateQueries({ queryKey: ['orders'] })
    if (data && viewPaymentOrder && data.id === viewPaymentOrder.id) {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    }
  })

  const copyToClipboard = async (text: string, label: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopied(label)
      setTimeout(() => setCopied(null), 2000)
    } catch (err) {
      console.error('Copy failed:', err)
    }
  }

  const cancelOrderMutation = useMutation({
    mutationFn: (id: string) => ordersApi.cancel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
  })

  const refundOrderMutation = useMutation({
    mutationFn: (id: string) => ordersApi.refund(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
  })

  // "paid" filter means paid OR delivered (since delivered implies paid and status column shows "Paid" for both)
  const apiStatus = status === 'paid' ? undefined : (status || undefined)

  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ['orders', status, deviceId, page],
    queryFn: () =>
      ordersApi.list({
        status: apiStatus,
        device_id: deviceId || undefined,
        limit: ITEMS_PER_PAGE,
        offset: page * ITEMS_PER_PAGE,
      }),
    refetchInterval: 10000,
  })

  const { data: devicesData } = useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesApi.list(),
  })

  const deliverOrderMutation = useMutation({
    mutationFn: (id: string) => ordersApi.deliver(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
  })

  // Countdown timer for pending orders in payment view
  useEffect(() => {
    if (!viewPaymentOrder || viewPaymentOrder.status !== 'pending') return
    const createdAt = new Date(viewPaymentOrder.created_at).getTime()
    const expiresAt = createdAt + 900 * 1000 // 15 min
    const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
    setCountdown(remaining)
    if (remaining <= 0) return
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [viewPaymentOrder?.id, viewPaymentOrder?.status])

  const filteredOrders =
    ordersData?.filter(
      (order) => {
        // Client-side status filter: "paid" means paid OR delivered
        if (status === 'paid' && order.status !== 'paid' && order.status !== 'delivered') return false
        // Search filter
        if (searchTerm &&
          !String(order.order_number).includes(searchTerm) &&
          !order.id.includes(searchTerm) &&
          !order.customer_name?.toLowerCase().includes(searchTerm.toLowerCase())
        ) return false
        return true
      }
    ) || []

  const statuses = ['pending', 'paid', 'refunded', 'expired', 'cancelled']

  // --- Payment screen overlay ---
  if (viewPaymentOrder) {
    return (
      <PaymentScreen
        order={viewPaymentOrder}
        onBack={() => {
          setViewPaymentOrder(null)
        }}
        onCancel={viewPaymentOrder.status === 'pending' ? () => {
          cancelOrderMutation.mutate(viewPaymentOrder.id)
          setViewPaymentOrder(null)
        } : undefined}
        showCountdown={viewPaymentOrder.status === 'pending'}
        countdown={countdown}
        onPrint={(viewPaymentOrder.status === 'paid' || viewPaymentOrder.status === 'delivered')
          ? () => printReceipt(viewPaymentOrder)
          : undefined}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Orders</h1>
        <p className="text-gray-400">Manage and track all orders</p>
      </div>

      {/* Filters */}
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-3 text-gray-500" size={18} />
              <input
                type="text"
                placeholder="Order # or customer name"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value)
                  setPage(0)
                }}
                className="w-full pl-10"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Status</label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value)
                setPage(0)
              }}
              className="w-full"
            >
              <option value="">All Statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Device</label>
            <select
              value={deviceId}
              onChange={(e) => {
                setDeviceId(e.target.value)
                setPage(0)
              }}
              className="w-full"
            >
              <option value="">All Devices</option>
              <option value="__main__">SuperPay Main</option>
              {devicesData
                ?.filter((device: any) => device.device_type !== 'order_monitor')
                .map((device: any) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Items</label>
            <div className="bg-gray-700/50 px-3 py-2 rounded-lg border border-gray-600 text-gray-400">
              {filteredOrders.length} orders
            </div>
          </div>
        </div>
      </Card>

      {/* Orders Table */}
      <Card>
        {ordersLoading ? (
          <p className="text-gray-400">Loading orders...</p>
        ) : filteredOrders.length === 0 ? (
          <p className="text-gray-400">No orders found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-3 px-4 font-semibold">Order</th>
                  <th className="text-left py-3 px-4 font-semibold">Customer</th>
                  <th className="text-right py-3 px-4 font-semibold">Items</th>
                  <th className="text-right py-3 px-4 font-semibold">Total</th>
                  <th className="text-left py-3 px-4 font-semibold">Status</th>
                  <th className="text-center py-3 px-4 font-semibold shrink-0">Delivered</th>
                  <th className="text-center py-3 px-4 font-semibold">Pay</th>
                  <th className="text-left py-3 px-4 font-semibold">Wallet</th>
                  <th className="text-left py-3 px-4 font-semibold">Device</th>
                  <th className="text-left py-3 px-4 font-semibold">Time</th>
                  <th className="text-center py-3 px-4 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <>
                    <tr
                      key={order.id}
                      onClick={() =>
                        setExpandedOrder(expandedOrder === order.id ? null : order.id)
                      }
                      className="border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer"
                    >
                      <td className="py-3 px-4 font-mono text-monero-400">
                        #{order.order_number}
                      </td>
                      <td className="py-3 px-4">{order.customer_name || '-'}</td>
                      <td className="py-3 px-4 text-right">{order.items.length}</td>
                      <td className="py-3 px-4 text-right font-semibold">
                        ${order.total_fiat.toFixed(2)}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={order.status === 'delivered' ? 'paid' : order.status} />
                      </td>
                      <td className="py-3 px-4 text-center">
                        {order.status === 'paid' ? (
                          <Clock className="w-4 h-4 text-yellow-500 mx-auto" />
                        ) : order.status === 'delivered' ? (
                          <Check className="w-5 h-5 text-green-500 mx-auto" />
                        ) : (
                          <span className="text-gray-600">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {(order.status === 'pending' || order.status === 'paid' || order.status === 'delivered') && order.payment_address && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setViewPaymentOrder(order)
                            }}
                            className="p-1.5 hover:bg-gray-600 rounded-lg transition"
                            title="View Payment"
                          >
                            <QrCode size={16} className="text-monero-400" />
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-400">{order.wallet_name || '-'}</td>
                      <td className="py-3 px-4 text-sm text-gray-400">{order.device_name}</td>
                      <td className="py-3 px-4 text-sm text-gray-400">
                        {new Date(order.created_at).toLocaleTimeString()}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <ChevronDown
                          size={18}
                          className={`mx-auto transition-transform ${expandedOrder === order.id ? 'rotate-180' : ''
                            }`}
                        />
                      </td>
                    </tr>

                    {/* Expanded Details */}
                    {expandedOrder === order.id && (
                      <tr className="border-b border-gray-700/50 bg-gray-700/20">
                        <td colSpan={11} className="py-4 px-4">
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                              <div>
                                <p className="text-gray-400">Full Order ID</p>
                                <div className="flex items-center gap-1">
                                  <p className="font-mono text-monero-400 text-xs">{order.id}</p>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); copyToClipboard(order.id, 'id-' + order.id) }}
                                    className="p-1 hover:bg-gray-600 rounded"
                                    title="Copy Order ID"
                                  >
                                    {copied === 'id-' + order.id ? <Check size={12} className="text-green-400" /> : <Copy size={12} className="text-gray-500" />}
                                  </button>
                                </div>
                              </div>
                              <div>
                                <p className="text-gray-400">Subtotal</p>
                                <p>${(order.subtotal_fiat || 0).toFixed(2)}</p>
                              </div>
                              <div>
                                <p className="text-gray-400">Tax</p>
                                <p>${(order.tax_fiat || 0).toFixed(2)}</p>
                              </div>
                              <div>
                                <p className="text-gray-400">Fiat Total</p>
                                <div className="flex items-center gap-1">
                                  <p>${(order.total_fiat || 0).toFixed(2)}</p>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); copyToClipboard(String((order.total_fiat || 0).toFixed(2)), 'fiat-' + order.id) }}
                                    className="p-1 hover:bg-gray-600 rounded"
                                    title="Copy fiat amount"
                                  >
                                    {copied === 'fiat-' + order.id ? <Check size={12} className="text-green-400" /> : <Copy size={12} className="text-gray-500" />}
                                  </button>
                                </div>
                              </div>
                              <div>
                                <p className="text-gray-400">XMR Amount</p>
                                <div className="flex items-center gap-1">
                                  <p className="font-mono">{parseFloat(String(order.total_xmr || '0')).toFixed(4)} XMR</p>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); copyToClipboard(String(order.total_xmr || '0'), 'xmr-' + order.id) }}
                                    className="p-1 hover:bg-gray-600 rounded"
                                    title="Copy XMR amount"
                                  >
                                    {copied === 'xmr-' + order.id ? <Check size={12} className="text-green-400" /> : <Copy size={12} className="text-gray-500" />}
                                  </button>
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              {order.payment_uri && (
                                <div className="col-span-2">
                                  <p className="text-gray-400">Payment URI</p>
                                  <div className="flex items-center gap-1">
                                    <p className="font-mono text-xs truncate">{order.payment_uri}</p>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); copyToClipboard(order.payment_uri || '', 'uri-' + order.id) }}
                                      className="p-1 hover:bg-gray-600 rounded flex-shrink-0"
                                      title="Copy payment URI"
                                    >
                                      {copied === 'uri-' + order.id ? <Check size={12} className="text-green-400" /> : <Copy size={12} className="text-gray-500" />}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>

                            {order.note && (
                              <div>
                                <p className="text-gray-400 text-sm">Notes</p>
                                <p className="text-sm">{order.note}</p>
                              </div>
                            )}

                            {order.items && order.items.length > 0 && (
                              <div>
                                <p className="text-gray-400 text-sm mb-2">Items</p>
                                <div className="space-y-2">
                                  {order.items.map((item: any, idx: number) => (
                                    <div
                                      key={idx}
                                      className="flex justify-between text-sm bg-gray-800/50 p-2 rounded"
                                    >
                                      <div className="flex-1 min-w-0">
                                        <span>{item.product_name} x{item.quantity} {item.price_unit}</span>
                                        {item.note && (
                                          <span className="ml-2 text-xs text-yellow-400 italic">* {item.note}</span>
                                        )}
                                      </div>
                                      <span className="ml-2 flex-shrink-0">${(item.line_total || 0).toFixed(2)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {order.status === 'paid' && (
                              <div className="text-sm">
                                <p className="text-gray-400">Paid at</p>
                                <p>{order.paid_at ? new Date(order.paid_at).toLocaleString() : '—'}</p>
                              </div>
                            )}

                            {/* Order actions */}
                            <div className="flex gap-2 pt-3 border-t border-gray-700">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  printReceipt(order)
                                }}
                                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded text-sm text-gray-200 transition inline-flex items-center gap-1"
                              >
                                <Printer size={14} />
                                Print Receipt
                              </button>
                              {(order.status === 'pending' || order.status === 'paid' || order.status === 'delivered') && order.payment_address && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setViewPaymentOrder(order)
                                  }}
                                  className="px-3 py-1.5 bg-monero-600/20 hover:bg-monero-600/40 border border-monero-600 rounded text-sm text-monero-200 transition inline-flex items-center gap-1"
                                >
                                  <QrCode size={14} />
                                  {order.status === 'pending' ? 'Open Payment' : 'View Payment'}
                                </button>
                              )}
                              {order.status === 'pending' && (
                                confirmAction?.orderId === order.id && confirmAction?.type === 'cancel' ? (
                                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                    <span className="text-sm text-red-300">Cancel order?</span>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); cancelOrderMutation.mutate(order.id); setConfirmAction(null) }}
                                      className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs text-white font-bold transition"
                                    >Yes</button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setConfirmAction(null) }}
                                      className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs text-white transition"
                                    >No</button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setConfirmAction({ orderId: order.id, type: 'cancel' }) }}
                                    className="px-3 py-1.5 bg-red-900/30 hover:bg-red-900/50 border border-red-700 rounded text-sm text-red-200 transition"
                                  >
                                    Cancel Order
                                  </button>
                                )
                              )}
                              {order.status === 'paid' && (
                                confirmAction?.orderId === order.id && confirmAction?.type === 'refund' ? (
                                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                    <span className="text-sm text-purple-300">Mark refunded?</span>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); refundOrderMutation.mutate(order.id); setConfirmAction(null) }}
                                      className="px-2 py-1 bg-purple-600 hover:bg-purple-700 rounded text-xs text-white font-bold transition"
                                    >Yes</button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setConfirmAction(null) }}
                                      className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs text-white transition"
                                    >No</button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setConfirmAction({ orderId: order.id, type: 'refund' }) }}
                                    className="px-3 py-1.5 bg-purple-900/30 hover:bg-purple-900/50 border border-purple-700 rounded text-sm text-purple-200 transition"
                                  >
                                    Mark Refunded
                                  </button>
                                )
                              )}
                              {order.status === 'paid' && (
                                confirmAction?.orderId === order.id && confirmAction?.type === 'deliver' ? (
                                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                    <span className="text-sm text-green-300">Mark delivered?</span>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); deliverOrderMutation.mutate(order.id); setConfirmAction(null) }}
                                      className="px-2 py-1 bg-green-600 hover:bg-green-700 rounded text-xs text-white font-bold transition"
                                    >Yes</button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setConfirmAction(null) }}
                                      className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs text-white transition"
                                    >No</button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setConfirmAction({ orderId: order.id, type: 'deliver' }) }}
                                    className="px-3 py-1.5 bg-green-900/30 hover:bg-green-900/50 border border-green-700 rounded text-sm text-green-200 transition"
                                  >
                                    Mark Delivered
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {filteredOrders.length > 0 && (
          <div className="flex justify-between items-center mt-4 pt-4 border-t border-gray-700">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-gray-400">
              Page {page + 1} of {Math.ceil((ordersData?.length || 0) / ITEMS_PER_PAGE)}
            </span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={(ordersData?.length || 0) < ITEMS_PER_PAGE}
              className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </Card>
    </div>
  )
}
