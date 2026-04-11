import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Plus, Minus, X, ShoppingCart, Package, ChevronRight, Printer } from 'lucide-react'
import Card from '../components/Card'
import PaymentScreen from '../components/PaymentScreen'
import {
  products as productsApi,
  orders as ordersApi,
  rate as rateApi,
  categories as categoriesApi,
  settings as settingsApi,
} from '../lib/api'
import { useWebSocket } from '../lib/websocket'
import type { Product, Category } from '../lib/types'
import { printReceipt } from '../lib/receipt'

type Mode = 'products' | 'keypad'

interface CartItem {
  product: Product
  quantity: number
  note?: string
}

export default function PointOfSale() {
  const [mode, setMode] = useState<Mode>('products')
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [notes, setNotes] = useState('')
  const [createdOrder, setCreatedOrder] = useState<any>(null)
  const [paymentConfirmed, setPaymentConfirmed] = useState(false)
  const [showCelebration, setShowCelebration] = useState(false)
  const [countdown, setCountdown] = useState(900)
  const [showTipScreen, setShowTipScreen] = useState(false)
  const [tipAmount, setTipAmount] = useState(0)
  const [customTipInput, setCustomTipInput] = useState('')
  const [showCustomTip, setShowCustomTip] = useState(false)
  const [editingNoteIndex, setEditingNoteIndex] = useState<number | null>(null)
  const [noteInput, setNoteInput] = useState('')


  // Calculator keypad state
  const [calcDisplay, setCalcDisplay] = useState('0')
  const [calcPending, setCalcPending] = useState<number | null>(null)
  const [calcOp, setCalcOp] = useState<string | null>(null)
  const [calcFresh, setCalcFresh] = useState(true)
  const [customItemName, setCustomItemName] = useState('')

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => productsApi.list(),
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  })

  const { data: appSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(),
  })

  const currency = appSettings?.fiat_currency || 'USD'
  const taxRate = appSettings?.tax_rate || 0
  const showFiat = appSettings?.show_fiat_price !== false
  const showXmr = appSettings?.show_prices_in_xmr !== false

  const { data: exchangeRate } = useQuery({
    queryKey: ['exchange-rate', currency],
    queryFn: () => rateApi.get(currency),
    refetchInterval: 30000,
  })

  // Cart calculations
  const subtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
  const tax = subtotal * (taxRate / 100)
  const total = subtotal + tax
  const totalXmr = exchangeRate?.rate ? total / exchangeRate.rate : 0
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)

  // Calculator helpers
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
      setCalcDisplay(d === '.' ? '0.' : d)
      setCalcFresh(false)
    } else {
      if (d === '.' && calcDisplay.includes('.')) return
      const dotIdx = calcDisplay.indexOf('.')
      if (dotIdx !== -1 && calcDisplay.length - dotIdx > 2) return
      setCalcDisplay(calcDisplay === '0' && d !== '.' ? d : calcDisplay + d)
    }
  }

  const calcHandleOp = (op: string) => {
    const current = parseFloat(calcDisplay) || 0
    if (calcPending !== null && calcOp && !calcFresh) {
      const result = +calcEvaluate(calcPending, calcOp, current).toFixed(2)
      setCalcDisplay(result.toString())
      setCalcPending(result)
    } else {
      setCalcPending(current)
    }
    setCalcOp(op)
    setCalcFresh(true)
  }

  const calcHandleEquals = () => {
    if (calcPending !== null && calcOp) {
      const current = parseFloat(calcDisplay) || 0
      const result = +calcEvaluate(calcPending, calcOp, current).toFixed(2)
      setCalcDisplay(result.toString())
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
    if (calcDisplay.length <= 1) {
      setCalcDisplay('0')
      setCalcFresh(true)
    } else {
      setCalcDisplay(calcDisplay.slice(0, -1))
    }
  }

  const keypadFiat = parseFloat(calcDisplay) || 0

  // Totals with tip
  const totalWithTip = total + tipAmount
  const totalXmrWithTip = exchangeRate?.rate ? totalWithTip / exchangeRate.rate : 0

  const createOrderMutation = useMutation({
    mutationFn: () => {
      // All orders go through the cart (products + custom items)
      const items: any[] = cart.map((item) => ({
        product_id: item.product.id,
        product_name: item.product.name,
        quantity: item.quantity,
        unit_price: item.product.price,
        line_total: item.product.price * item.quantity,
        note: item.note || '',
      }))
      if (tipAmount > 0) {
        items.push({
          product_name: 'Tip',
          quantity: 1,
          unit_price: tipAmount,
          line_total: tipAmount,
          note: '',
        })
      }
      return ordersApi.create({
        items,
        device_name: 'SuperPay Main',
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
      setCountdown(900)
      setPaymentConfirmed(false)
      setShowTipScreen(false)
      setTipAmount(0)
      setCustomTipInput('')
      setShowCustomTip(false)
    },
  })

  // Listen for payment confirmation
  useWebSocket('order_paid', (data: any) => {
    if (data && data.id === createdOrder?.id) {
      setPaymentConfirmed(true)
      setShowCelebration(true)
      // Auto-dismiss after 4 seconds
      setTimeout(() => {
        setShowCelebration(false)
        setCreatedOrder(null)
        setPaymentConfirmed(false)
        setCart([])
        setCustomerName('')
        setNotes('')
        setCountdown(900)
      }, 4000)
    }
  })

  // Countdown timer
  useEffect(() => {
    if (!createdOrder || paymentConfirmed || countdown <= 0) return
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setCreatedOrder(null)
          return 900
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [createdOrder, paymentConfirmed])

  const addToCart = useCallback((product: Product) => {
    setCart((prev) => {
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

  const setQuantity = useCallback((cartIndex: number, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((_, idx) => idx !== cartIndex))
    } else {
      setCart((prev) =>
        prev.map((item, idx) =>
          idx === cartIndex ? { ...item, quantity: qty } : item
        )
      )
    }
  }, [])

  const addNoteToItem = useCallback((cartIndex: number, note: string) => {
    setCart((prev) => {
      const item = prev[cartIndex]
      if (!item) return prev
      const trimmed = note.trim()
      if (item.quantity <= 1) {
        return prev.map((it, idx) => idx === cartIndex ? { ...it, note: trimmed || undefined } : it)
      }
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
    calcHandleClear()
    setCustomItemName('')
    setTipAmount(0)
    setCustomTipInput('')
    setShowCustomTip(false)
    setShowTipScreen(false)
  }

  const addCustomToCart = () => {
    const price = parseFloat(calcDisplay) || 0
    if (price <= 0) return
    const customProduct: Product = {
      id: `custom-${Date.now()}`,
      name: customItemName.trim() || 'Custom Item',
      description: '',
      price,
      price_unit: 'each' as const,
      category_id: '',
      active: true,
      created_at: new Date().toISOString(),
    }
    setCart((prev) => [...prev, { product: customProduct, quantity: 1 }])
    calcHandleClear()
    setCustomItemName('')
  }

  const newOrder = async () => {
    // Cancel the order on the backend before clearing local state
    if (createdOrder?.id && !paymentConfirmed) {
      try {
        await ordersApi.cancel(createdOrder.id)
      } catch (err) {
        console.error('Failed to cancel order:', err)
      }
    }
    clearCart()
    setCreatedOrder(null)
    setPaymentConfirmed(false)
  }

  const calcExprDisplay = calcPending !== null && calcOp ? `${calcPending} ${calcOp}` : ''


  // Group products by category
  const activeProducts = products.filter((p: Product) => p.active !== false)

  const getCategoryProducts = () => {
    if (selectedCategory) {
      return [
        {
          category: categories.find((c: Category) => c.id === selectedCategory) || null,
          products: activeProducts.filter((p: Product) => p.category_id === selectedCategory),
        },
      ]
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

  const categoryGroups = getCategoryProducts()

  // --- Payment celebration overlay ---
  if (showCelebration && createdOrder) {
    // Generate confetti particles
    const confettiColors = ['#FF6600', '#FF8533', '#22c55e', '#4ade80', '#fbbf24', '#f97316', '#ffffff']
    const confetti = Array.from({ length: 60 }, (_, i) => ({
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
        {/* Green flash background */}
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(circle at center, rgba(34,197,94,0.3) 0%, rgba(17,24,39,0.98) 70%)',
            animation: 'celebrationBg 0.6s ease-out',
          }}
        />

        {/* Confetti */}
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

        {/* Center content */}
        <div className="relative z-10 text-center" style={{ animation: 'celebrationPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both' }}>
          {/* Monero-colored checkmark circle */}
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

          <h2
            className="text-4xl font-black mb-2"
            style={{ color: '#22c55e', textShadow: '0 0 30px rgba(34,197,94,0.3)' }}
          >
            Payment Received!
          </h2>

          <p className="text-xl text-gray-300 mb-2">
            {parseFloat(String(createdOrder.total_xmr || '0')).toFixed(4)} XMR
          </p>
          <p className="text-gray-500">
            ${(createdOrder.total_fiat || 0).toFixed(2)} — Order #{createdOrder.order_number || createdOrder.id?.slice(0, 8)}
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

        {/* Inline keyframes */}
        <style>{`
          @keyframes celebrationBg {
            0% { opacity: 0; transform: scale(0.8); }
            50% { background: radial-gradient(circle at center, rgba(34,197,94,0.5) 0%, rgba(17,24,39,0.98) 70%); }
            100% { opacity: 1; transform: scale(1); }
          }
          @keyframes celebrationPop {
            0% { opacity: 0; transform: scale(0.3); }
            100% { opacity: 1; transform: scale(1); }
          }
          @keyframes checkDraw {
            to { stroke-dashoffset: 0; }
          }
          @keyframes checkPulse {
            0%, 100% { box-shadow: 0 0 60px rgba(255,102,0,0.5), 0 0 120px rgba(255,102,0,0.2); }
            50% { box-shadow: 0 0 80px rgba(255,102,0,0.7), 0 0 160px rgba(255,102,0,0.3); }
          }
          @keyframes confettiFall {
            0% { opacity: 1; transform: translateY(0) translateX(0) rotate(0deg); }
            100% { opacity: 0; transform: translateY(100vh) translateX(var(--drift)) rotate(720deg); }
          }
        `}</style>
      </div>
    )
  }

  // --- Tip selection screen (overlay) ---
  if (showTipScreen) {
    const baseTotal = total
    const tipPresets = [
      { label: '10%', amount: +(baseTotal * 0.10).toFixed(2) },
      { label: '15%', amount: +(baseTotal * 0.15).toFixed(2) },
      { label: '20%', amount: +(baseTotal * 0.20).toFixed(2) },
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

    const currentTotalWithTip = baseTotal + tipAmount
    const currentXmrWithTip = exchangeRate?.rate ? currentTotalWithTip / exchangeRate.rate : 0

    return (
      <div className="fixed inset-0 bg-gray-900/95 flex items-center justify-center p-4 z-50">
        <Card className="max-w-md w-full">
          {/* Order summary */}
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold mb-1">Add a Tip?</h2>
            <p className="text-gray-400 text-sm">Order total: ${baseTotal.toFixed(2)}</p>
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
              className="w-full py-3 rounded-xl text-center transition border-2 mb-4 border-gray-600 bg-gray-700/50 hover:border-gray-500"
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
              <span>${baseTotal.toFixed(2)}</span>
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
              onClick={() => { setShowTipScreen(false); setTipAmount(0) }}
              className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition"
            >
              Back
            </button>
            {tipAmount > 0 ? (
              <button
                onClick={handleConfirmTip}
                disabled={createOrderMutation.isPending}
                className="flex-1 px-4 py-3 bg-monero-600 hover:bg-monero-700 disabled:opacity-50 rounded-lg font-bold text-lg transition"
              >
                {createOrderMutation.isPending ? 'Creating...' : `Pay $${currentTotalWithTip.toFixed(2)}`}
              </button>
            ) : (
              <button
                onClick={handleSkipTip}
                disabled={createOrderMutation.isPending}
                className="flex-1 px-4 py-3 bg-monero-600 hover:bg-monero-700 disabled:opacity-50 rounded-lg font-bold text-lg transition"
              >
                {createOrderMutation.isPending ? 'Creating...' : 'No Tip'}
              </button>
            )}
          </div>
        </Card>
      </div>
    )
  }

  // --- Payment waiting screen ---
  if (createdOrder) {
    return (
      <PaymentScreen
        order={createdOrder}
        onBack={() => {
          setCreatedOrder(null)
          setCart([])
          setCustomerName('')
          setNotes('')
          setCountdown(900)
        }}
        onCancel={newOrder}
        showCountdown={true}
        countdown={countdown}
        onPrint={paymentConfirmed ? () => printReceipt(createdOrder) : undefined}
      />
    )
  }

  // --- Main layout: New Order ---
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-1">New Order</h1>
          <p className="text-gray-400 text-sm">
            {exchangeRate
              ? `1 XMR = $${exchangeRate.rate.toFixed(2)} ${currency}`
              : 'Loading rate...'}
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex bg-gray-800 rounded-lg p-1">
          <button
            onClick={() => setMode('products')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${mode === 'products' ? 'bg-monero-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
          >
            Products
          </button>
          <button
            onClick={() => setMode('keypad')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${mode === 'keypad' ? 'bg-monero-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
          >
            Keypad
          </button>
        </div>
      </div>

      {mode === 'products' ? (
        /* ========== PRODUCTS MODE ========== */
        <div className="flex gap-6">
          {/* Left: Product Grid */}
          <div className="flex-1 min-w-0">
            {/* Category filter tabs */}
            <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition ${!selectedCategory
                  ? 'bg-monero-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
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
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}
                >
                  {cat.color && (
                    <span
                      className="w-2.5 h-2.5 rounded-full inline-block"
                      style={{ backgroundColor: cat.color }}
                    />
                  )}
                  {cat.name}
                </button>
              ))}
            </div>

            {/* Products grouped by category */}
            <div className="space-y-6">
              {categoryGroups.map((group, idx) => (
                <div key={group.category?.id || `uncategorized-${idx}`}>
                  {!selectedCategory && (
                    <div className="flex items-center gap-2 mb-3">
                      {group.category?.color && (
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: group.category.color }}
                        />
                      )}
                      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide">
                        {group.category?.name || 'Other'}
                      </h3>
                      <div className="flex-1 border-t border-gray-700" />
                    </div>
                  )}

                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                    {group.products.map((product: Product) => {
                      const inCart = cart.find((item) => item.product.id === product.id)
                      return (
                        <button
                          key={product.id}
                          onClick={() => addToCart(product)}
                          className="bg-gray-800 border border-gray-700 hover:border-monero-600 rounded-xl p-3 text-left transition transform hover:scale-[1.02] active:scale-95 relative"
                        >
                          {inCart && (
                            <span className="absolute top-2 right-2 w-7 h-7 bg-monero-600 rounded-full text-xs font-bold flex items-center justify-center z-10 shadow-lg">
                              {inCart.quantity}
                            </span>
                          )}
                          {product.image_url ? (
                            <img
                              src={product.image_url}
                              alt={product.name}
                              className="w-full h-28 object-cover rounded-lg mb-2"
                            />
                          ) : (
                            <div className="w-full h-28 bg-gray-700 rounded-lg mb-2 flex items-center justify-center text-gray-500">
                              <Package size={28} />
                            </div>
                          )}
                          <p className="font-medium text-sm truncate">{product.name}</p>
                          <div className="text-sm font-bold">
                            {showXmr && exchangeRate?.rate && (
                              <div className="text-monero-400">
                                {(product.price / exchangeRate.rate).toFixed(4)} XMR
                                {product.price_unit !== 'each' && (
                                  <span className="text-gray-500 font-normal">/{product.price_unit}</span>
                                )}
                              </div>
                            )}
                            {showFiat && (
                              <div className="text-green-400">
                                ${product.price.toFixed(2)}
                                {!showXmr && product.price_unit !== 'each' && (
                                  <span className="text-gray-500 font-normal">/{product.price_unit}</span>
                                )}
                              </div>
                            )}
                            {!showFiat && !showXmr && (
                              <div className="text-monero-400">
                                ${product.price.toFixed(2)}
                                {product.price_unit !== 'each' && (
                                  <span className="text-gray-500 font-normal">/{product.price_unit}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}

              {categoryGroups.every((g) => g.products.length === 0) && (
                <div className="text-center py-12 text-gray-500">
                  <Package size={48} className="mx-auto mb-3 opacity-50" />
                  <p>No products found</p>
                  <p className="text-sm mt-1">Add products in the Products page</p>
                </div>
              )}
            </div>
          </div>

          {/* Right: Cart Sidebar */}
          <div className="w-80 flex-shrink-0">
            <div className="sticky top-4 space-y-4">
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-bold flex items-center gap-2">
                    <ShoppingCart size={18} />
                    Cart
                    {cartCount > 0 && (
                      <span className="bg-monero-600 text-xs rounded-full px-2 py-0.5">
                        {cartCount}
                      </span>
                    )}
                  </h2>
                  {cart.length > 0 && (
                    <button
                      onClick={clearCart}
                      className="text-xs text-gray-500 hover:text-red-400 transition"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {cart.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <ShoppingCart size={32} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Tap products to add</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {cart.map((item, idx) => (
                      <div
                        key={`${item.product.id}-${idx}`}
                        className="p-2 bg-gray-700/50 rounded-lg border border-gray-600"
                      >
                        <div className="flex items-start gap-2">
                          {item.product.image_url && (
                            <img
                              src={item.product.image_url}
                              alt={item.product.name}
                              className="w-10 h-10 rounded object-cover flex-shrink-0"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start">
                              <p className="font-medium text-sm truncate">{item.product.name}</p>
                              <button
                                onClick={() =>
                                  setCart((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="text-red-400 hover:text-red-300 ml-1 flex-shrink-0"
                              >
                                <X size={14} />
                              </button>
                            </div>
                            <div className="flex justify-between items-center mt-1">
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => updateQuantity(idx, -1)}
                                  className="w-6 h-6 flex items-center justify-center bg-gray-600 hover:bg-gray-500 rounded text-xs"
                                >
                                  <Minus size={12} />
                                </button>
                                <input
                                  type="number"
                                  min="1"
                                  value={item.quantity}
                                  onChange={(e) => { const val = parseInt(e.target.value); if (!isNaN(val)) setQuantity(idx, val) }}
                                  onBlur={(e) => { if (!e.target.value || parseInt(e.target.value) <= 0) setQuantity(idx, 1) }}
                                  className="w-10 text-center text-sm font-bold bg-transparent border border-gray-600 rounded px-0 py-0 focus:border-monero-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <button
                                  onClick={() => updateQuantity(idx, 1)}
                                  className="w-6 h-6 flex items-center justify-center bg-gray-600 hover:bg-gray-500 rounded text-xs"
                                >
                                  <Plus size={12} />
                                </button>
                              </div>
                              <div className="text-right">
                                {showXmr && exchangeRate?.rate && (
                                  <div className="text-sm font-bold text-monero-400 font-mono">
                                    {(item.product.price * item.quantity / exchangeRate.rate).toFixed(4)} XMR
                                  </div>
                                )}
                                {showFiat && (
                                  <div className={`font-bold ${showXmr ? 'text-xs text-green-400' : 'text-sm text-green-400'}`}>
                                    ${(item.product.price * item.quantity).toFixed(2)}
                                  </div>
                                )}
                                {!showFiat && !showXmr && (
                                  <span className="text-sm font-bold">${(item.product.price * item.quantity).toFixed(2)}</span>
                                )}
                              </div>
                            </div>
                            {/* Item note display / edit */}
                            {item.note && editingNoteIndex !== idx && (
                              <div
                                className="mt-1 cursor-pointer"
                                onClick={() => { setEditingNoteIndex(idx); setNoteInput(item.note || '') }}
                              >
                                <span className="text-xs text-yellow-400 italic">* {item.note}</span>
                              </div>
                            )}
                            {editingNoteIndex === idx ? (
                              <div className="mt-1.5 flex gap-1">
                                <input
                                  type="text"
                                  value={noteInput}
                                  onChange={(e) => setNoteInput(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') addNoteToItem(idx, noteInput) }}
                                  placeholder="e.g. no pickles"
                                  className="flex-1 text-xs bg-gray-600 border border-gray-500 rounded px-1.5 py-1 text-white placeholder-gray-400 focus:border-monero-500 focus:outline-none"
                                  autoFocus
                                />
                                <button
                                  onClick={() => addNoteToItem(idx, noteInput)}
                                  className="px-1.5 py-1 bg-monero-600 hover:bg-monero-700 rounded text-xs font-medium transition"
                                >
                                  OK
                                </button>
                                <button
                                  onClick={() => { setEditingNoteIndex(null); setNoteInput('') }}
                                  className="px-1.5 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs transition"
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
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Summary */}
                {cart.length > 0 && (
                  <div className="border-t border-gray-700 pt-3 mt-3 space-y-1">
                    {showFiat && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Subtotal</span>
                        <span className="text-green-400">${subtotal.toFixed(2)}</span>
                      </div>
                    )}
                    {showFiat && taxRate > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Tax ({taxRate}%)</span>
                        <span className="text-green-400">${tax.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-lg border-t border-gray-700 pt-2 mt-2">
                      <span>Total</span>
                      <div className="text-right">
                        {showXmr && <div className="text-monero-400 font-mono">{totalXmr.toFixed(4)} XMR</div>}
                        {showFiat && <div className={`text-green-400 ${showXmr ? 'text-sm' : ''}`}>${total.toFixed(2)}</div>}
                        {!showFiat && !showXmr && <div>${total.toFixed(2)}</div>}
                      </div>
                    </div>
                  </div>
                )}
              </Card>

              {/* Customer info + Create Order */}
              {cart.length > 0 && (
                <Card>
                  <div className="space-y-3">
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
                    <button
                      onClick={() => { setTipAmount(0); setShowCustomTip(false); setCustomTipInput(''); setShowTipScreen(true) }}
                      disabled={cart.length === 0}
                      className="w-full px-4 py-3 bg-monero-600 hover:bg-monero-700 disabled:opacity-50 rounded-lg font-bold text-lg transition flex items-center justify-center gap-2"
                    >
                      Charge {showFiat ? `$${total.toFixed(2)}` : showXmr ? `${totalXmr.toFixed(4)} XMR` : `$${total.toFixed(2)}`}
                      <ChevronRight size={20} />
                    </button>
                    {createOrderMutation.isError && (
                      <div className="p-2 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-xs">
                        {(createOrderMutation.error as Error)?.message || 'Failed to create order'}
                      </div>
                    )}
                  </div>
                </Card>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ========== KEYPAD MODE (Custom Item → Cart) ========== */
        <div className="flex gap-6">
          {/* Left: Keypad with name input */}
          <div className="flex-1 min-w-0">
            <Card>
              <div className="space-y-4">
                {/* Item name input */}
                <input
                  type="text"
                  value={customItemName}
                  onChange={(e) => setCustomItemName(e.target.value)}
                  placeholder="Item name (e.g., Haircut, Repair)"
                  className="w-full text-sm"
                />

                {/* Calculator display */}
                <div className="bg-gray-700/50 rounded-lg p-4">
                  <div className="text-right text-gray-500 text-sm h-5 font-mono">
                    {calcExprDisplay}
                  </div>
                  <div className="text-right text-5xl font-bold font-mono text-monero-500 truncate">
                    ${calcDisplay}
                  </div>
                </div>

                {/* Calculator grid: 4 cols */}
                <div className="grid grid-cols-4 gap-2">
                  <button onClick={calcHandleClear} className="p-4 bg-red-900/30 hover:bg-red-900/50 border border-red-700/50 rounded-lg text-lg font-bold text-red-200 transition active:scale-95">C</button>
                  <button onClick={calcHandleBackspace} className="p-4 bg-gray-700 hover:bg-gray-600 rounded-lg text-lg font-bold transition active:scale-95">←</button>
                  <button onClick={() => calcHandleOp('×')} className={`p-4 rounded-lg text-lg font-bold transition active:scale-95 ${calcOp === '×' ? 'bg-monero-600 text-white' : 'bg-yellow-900/30 hover:bg-yellow-900/50 border border-yellow-700/50 text-yellow-200'}`}>×</button>
                  <button onClick={() => calcHandleOp('-')} className={`p-4 rounded-lg text-lg font-bold transition active:scale-95 ${calcOp === '-' ? 'bg-monero-600 text-white' : 'bg-yellow-900/30 hover:bg-yellow-900/50 border border-yellow-700/50 text-yellow-200'}`}>−</button>

                  <button onClick={() => calcHandleDigit('7')} className="p-4 bg-gray-700 hover:bg-gray-600 rounded-lg text-2xl font-bold transition active:scale-95">7</button>
                  <button onClick={() => calcHandleDigit('8')} className="p-4 bg-gray-700 hover:bg-gray-600 rounded-lg text-2xl font-bold transition active:scale-95">8</button>
                  <button onClick={() => calcHandleDigit('9')} className="p-4 bg-gray-700 hover:bg-gray-600 rounded-lg text-2xl font-bold transition active:scale-95">9</button>
                  <button onClick={() => calcHandleOp('+')} className={`p-4 row-span-2 rounded-lg text-lg font-bold transition active:scale-95 ${calcOp === '+' ? 'bg-monero-600 text-white' : 'bg-yellow-900/30 hover:bg-yellow-900/50 border border-yellow-700/50 text-yellow-200'}`}>+</button>

                  <button onClick={() => calcHandleDigit('4')} className="p-4 bg-gray-700 hover:bg-gray-600 rounded-lg text-2xl font-bold transition active:scale-95">4</button>
                  <button onClick={() => calcHandleDigit('5')} className="p-4 bg-gray-700 hover:bg-gray-600 rounded-lg text-2xl font-bold transition active:scale-95">5</button>
                  <button onClick={() => calcHandleDigit('6')} className="p-4 bg-gray-700 hover:bg-gray-600 rounded-lg text-2xl font-bold transition active:scale-95">6</button>

                  <button onClick={() => calcHandleDigit('1')} className="p-4 bg-gray-700 hover:bg-gray-600 rounded-lg text-2xl font-bold transition active:scale-95">1</button>
                  <button onClick={() => calcHandleDigit('2')} className="p-4 bg-gray-700 hover:bg-gray-600 rounded-lg text-2xl font-bold transition active:scale-95">2</button>
                  <button onClick={() => calcHandleDigit('3')} className="p-4 bg-gray-700 hover:bg-gray-600 rounded-lg text-2xl font-bold transition active:scale-95">3</button>
                  <button onClick={calcHandleEquals} className="p-4 row-span-2 bg-monero-600 hover:bg-monero-700 rounded-lg text-lg font-bold transition active:scale-95">=</button>

                  <button onClick={() => calcHandleDigit('0')} className="p-4 col-span-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-2xl font-bold transition active:scale-95">0</button>
                  <button onClick={() => calcHandleDigit('.')} className="p-4 bg-gray-700 hover:bg-gray-600 rounded-lg text-2xl font-bold transition active:scale-95">.</button>
                </div>

                {/* Add to Cart button */}
                <button
                  onClick={addCustomToCart}
                  disabled={keypadFiat <= 0}
                  className="w-full px-4 py-3 bg-monero-600 hover:bg-monero-700 disabled:opacity-50 rounded-lg font-bold text-lg transition flex items-center justify-center gap-2"
                >
                  <ShoppingCart size={20} />
                  Add to Cart — ${keypadFiat.toFixed(2)}
                </button>
              </div>
            </Card>
          </div>

          {/* Right: Shared Cart Sidebar */}
          <div className="w-80 flex-shrink-0">
            <div className="sticky top-4 space-y-4">
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-bold flex items-center gap-2">
                    <ShoppingCart size={18} />
                    Cart
                    {cartCount > 0 && (
                      <span className="bg-monero-600 text-xs rounded-full px-2 py-0.5">
                        {cartCount}
                      </span>
                    )}
                  </h2>
                  {cart.length > 0 && (
                    <button
                      onClick={clearCart}
                      className="text-xs text-gray-500 hover:text-red-400 transition"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {cart.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <ShoppingCart size={32} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Enter an amount and add to cart</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {cart.map((item, idx) => (
                      <div
                        key={`${item.product.id}-${idx}`}
                        className="p-2 bg-gray-700/50 rounded-lg border border-gray-600"
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start">
                              <p className="font-medium text-sm truncate">{item.product.name}</p>
                              <button
                                onClick={() =>
                                  setCart((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="text-red-400 hover:text-red-300 ml-1 flex-shrink-0"
                              >
                                <X size={14} />
                              </button>
                            </div>
                            <div className="flex justify-between items-center mt-1">
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => updateQuantity(idx, -1)}
                                  className="w-6 h-6 flex items-center justify-center bg-gray-600 hover:bg-gray-500 rounded text-xs"
                                >
                                  <Minus size={12} />
                                </button>
                                <input
                                  type="number"
                                  min="1"
                                  value={item.quantity}
                                  onChange={(e) => { const val = parseInt(e.target.value); if (!isNaN(val)) setQuantity(idx, val) }}
                                  onBlur={(e) => { if (!e.target.value || parseInt(e.target.value) <= 0) setQuantity(idx, 1) }}
                                  className="w-10 text-center text-sm font-bold bg-transparent border border-gray-600 rounded px-0 py-0 focus:border-monero-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <button
                                  onClick={() => updateQuantity(idx, 1)}
                                  className="w-6 h-6 flex items-center justify-center bg-gray-600 hover:bg-gray-500 rounded text-xs"
                                >
                                  <Plus size={12} />
                                </button>
                              </div>
                              <div className="text-right">
                                {showXmr && exchangeRate?.rate && (
                                  <div className="text-sm font-bold text-monero-400 font-mono">
                                    {(item.product.price * item.quantity / exchangeRate.rate).toFixed(4)} XMR
                                  </div>
                                )}
                                {showFiat && (
                                  <div className={`font-bold ${showXmr ? 'text-xs text-green-400' : 'text-sm text-green-400'}`}>
                                    ${(item.product.price * item.quantity).toFixed(2)}
                                  </div>
                                )}
                                {!showFiat && !showXmr && (
                                  <span className="text-sm font-bold">${(item.product.price * item.quantity).toFixed(2)}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {cart.length > 0 && (
                  <div className="border-t border-gray-700 pt-3 mt-3 space-y-1">
                    {showFiat && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Subtotal</span>
                        <span className="text-green-400">${subtotal.toFixed(2)}</span>
                      </div>
                    )}
                    {showFiat && taxRate > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Tax ({taxRate}%)</span>
                        <span className="text-green-400">${tax.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-lg border-t border-gray-700 pt-2 mt-2">
                      <span>Total</span>
                      <div className="text-right">
                        {showXmr && <div className="text-monero-400 font-mono">{totalXmr.toFixed(4)} XMR</div>}
                        {showFiat && <div className={`text-green-400 ${showXmr ? 'text-sm' : ''}`}>${total.toFixed(2)}</div>}
                        {!showFiat && !showXmr && <div>${total.toFixed(2)}</div>}
                      </div>
                    </div>
                  </div>
                )}
              </Card>

              {cart.length > 0 && (
                <Card>
                  <div className="space-y-3">
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
                    <button
                      onClick={() => { setTipAmount(0); setShowCustomTip(false); setCustomTipInput(''); setShowTipScreen(true) }}
                      disabled={cart.length === 0}
                      className="w-full px-4 py-3 bg-monero-600 hover:bg-monero-700 disabled:opacity-50 rounded-lg font-bold text-lg transition flex items-center justify-center gap-2"
                    >
                      Charge {showFiat ? `$${total.toFixed(2)}` : showXmr ? `${totalXmr.toFixed(4)} XMR` : `$${total.toFixed(2)}`}
                      <ChevronRight size={20} />
                    </button>
                    {createOrderMutation.isError && (
                      <div className="p-2 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-xs">
                        {(createOrderMutation.error as Error)?.message || 'Failed to create order'}
                      </div>
                    )}
                  </div>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
