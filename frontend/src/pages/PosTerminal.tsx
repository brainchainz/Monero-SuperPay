import { useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Minus, Check, Clock, Package, Printer, Copy, Receipt, DollarSign, LogOut, ShoppingCart, ChevronLeft, QrCode, ClipboardList } from 'lucide-react'
import { QRCodeSVG as QRCode } from 'qrcode.react'
import { posApi, isDevicePaired, pairDevice, unpairDevice, getDeviceInfo, getDeviceType } from '../lib/deviceApi'
import { useWebSocket } from '../lib/websocket'
import type { Product, Order, Category } from '../lib/types'
import { printReceipt } from '../lib/receipt'
import StatusBadge from '../components/StatusBadge'

type View = 'menu' | 'cart' | 'tip' | 'payment' | 'confirmed' | 'orders' | 'custom'

interface CartItem {
  product: Product
  quantity: number
  note?: string
}

export default function PosTerminal() {
  const queryClient = useQueryClient()
  const [isPaired, setIsPaired] = useState(isDevicePaired())
  const [pairingError, setPairingError] = useState('')
  const [pairingInProgress, setPairingInProgress] = useState(false)

  const [view, setView] = useState<View>('menu')
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [notes, setNotes] = useState('')
  const [createdOrder, setCreatedOrder] = useState<Order | null>(null)
  const [countdown, setCountdown] = useState(900) // 15 min
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [showCelebration, setShowCelebration] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [tipAmount, setTipAmount] = useState(0)
  const [customTipInput, setCustomTipInput] = useState('')
  const [showCustomTip, setShowCustomTip] = useState(false)
  const [editingNoteIndex, setEditingNoteIndex] = useState<number | null>(null)
  const [noteInput, setNoteInput] = useState('')

  // Calculator keypad state
  const [calcDisplay, setCalcDisplay] = useState('0')
  const [calcPending, setCalcPending] = useState<number | null>(null)
  const [calcOp, setCalcOp] = useState<string | null>(null)
  const [calcFresh, setCalcFresh] = useState(true) // next digit replaces display
  const [customName, setCustomName] = useState('')

  // Auto-pair from URL param
  // Redirect order_monitor devices to /monitor
  useEffect(() => {
    if (isPaired && getDeviceType() === 'order_monitor') {
      window.location.href = '/monitor'
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
          // If this is an order_monitor device, redirect to /monitor
          if (result.device_type === 'order_monitor') {
            window.location.href = '/monitor'
            return
          }
          setIsPaired(true)
          setPairingError('')
          window.history.replaceState({}, '', '/pos')
        })
        .catch((err) => {
          setPairingError(err.message || 'Pairing failed')
        })
        .finally(() => setPairingInProgress(false))
    }
  }, [isPaired])

  // Heartbeat every 60 seconds
  useEffect(() => {
    if (!isPaired) return
    posApi.heartbeat()
    const interval = setInterval(() => posApi.heartbeat(), 60000)
    return () => clearInterval(interval)
  }, [isPaired])

  // Fetch data
  const { data: products = [] } = useQuery({
    queryKey: ['pos-products'],
    queryFn: () => posApi.products.list(),
    enabled: isPaired,
    staleTime: 60000,
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['pos-categories'],
    queryFn: () => posApi.categories.list(),
    enabled: isPaired,
  })

  const { data: posSettings } = useQuery({
    queryKey: ['pos-settings'],
    queryFn: () => posApi.settings.get(),
    enabled: isPaired,
  })

  const { data: exchangeRate } = useQuery({
    queryKey: ['pos-rate', posSettings?.fiat_currency || 'USD'],
    queryFn: () => posApi.rate.get(posSettings?.fiat_currency || 'USD'),
    enabled: isPaired,
    refetchInterval: 30000,
  })

  const { data: recentOrders = [] } = useQuery({
    queryKey: ['pos-orders'],
    queryFn: () => posApi.orders.list({ limit: 20 }),
    enabled: isPaired && view === 'orders',
  })

  const taxRate = posSettings?.tax_rate || 0
  const currency = posSettings?.fiat_currency || 'USD'
  const businessName = posSettings?.business_name || 'Monero SuperPay'

  // Cart calculations
  const subtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
  const tax = subtotal * (taxRate / 100)
  const total = subtotal + tax
  const totalXmr = exchangeRate?.rate ? total / exchangeRate.rate : 0

  // Group products by category for display
  const activeProducts = products.filter((p: Product) => p.active)

  const getCategoryProducts = () => {
    if (selectedCategory) {
      return [{ category: categories.find((c: Category) => c.id === selectedCategory) || null, products: activeProducts.filter((p: Product) => p.category_id === selectedCategory) }]
    }

    const grouped: { category: Category | null; products: Product[] }[] = []
    const categorized = new Map<string, Product[]>()
    const uncategorized: Product[] = []

    for (const product of activeProducts) {
      if (product.category_id) {
        const existing = categorized.get(product.category_id) || []
        existing.push(product)
        categorized.set(product.category_id, existing)
      } else {
        uncategorized.push(product)
      }
    }

    for (const cat of categories) {
      const catProducts = categorized.get(cat.id)
      if (catProducts && catProducts.length > 0) {
        grouped.push({ category: cat, products: catProducts })
      }
    }

    if (uncategorized.length > 0) {
      grouped.push({ category: null, products: uncategorized })
    }

    return grouped
  }

  // Totals with tip
  const totalWithTip = total + tipAmount
  const totalXmrWithTip = exchangeRate?.rate ? totalWithTip / exchangeRate.rate : 0

  // Create order mutation
  const createOrderMutation = useMutation({
    mutationFn: () => {
      const items = cart.map((item) => ({
        product_id: item.product.id,
        product_name: item.product.name,
        quantity: item.quantity,
        unit_price: item.product.price,
        line_total: item.product.price * item.quantity,
        note: item.note || '',
      }))

      // Add tip as a line item if present
      if (tipAmount > 0) {
        items.push({
          product_id: undefined as any,
          product_name: 'Tip',
          quantity: 1,
          unit_price: tipAmount,
          line_total: tipAmount,
          note: '',
        })
      }

      return posApi.orders.create({
        items,
        customer_name: customerName || undefined,
        note: notes || undefined,
        subtotal_fiat: subtotal,
        tax_fiat: tax,
        total_fiat: totalWithTip,
        fiat_currency: currency,
        total_xmr: totalXmrWithTip.toFixed(12),
        xmr_rate: exchangeRate?.rate || 0,
      })
    },
    onSuccess: (order) => {
      setCreatedOrder(order)
      setView('payment')
      setCountdown(900)
      setTipAmount(0)
      setCustomTipInput('')
      setShowCustomTip(false)
    },
  })

  const deliverOrderMutation = useMutation({
    mutationFn: (id: string) => posApi.orders.deliverOrder(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pos-orders'] }),
  })

  // Listen for payment confirmation
  useWebSocket('order_paid', (data: any) => {
    if (data && createdOrder && data.id === createdOrder.id) {
      setShowCelebration(true)
      // Auto-dismiss after 4 seconds and go back to menu
      setTimeout(() => {
        setShowCelebration(false)
        setCreatedOrder(null)
        setCart([])
        setCustomerName('')
        setNotes('')
        setCountdown(900)
        setView('menu')
      }, 4000)
    }
  })

  // Countdown timer
  useEffect(() => {
    if (view !== 'payment' || countdown <= 0) return
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setView('menu')
          setCreatedOrder(null)
          return 900
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [view, countdown])

  // Polling fallback for payment confirmation (WebSocket can be unreliable on mobile)
  useEffect(() => {
    if (view !== 'payment' || !createdOrder) return
    const poll = setInterval(async () => {
      try {
        const order = await posApi.orders.get(createdOrder.id)
        if (order && (order.status === 'paid' || order.status === 'delivered')) {
          clearInterval(poll)
          setShowCelebration(true)
          setTimeout(() => {
            setShowCelebration(false)
            setCreatedOrder(null)
            setCart([])
            setCustomerName('')
            setNotes('')
            setCountdown(900)
            setView('menu')
          }, 4000)
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000)
    return () => clearInterval(poll)
  }, [view, createdOrder?.id])

  // Disable pull-to-refresh on mobile browsers
  useEffect(() => {
    document.documentElement.style.overscrollBehavior = 'none'
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.documentElement.style.overscrollBehavior = ''
      document.body.style.overscrollBehavior = ''
    }
  }, [])

  const addToCart = useCallback((product: Product) => {
    setCart((prev) => {
      // Match items with same product and no note
      const existingIdx = prev.findIndex((item) => item.product.id === product.id && !item.note)
      if (existingIdx >= 0) {
        return prev.map((item, idx) =>
          idx === existingIdx ? { ...item, quantity: item.quantity + 1 } : item
        )
      }
      return [...prev, { product, quantity: 1 }]
    })
  }, [])

  const updateQuantity = useCallback((cartIndex: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((item, idx) =>
          idx === cartIndex
            ? { ...item, quantity: Math.max(0, item.quantity + delta) }
            : item
        )
        .filter((item) => item.quantity > 0)
    )
  }, [])

  const addNoteToItem = useCallback((cartIndex: number, note: string) => {
    setCart((prev) => {
      const item = prev[cartIndex]
      if (!item) return prev
      const trimmed = note.trim()
      if (item.quantity <= 1) {
        // Single item — just set/update the note
        return prev.map((it, idx) => idx === cartIndex ? { ...it, note: trimmed || undefined } : it)
      }
      // Multiple qty — split: reduce original by 1, add new entry with note and qty 1
      const updated = prev.map((it, idx) =>
        idx === cartIndex ? { ...it, quantity: it.quantity - 1 } : it
      )
      updated.push({ product: item.product, quantity: 1, note: trimmed || undefined })
      return updated
    })
    setEditingNoteIndex(null)
    setNoteInput('')
  }, [])

  const clearCart = () => {
    setCart([])
    setCustomerName('')
    setNotes('')
    setTipAmount(0)
    setCustomTipInput('')
    setShowCustomTip(false)
  }

  const newOrder = async () => {
    // Cancel the order on the backend before clearing local state
    if (createdOrder?.id) {
      try {
        await posApi.orders.cancelOrder(createdOrder.id)
      } catch (err) {
        console.error('Failed to cancel order:', err)
      }
    }
    clearCart()
    setCreatedOrder(null)
    setView('menu')
  }

  const copyToClipboard = async (text: string, field: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        // Fallback for non-HTTPS contexts (e.g. Umbrel over HTTP)
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    } catch (err) {
      console.error('Copy failed:', err)
    }
  }

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const handleLogout = () => {
    if (window.confirm('Unpair this device? You will need to scan a new QR code to reconnect.')) {
      unpairDevice()
      setIsPaired(false)
    }
  }

  // Calculator keypad handlers
  const calcEvaluate = (left: number, op: string, right: number): number => {
    switch (op) {
      case '+': return left + right
      case '-': return left - right
      case '×': return left * right
      default: return right
    }
  }

  const calcHandleDigit = (d: string) => {
    if (calcFresh) {
      if (d === '.') {
        setCalcDisplay('0.')
      } else {
        setCalcDisplay(d)
      }
      setCalcFresh(false)
    } else {
      if (d === '.' && calcDisplay.includes('.')) return
      // Limit decimal places to 2
      const dotIdx = calcDisplay.indexOf('.')
      if (dotIdx !== -1 && calcDisplay.length - dotIdx > 2) return
      setCalcDisplay(calcDisplay === '0' && d !== '.' ? d : calcDisplay + d)
    }
  }

  const calcHandleOp = (op: string) => {
    const current = parseFloat(calcDisplay) || 0
    if (calcPending !== null && calcOp && !calcFresh) {
      const result = calcEvaluate(calcPending, calcOp, current)
      const rounded = +result.toFixed(2)
      setCalcDisplay(rounded.toString())
      setCalcPending(rounded)
    } else {
      setCalcPending(current)
    }
    setCalcOp(op)
    setCalcFresh(true)
  }

  const calcHandleEquals = () => {
    if (calcPending !== null && calcOp) {
      const current = parseFloat(calcDisplay) || 0
      const result = calcEvaluate(calcPending, calcOp, current)
      const rounded = +result.toFixed(2)
      setCalcDisplay(rounded.toString())
      setCalcPending(null)
      setCalcOp(null)
      setCalcFresh(true)
    }
  }

  const calcHandleClear = () => {
    setCalcDisplay('0')
    setCalcPending(null)
    setCalcOp(null)
    setCalcFresh(true)
  }

  const calcHandleBackspace = () => {
    if (calcFresh) return
    if (calcDisplay.length <= 1 || (calcDisplay.length === 2 && calcDisplay.startsWith('-'))) {
      setCalcDisplay('0')
      setCalcFresh(true)
    } else {
      setCalcDisplay(calcDisplay.slice(0, -1))
    }
  }

  const calcTotal = parseFloat(calcDisplay) || 0

  const addCustomToCart = () => {
    const price = Math.abs(calcTotal)
    if (price <= 0) return

    const customProduct: Product = {
      id: `custom-${Date.now()}`,
      name: customName || 'Custom Item',
      description: '',
      price,
      price_unit: 'each',
      category_id: '',
      active: true,
      created_at: new Date().toISOString(),
    }

    setCart((prev) => [...prev, { product: customProduct, quantity: 1 }])
    calcHandleClear()
    setCustomName('')
    setView('cart')
  }

  // --- Not paired: show pairing screen ---
  if (!isPaired) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
        <div className="bg-gray-800 rounded-2xl p-8 max-w-md w-full text-center border border-gray-700">
          <img src="/logo.png" alt="Monero SuperPay" className="w-16 h-16 rounded-2xl object-contain mx-auto mb-6" />
          <h1 className="text-2xl font-bold mb-2">Monero SuperPay</h1>
          <p className="text-gray-400 mb-6">Point of Sale Terminal</p>

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
                <div className="text-6xl">📱</div>
              </div>
              <p className="text-gray-500 text-xs">
                Go to Dashboard → Devices → Add Device to generate a QR code
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // --- Payment celebration overlay ---
  if (showCelebration && createdOrder) {
    const confettiColors = ['#FF6600', '#FF8533', '#22c55e', '#4ade80', '#fbbf24', '#f97316', '#ffffff']
    const confetti = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.8,
      duration: 1.5 + Math.random() * 2,
      color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
      size: 4 + Math.random() * 8,
      drift: -30 + Math.random() * 60,
    }))

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(circle at center, rgba(34,197,94,0.3) 0%, rgba(17,24,39,0.98) 70%)',
            animation: 'celebrationBg 0.6s ease-out',
          }}
        />
        {confetti.map((c) => (
          <div
            key={c.id}
            style={{
              position: 'absolute',
              left: `${c.left}%`,
              top: '-10px',
              width: `${c.size}px`,
              height: `${c.size * 0.6}px`,
              backgroundColor: c.color,
              borderRadius: '2px',
              animation: `confettiFall ${c.duration}s ease-in ${c.delay}s forwards`,
              transform: `rotate(${Math.random() * 360}deg)`,
              opacity: 0,
              ['--drift' as any]: `${c.drift}px`,
            }}
          />
        ))}
        <div className="relative z-10 text-center" style={{ animation: 'celebrationPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both' }}>
          <div
            className="w-28 h-28 rounded-full flex items-center justify-center mx-auto mb-6"
            style={{
              background: 'linear-gradient(135deg, #FF6600, #FF8533)',
              boxShadow: '0 0 60px rgba(255,102,0,0.5), 0 0 120px rgba(255,102,0,0.2)',
              animation: 'checkPulse 1.5s ease-in-out infinite',
            }}
          >
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" style={{ strokeDasharray: 30, strokeDashoffset: 30, animation: 'checkDraw 0.6s ease-out 0.3s forwards' }} />
            </svg>
          </div>
          <h2 className="text-4xl font-black mb-2" style={{ color: '#22c55e', textShadow: '0 0 30px rgba(34,197,94,0.3)' }}>
            Payment Received!
          </h2>
          <p className="text-xl text-gray-300 mb-2">
            {parseFloat(createdOrder.total_xmr || '0').toFixed(4)} XMR
          </p>
          <p className="text-gray-500">
            ${createdOrder.total_fiat.toFixed(2)} — Order #{createdOrder.order_number || createdOrder.id.slice(0, 8)}
          </p>
          <button
            onClick={(e) => {
              e.stopPropagation()
              printReceipt(createdOrder)
            }}
            className="mt-5 px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-medium text-sm inline-flex items-center gap-2 transition"
          >
            <Printer size={18} />
            Print Receipt
          </button>
        </div>
        <style>{`
          @keyframes celebrationBg { 0% { opacity: 0; transform: scale(0.8); } 50% { background: radial-gradient(circle at center, rgba(34,197,94,0.5) 0%, rgba(17,24,39,0.98) 70%); } 100% { opacity: 1; transform: scale(1); } }
          @keyframes celebrationPop { 0% { opacity: 0; transform: scale(0.3); } 100% { opacity: 1; transform: scale(1); } }
          @keyframes checkDraw { to { stroke-dashoffset: 0; } }
          @keyframes checkPulse { 0%, 100% { box-shadow: 0 0 60px rgba(255,102,0,0.5), 0 0 120px rgba(255,102,0,0.2); } 50% { box-shadow: 0 0 80px rgba(255,102,0,0.7), 0 0 160px rgba(255,102,0,0.3); } }
          @keyframes confettiFall { 0% { opacity: 1; transform: translateY(0) translateX(0) rotate(0deg); } 100% { opacity: 0; transform: translateY(100vh) translateX(var(--drift)) rotate(720deg); } }
        `}</style>
      </div>
    )
  }

  // --- Payment waiting screen ---
  if (view === 'payment' && createdOrder) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center p-4 overflow-y-auto">
        {/* Back button — in document flow to avoid overlap */}
        <button
          onClick={() => setView('menu')}
          className="self-start inline-flex items-center gap-3 text-gray-400 hover:text-white transition px-4 py-3 rounded-xl hover:bg-gray-800 mb-2"
        >
          <ChevronLeft size={32} />
          <span className="text-lg font-semibold">Back</span>
        </button>

        <div className="bg-gray-800 rounded-2xl p-6 max-w-2xl w-full border border-gray-700">
          <h2 className="text-xl font-bold text-center mb-1">Waiting for Payment</h2>
          <p className="text-center text-gray-400 text-sm mb-4">
            Order #{createdOrder.order_number || createdOrder.id.slice(0, 8)}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: QR + copyable fields */}
            <div>
              <div className="bg-white p-5 rounded-xl mb-3 flex justify-center">
                {createdOrder.payment_uri ? (
                  <QRCode value={createdOrder.payment_uri} size={220} level="H" />
                ) : (
                  <div className="w-[220px] h-[220px] flex items-center justify-center text-gray-400 text-sm text-center">
                    No payment URI — check wallet-rpc
                  </div>
                )}
              </div>

              {/* XMR Amount — 1-click copy */}
              <button
                onClick={() => copyToClipboard(parseFloat(createdOrder.total_xmr || '0').toFixed(12), 'xmr')}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-gray-700/50 hover:bg-gray-700 rounded-lg mb-2 transition group"
              >
                <div className="text-left min-w-0">
                  <p className="text-xs text-gray-400">Amount</p>
                  <p className="font-mono text-monero-400 font-bold text-sm truncate">
                    {parseFloat(createdOrder.total_xmr || '0').toFixed(12)} XMR
                  </p>
                </div>
                {copiedField === 'xmr' ? <Check size={14} className="text-green-400 flex-shrink-0" /> : <Copy size={14} className="text-gray-500 group-hover:text-gray-300 flex-shrink-0" />}
              </button>

              {/* Subaddress — 1-click copy */}
              {createdOrder.payment_address && (
                <button
                  onClick={() => copyToClipboard(createdOrder.payment_address, 'addr')}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-gray-700/50 hover:bg-gray-700 rounded-lg mb-2 transition group"
                >
                  <div className="text-left min-w-0">
                    <p className="text-xs text-gray-400">Subaddress</p>
                    <p className="font-mono text-xs break-all leading-relaxed">{createdOrder.payment_address}</p>
                  </div>
                  {copiedField === 'addr' ? <Check size={14} className="text-green-400 flex-shrink-0" /> : <Copy size={14} className="text-gray-500 group-hover:text-gray-300 flex-shrink-0" />}
                </button>
              )}
            </div>

            {/* Right: Cart items + totals + countdown */}
            <div className="flex flex-col">
              {/* Items list — Tip always sorted to the bottom */}
              {createdOrder.items && createdOrder.items.length > 0 && (
                <div className="bg-gray-700/30 rounded-lg p-3 mb-3 flex-1">
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Items</p>
                  <div className="space-y-1.5">
                    {[...createdOrder.items]
                      .sort((a: any, b: any) => {
                        const aIsTip = a.product_name?.toLowerCase() === 'tip' ? 1 : 0
                        const bIsTip = b.product_name?.toLowerCase() === 'tip' ? 1 : 0
                        return aIsTip - bIsTip
                      })
                      .map((item: any, idx: number) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <div className="text-gray-300 flex-1 min-w-0">
                          {item.product_name}{item.quantity > 1 ? ` x${item.quantity}` : ''}
                          {item.note && <span className="ml-1 text-xs text-yellow-400 italic">* {item.note}</span>}
                        </div>
                        <span className="font-mono ml-2">${(item.line_total || 0).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Total + Tax */}
              <div className="bg-gray-700/50 rounded-lg p-3 mb-3">
                <div className="flex justify-between text-base font-bold">
                  <span>Total</span>
                  <span>${(createdOrder.total_fiat || 0).toFixed(2)}</span>
                </div>
                {(createdOrder.tax_fiat || 0) > 0 && (
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>includes tax</span>
                    <span>${(createdOrder.tax_fiat || 0).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm text-monero-400 mt-2 pt-2 border-t border-gray-600">
                  <span>XMR</span>
                  <span className="font-mono font-bold">{parseFloat(createdOrder.total_xmr || '0').toFixed(4)}</span>
                </div>
              </div>

              {/* Countdown */}
              <div className="text-center p-2.5 bg-yellow-900/20 border border-yellow-700 rounded-lg mb-3">
                <p className="text-yellow-200 font-medium text-sm">Expires in {formatCountdown(countdown)}</p>
                <p className="text-xs text-gray-400 mt-0.5">Scan QR with Monero wallet</p>
              </div>

              <button
                onClick={newOrder}
                className="w-full px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-medium transition"
              >
                Cancel Order
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // --- Tip selection screen ---
  if (view === 'tip') {
    const tipPresets = [
      { label: '10%', amount: +(total * 0.10).toFixed(2) },
      { label: '15%', amount: +(total * 0.15).toFixed(2) },
      { label: '20%', amount: +(total * 0.20).toFixed(2) },
    ]

    const handleSelectTip = (amount: number) => {
      setTipAmount(amount)
    }

    const handleConfirmTip = () => {
      createOrderMutation.mutate()
    }

    const handleSkipTip = () => {
      setTipAmount(0)
      createOrderMutation.mutate()
    }

    const handleCustomTipConfirm = () => {
      const parsed = parseFloat(customTipInput)
      if (!isNaN(parsed) && parsed > 0) {
        setTipAmount(+(parsed).toFixed(2))
        setShowCustomTip(false)
      }
    }

    const currentTotalWithTip = total + tipAmount
    const currentXmrWithTip = exchangeRate?.rate ? currentTotalWithTip / exchangeRate.rate : 0

    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4">
        <div className="bg-gray-800 rounded-2xl p-6 max-w-md w-full border border-gray-700">
          {/* Order summary */}
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold mb-1">Add a Tip?</h2>
            <p className="text-gray-400 text-sm">Order total: ${total.toFixed(2)}</p>
          </div>

          {/* Tip preset buttons */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {tipPresets.map((preset) => (
              <button
                key={preset.label}
                onClick={() => { handleSelectTip(preset.amount); setShowCustomTip(false); setCustomTipInput('') }}
                className={`py-4 rounded-xl text-center transition active:scale-95 border-2 ${
                  tipAmount === preset.amount && !showCustomTip
                    ? 'border-monero-500 bg-monero-600/20'
                    : 'border-gray-600 bg-gray-700/50 hover:border-gray-500'
                }`}
              >
                <p className="text-lg font-bold">{preset.label}</p>
                <p className="text-sm text-gray-400">${preset.amount.toFixed(2)}</p>
              </button>
            ))}
          </div>

          {/* Custom tip */}
          {!showCustomTip ? (
            <button
              onClick={() => { setShowCustomTip(true); setTipAmount(0) }}
              className={`w-full py-3 rounded-xl text-center transition border-2 mb-4 ${
                showCustomTip
                  ? 'border-monero-500 bg-monero-600/20'
                  : 'border-gray-600 bg-gray-700/50 hover:border-gray-500'
              }`}
            >
              <span className="font-medium">Custom Amount</span>
            </button>
          ) : (
            <div className="mb-4 space-y-2">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                  <input
                    type="number"
                    value={customTipInput}
                    onChange={(e) => setCustomTipInput(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-8 pr-3 py-3 bg-gray-700 border border-gray-600 rounded-xl text-lg font-mono focus:border-monero-500 focus:outline-none"
                    autoFocus
                    min="0"
                    step="0.01"
                  />
                </div>
                <button
                  onClick={handleCustomTipConfirm}
                  disabled={!customTipInput || parseFloat(customTipInput) <= 0}
                  className="px-5 py-3 bg-monero-600 hover:bg-monero-700 disabled:opacity-50 rounded-xl font-bold transition"
                >
                  Set
                </button>
              </div>
              <button
                onClick={() => { setShowCustomTip(false); setCustomTipInput('') }}
                className="text-sm text-gray-500 hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Updated total */}
          <div className="bg-gray-700/50 rounded-xl p-4 mb-4 space-y-1">
            <div className="flex justify-between text-sm text-gray-400">
              <span>Subtotal</span>
              <span>${total.toFixed(2)}</span>
            </div>
            {tipAmount > 0 && (
              <div className="flex justify-between text-sm text-green-400">
                <span>Tip</span>
                <span>+${tipAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg border-t border-gray-600 pt-2 mt-2">
              <span>Total</span>
              <span>${currentTotalWithTip.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-monero-400">
              <span>XMR</span>
              <span className="font-mono">{currentXmrWithTip.toFixed(4)} XMR</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => setView('cart')}
              className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-medium transition"
            >
              Back
            </button>
            {tipAmount > 0 ? (
              <button
                onClick={handleConfirmTip}
                disabled={createOrderMutation.isPending}
                className="flex-1 px-4 py-3 bg-monero-600 hover:bg-monero-700 disabled:opacity-50 rounded-xl font-bold text-lg transition"
              >
                {createOrderMutation.isPending ? 'Creating...' : `Pay $${currentTotalWithTip.toFixed(2)}`}
              </button>
            ) : (
              <button
                onClick={handleSkipTip}
                disabled={createOrderMutation.isPending}
                className="flex-1 px-4 py-3 bg-monero-600 hover:bg-monero-700 disabled:opacity-50 rounded-xl font-bold text-lg transition"
              >
                {createOrderMutation.isPending ? 'Creating...' : 'No Tip'}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // --- Computed values needed by nav bar + views ---
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  const deviceInfo = getDeviceInfo()
  const categoryGroups = getCategoryProducts()

  // --- Orders content (rendered below shared nav bar) ---
  const ordersContent = (
      <div className="flex-1 overflow-y-auto">
        {selectedOrder ? (
          <div className="p-4 max-w-lg mx-auto">
            <button
              onClick={() => setSelectedOrder(null)}
              className="flex items-center gap-1 text-gray-400 hover:text-white mb-4 text-sm"
            >
              <ChevronLeft size={16} /> Back to orders
            </button>

            <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm text-gray-400">Order #{selectedOrder.order_number || selectedOrder.id.slice(0, 8)}</p>
                  {selectedOrder.customer_name && (
                    <p className="text-base font-medium text-white">{selectedOrder.customer_name}</p>
                  )}
                  <p className="text-xs text-gray-500">{new Date(selectedOrder.created_at).toLocaleString()}</p>
                </div>
                <StatusBadge status={selectedOrder.status} />
              </div>

              <div className="space-y-2">
                {selectedOrder.items?.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <div className="text-gray-300 flex-1 min-w-0">
                      {item.quantity}x {item.name || item.product_name}
                      {item.note && <span className="ml-1 text-xs text-yellow-400 italic">* {item.note}</span>}
                    </div>
                    <span className="font-mono ml-2">${(item.quantity * item.unit_price).toFixed(2)}</span>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-700 pt-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Subtotal</span>
                  <span>${selectedOrder.subtotal_fiat?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Tax</span>
                  <span>${selectedOrder.tax_fiat?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>Total</span>
                  <span>${selectedOrder.total_fiat.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-monero-400 text-sm">
                  <span>XMR</span>
                  <span className="font-mono">{parseFloat(selectedOrder.total_xmr || '0').toFixed(4)}</span>
                </div>
              </div>

              {/* Show Payment button — full width, prominent */}
              {(selectedOrder.status === 'pending' || selectedOrder.status === 'paid' || selectedOrder.status === 'delivered') && selectedOrder.payment_address && (
                <button
                  onClick={() => {
                    // Reconstruct payment_uri if missing (list API doesn't include it)
                    const orderWithUri = {
                      ...selectedOrder,
                      payment_uri: selectedOrder.payment_uri
                        || `monero:${selectedOrder.payment_address}?tx_amount=${selectedOrder.total_xmr}`,
                    }
                    setCreatedOrder(orderWithUri)
                    // Calculate remaining countdown from created_at
                    const createdAt = new Date(selectedOrder.created_at).getTime()
                    const remaining = Math.max(0, Math.floor((createdAt + 900000 - Date.now()) / 1000))
                    setCountdown(remaining)
                    setView('payment')
                  }}
                  className={`w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-sm font-medium transition ${
                    selectedOrder.status === 'pending'
                      ? 'bg-monero-600 hover:bg-monero-700'
                      : 'bg-green-700/30 hover:bg-green-700/50 border border-green-600'
                  }`}
                >
                  <QrCode size={16} />
                  {selectedOrder.status === 'pending' ? 'Open Payment' : 'View Payment'}
                </button>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => copyToClipboard(selectedOrder.id, 'order-id')}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition"
                >
                  {copiedField === 'order-id' ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                  Order ID
                </button>
                <button
                  onClick={() => copyToClipboard(parseFloat(selectedOrder.total_xmr || '0').toFixed(12), 'order-xmr')}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition"
                >
                  {copiedField === 'order-xmr' ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                  XMR Amount
                </button>
                {(selectedOrder.status === 'paid' || selectedOrder.status === 'delivered') && (
                  <button
                    onClick={() => printReceipt(selectedOrder)}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-monero-600 hover:bg-monero-700 rounded-lg text-xs font-medium transition"
                  >
                    <Printer size={12} />
                    Print
                  </button>
                )}
                {selectedOrder.status === 'paid' && (
                  <button
                    onClick={() => deliverOrderMutation.mutate(selectedOrder.id)}
                    disabled={deliverOrderMutation.isPending}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-xs font-medium transition"
                  >
                    <Package size={12} />
                    {deliverOrderMutation.isPending ? 'Delivering...' : 'Mark Delivered'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 max-w-lg mx-auto space-y-2">
            {recentOrders.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Receipt size={48} className="mx-auto mb-3 opacity-50" />
                <p>No orders yet</p>
              </div>
            ) : (
              recentOrders.map((order) => (
                <button
                  key={order.id}
                  onClick={() => setSelectedOrder(order)}
                  className="w-full bg-gray-800 border border-gray-700 hover:border-gray-600 rounded-xl p-4 text-left transition"
                >
                  <div className="flex justify-between items-center mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-sm text-monero-400">
                        #{order.order_number}
                      </span>
                      {order.customer_name && (
                        <span className="text-sm font-medium text-white truncate">
                          {order.customer_name}
                        </span>
                      )}
                    </div>
                    <span className="text-sm text-gray-400 flex-shrink-0">
                      {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="font-bold">${order.total_fiat.toFixed(2)}</span>
                    <div className="flex items-center gap-2">
                      {order.status === 'paid' && <Clock className="w-4 h-4 text-yellow-500" />}
                      {order.status === 'delivered' && <Check className="w-4 h-4 text-green-500" />}
                      <StatusBadge status={order.status} />
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
  )

  // --- Custom item calculator content (rendered below shared nav bar) ---
  const exprDisplay = calcPending !== null && calcOp
    ? `${calcPending} ${calcOp}`
    : ''

  const customContent = (
      <div className="flex-1 flex flex-col p-4 max-w-md mx-auto w-full">
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Item name (optional)"
            className="w-full mb-4 text-center text-sm"
          />

          {/* Calculator display */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-4">
            <div className="text-right text-gray-500 text-sm h-5 font-mono">
              {exprDisplay}
            </div>
            <div className="text-right text-4xl font-bold font-mono text-monero-400 truncate">
              ${calcDisplay}
            </div>
          </div>

          {/* Calculator keypad grid: 4 cols */}
          <div className="grid grid-cols-4 gap-2 flex-1">
            {/* Row 1: C, ←, ×, - */}
            <button
              onClick={calcHandleClear}
              className="py-4 bg-red-900/30 hover:bg-red-900/50 border border-red-700/50 rounded-xl text-lg font-bold transition active:scale-95 text-red-200"
            >
              C
            </button>
            <button
              onClick={calcHandleBackspace}
              className="py-4 bg-gray-700 hover:bg-gray-600 rounded-xl text-lg font-bold transition active:scale-95"
            >
              ←
            </button>
            <button
              onClick={() => calcHandleOp('×')}
              className={`py-4 rounded-xl text-lg font-bold transition active:scale-95 ${calcOp === '×' ? 'bg-monero-600 text-white' : 'bg-yellow-900/30 hover:bg-yellow-900/50 border border-yellow-700/50 text-yellow-200'
                }`}
            >
              ×
            </button>
            <button
              onClick={() => calcHandleOp('-')}
              className={`py-4 rounded-xl text-lg font-bold transition active:scale-95 ${calcOp === '-' ? 'bg-monero-600 text-white' : 'bg-yellow-900/30 hover:bg-yellow-900/50 border border-yellow-700/50 text-yellow-200'
                }`}
            >
              −
            </button>

            {/* Row 2: 7 8 9 + */}
            <button onClick={() => calcHandleDigit('7')} className="py-4 bg-gray-700 hover:bg-gray-600 rounded-xl text-2xl font-bold transition active:scale-95">7</button>
            <button onClick={() => calcHandleDigit('8')} className="py-4 bg-gray-700 hover:bg-gray-600 rounded-xl text-2xl font-bold transition active:scale-95">8</button>
            <button onClick={() => calcHandleDigit('9')} className="py-4 bg-gray-700 hover:bg-gray-600 rounded-xl text-2xl font-bold transition active:scale-95">9</button>
            <button
              onClick={() => calcHandleOp('+')}
              className={`py-4 row-span-2 rounded-xl text-lg font-bold transition active:scale-95 ${calcOp === '+' ? 'bg-monero-600 text-white' : 'bg-yellow-900/30 hover:bg-yellow-900/50 border border-yellow-700/50 text-yellow-200'
                }`}
            >
              +
            </button>

            {/* Row 3: 4 5 6 (+ continues) */}
            <button onClick={() => calcHandleDigit('4')} className="py-4 bg-gray-700 hover:bg-gray-600 rounded-xl text-2xl font-bold transition active:scale-95">4</button>
            <button onClick={() => calcHandleDigit('5')} className="py-4 bg-gray-700 hover:bg-gray-600 rounded-xl text-2xl font-bold transition active:scale-95">5</button>
            <button onClick={() => calcHandleDigit('6')} className="py-4 bg-gray-700 hover:bg-gray-600 rounded-xl text-2xl font-bold transition active:scale-95">6</button>

            {/* Row 4: 1 2 3 = */}
            <button onClick={() => calcHandleDigit('1')} className="py-4 bg-gray-700 hover:bg-gray-600 rounded-xl text-2xl font-bold transition active:scale-95">1</button>
            <button onClick={() => calcHandleDigit('2')} className="py-4 bg-gray-700 hover:bg-gray-600 rounded-xl text-2xl font-bold transition active:scale-95">2</button>
            <button onClick={() => calcHandleDigit('3')} className="py-4 bg-gray-700 hover:bg-gray-600 rounded-xl text-2xl font-bold transition active:scale-95">3</button>
            <button
              onClick={calcHandleEquals}
              className="py-4 row-span-2 bg-monero-600 hover:bg-monero-700 rounded-xl text-lg font-bold transition active:scale-95"
            >
              =
            </button>

            {/* Row 5: 0 . (= continues) */}
            <button onClick={() => calcHandleDigit('0')} className="py-4 col-span-2 bg-gray-700 hover:bg-gray-600 rounded-xl text-2xl font-bold transition active:scale-95">0</button>
            <button onClick={() => calcHandleDigit('.')} className="py-4 bg-gray-700 hover:bg-gray-600 rounded-xl text-2xl font-bold transition active:scale-95">.</button>
          </div>

          {/* Add to cart button */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => { setView('menu'); calcHandleClear(); setCustomName('') }}
              className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-medium transition"
            >
              Cancel
            </button>
            <button
              onClick={addCustomToCart}
              disabled={calcTotal <= 0}
              className="flex-1 px-4 py-3 bg-monero-600 hover:bg-monero-700 disabled:opacity-50 rounded-xl font-bold text-lg transition"
            >
              Add ${Math.abs(calcTotal).toFixed(2)} to Cart
            </button>
          </div>
      </div>
  )

  // --- Main layout with persistent nav bar ---
  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Top bar — always visible */}
      <div className="sticky top-0 bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center gap-3 z-10">
        <img src="/logo.png" alt="Monero SuperPay" className="w-10 h-10 rounded-xl object-contain" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold leading-tight truncate">{businessName}</h1>
          <p className="text-xs text-gray-500 truncate">{deviceInfo.name || 'PoS Terminal'}</p>
        </div>

        {/* Nav icons — waiter workflow: Orders → Products → Custom Item → Cart → Logout */}
        <button
          onClick={() => { setView('orders'); setSelectedOrder(null) }}
          className={`p-2 rounded-lg transition relative ${view === 'orders' ? 'bg-monero-600/20 text-monero-400' : 'hover:bg-gray-700 text-gray-400'}`}
          title="Orders"
        >
          <ClipboardList size={20} />
        </button>

        <button
          onClick={() => setView('menu')}
          className={`p-2 rounded-lg transition ${view === 'menu' ? 'bg-monero-600/20 text-monero-400' : 'hover:bg-gray-700 text-gray-400'}`}
          title="Products"
        >
          <Package size={20} />
        </button>

        <button
          onClick={() => setView('custom')}
          className={`p-2 rounded-lg transition ${view === 'custom' ? 'bg-monero-600/20 text-monero-400' : 'hover:bg-gray-700 text-gray-400'}`}
          title="Custom Item"
        >
          <DollarSign size={20} />
        </button>

        <button
          onClick={() => setView('cart')}
          className={`p-2 rounded-lg transition relative ${view === 'cart' ? 'bg-monero-600/20 text-monero-400' : 'hover:bg-gray-700 text-gray-400'}`}
          title="Cart"
        >
          <ShoppingCart size={20} />
          {cartCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-monero-600 rounded-full text-xs font-bold flex items-center justify-center">
              {cartCount}
            </span>
          )}
        </button>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="p-2 hover:bg-gray-700 rounded-lg transition text-gray-400"
          title="Unpair Device"
        >
          <LogOut size={18} />
        </button>
      </div>

      {/* View content below nav bar */}
      {view === 'orders' ? (
        ordersContent
      ) : view === 'custom' ? (
        customContent
      ) : view === 'cart' ? (
        /* Cart view */
        <div className="flex-1 flex flex-col p-4 max-w-lg mx-auto w-full">
          <h2 className="text-lg font-bold mb-4">Cart ({cartCount})</h2>

          {cart.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <ShoppingCart size={48} className="mx-auto mb-3 opacity-50" />
                <p>Cart is empty</p>
                <button
                  onClick={() => setView('menu')}
                  className="mt-3 text-monero-400 hover:text-monero-300 text-sm"
                >
                  Browse products
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto space-y-2 mb-4">
                {cart.map((item, idx) => (
                  <div
                    key={`${item.product.id}-${idx}`}
                    className="bg-gray-800 border border-gray-700 rounded-xl p-3"
                  >
                    <div className="flex items-center gap-3">
                      {item.product.image_url && (
                        <img
                          src={item.product.image_url}
                          alt={item.product.name}
                          className="w-12 h-12 rounded-lg object-cover"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{item.product.name}</p>
                        <p className="text-monero-400 text-sm font-mono">
                          ${item.product.price.toFixed(2)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => updateQuantity(idx, -1)}
                          className="w-8 h-8 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded-lg transition"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="w-8 text-center font-bold text-sm">{item.quantity}</span>
                        <button
                          onClick={() => updateQuantity(idx, 1)}
                          className="w-8 h-8 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded-lg transition"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      <span className="font-bold text-sm w-16 text-right">
                        ${(item.product.price * item.quantity).toFixed(2)}
                      </span>
                    </div>
                    {/* Item note display / edit */}
                    {item.note && editingNoteIndex !== idx && (
                      <div
                        className="mt-1.5 ml-15 flex items-center gap-1 cursor-pointer"
                        onClick={() => { setEditingNoteIndex(idx); setNoteInput(item.note || '') }}
                      >
                        <span className="text-xs text-yellow-400 italic truncate">* {item.note}</span>
                      </div>
                    )}
                    {editingNoteIndex === idx ? (
                      <div className="mt-2 flex gap-1">
                        <input
                          type="text"
                          value={noteInput}
                          onChange={(e) => setNoteInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') addNoteToItem(idx, noteInput) }}
                          placeholder="e.g. no pickles"
                          className="flex-1 text-xs bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-white placeholder-gray-500 focus:border-monero-500 focus:outline-none"
                          autoFocus
                        />
                        <button
                          onClick={() => addNoteToItem(idx, noteInput)}
                          className="px-2 py-1 bg-monero-600 hover:bg-monero-700 rounded-lg text-xs font-medium transition"
                        >
                          OK
                        </button>
                        <button
                          onClick={() => { setEditingNoteIndex(null); setNoteInput('') }}
                          className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition"
                        >
                          X
                        </button>
                      </div>
                    ) : !item.note && (
                      <button
                        onClick={() => { setEditingNoteIndex(idx); setNoteInput('') }}
                        className="mt-1 text-xs text-gray-500 hover:text-gray-400 transition"
                      >
                        + Add note
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="space-y-2 mb-4">
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Customer name (optional)"
                  className="w-full text-sm"
                />
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  className="w-full text-sm"
                />
              </div>

              <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Subtotal</span>
                  <span>${subtotal.toFixed(2)}</span>
                </div>
                {taxRate > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Tax ({taxRate}%)</span>
                    <span>${tax.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-lg border-t border-gray-700 pt-2">
                  <span>Total</span>
                  <span>${total.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-monero-400 text-sm">
                  <span>XMR</span>
                  <span className="font-mono">{totalXmr.toFixed(4)} XMR</span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={clearCart}
                  className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-medium transition"
                >
                  Clear
                </button>
                <button
                  onClick={() => { setTipAmount(0); setShowCustomTip(false); setCustomTipInput(''); setView('tip') }}
                  disabled={cart.length === 0}
                  className="flex-1 px-4 py-3 bg-monero-600 hover:bg-monero-700 disabled:opacity-50 rounded-xl font-bold text-lg transition"
                >
                  Charge
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        /* Product menu view — organized by category */
        <div className="flex-1 flex flex-col">
          {/* Category filter tabs */}
          <div className="bg-gray-800/50 px-4 py-2 overflow-x-auto flex gap-2 scrollbar-hide">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition ${!selectedCategory
                ? 'bg-monero-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
            >
              All
            </button>
            {categories.map((cat: Category) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition flex items-center gap-2 ${selectedCategory === cat.id
                  ? 'bg-monero-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
              >
                {cat.color && (
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: cat.color }} />
                )}
                {cat.name}
              </button>
            ))}
          </div>

          {/* Products grid — grouped by category sections */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {categoryGroups.map((group, idx) => (
              <div key={group.category?.id || `uncategorized-${idx}`}>
                {/* Category section header (only when showing all) */}
                {!selectedCategory && (
                  <div className="flex items-center gap-2 mb-3">
                    {group.category?.color && (
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: group.category.color }} />
                    )}
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide">
                      {group.category?.name || 'Other'}
                    </h3>
                    <div className="flex-1 border-t border-gray-700" />
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {group.products.map((product: Product) => {
                    const inCart = cart.find((item) => item.product.id === product.id)
                    return (
                      <button
                        key={product.id}
                        onClick={() => addToCart(product)}
                        className="bg-gray-800 border border-gray-700 hover:border-monero-600 rounded-xl p-3 text-left transition transform active:scale-95 relative"
                      >
                        {inCart && (
                          <span className="absolute top-2 right-2 w-6 h-6 bg-monero-600 rounded-full text-xs font-bold flex items-center justify-center z-10">
                            {inCart.quantity}
                          </span>
                        )}
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt={product.name}
                            className="w-full h-24 object-cover rounded-lg mb-2"
                          />
                        ) : (
                          <div className="w-full h-24 bg-gray-700 rounded-lg mb-2 flex flex-col items-center justify-center text-gray-500 gap-2">
                            <Package size={24} />
                          </div>
                        )}
                        <p className="font-medium text-sm truncate">{product.name}</p>
                        <p className="text-monero-400 font-bold text-sm">${product.price.toFixed(2)}</p>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

            {categoryGroups.every((g) => g.products.length === 0) && (
              <div className="text-center py-12 text-gray-500">
                <p>No products found</p>
              </div>
            )}
          </div>

          {/* Bottom cart bar (when items in cart) */}
          {cartCount > 0 && (
            <div
              className="sticky bottom-0 bg-gray-800 border-t border-gray-700 px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-gray-750 transition"
              onClick={() => setView('cart')}
            >
              <div className="w-10 h-10 bg-monero-600 rounded-xl flex items-center justify-center">
                <ShoppingCart size={20} />
              </div>
              <div className="flex-1">
                <p className="font-bold">{cartCount} item{cartCount !== 1 ? 's' : ''}</p>
                <p className="text-sm text-gray-400">{totalXmr.toFixed(4)} XMR</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-lg">${total.toFixed(2)}</p>
              </div>
              <ChevronLeft size={20} className="rotate-180 text-gray-400" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
