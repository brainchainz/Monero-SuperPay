import { useState } from 'react'
import { Copy, Check, Printer, ArrowLeft } from 'lucide-react'
import { QRCodeSVG as QRCode } from 'qrcode.react'
import Card from './Card'
import type { Order } from '../lib/types'

interface PaymentScreenProps {
  order: Order
  onBack: () => void
  onCancel?: () => void
  showCountdown?: boolean
  countdown?: number
  onPrint?: () => void
}

export default function PaymentScreen({
  order,
  onBack,
  onCancel,
  showCountdown = false,
  countdown = 900,
  onPrint,
}: PaymentScreenProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const copyToClipboard = async (text: string, field: string) => {
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

  const isPaid = order.status === 'paid' || order.status === 'delivered'

  // Reconstruct payment_uri from address + amount if not present
  // (order list API doesn't include payment_uri, only CreateOrder does)
  const paymentUri = order.payment_uri
    || (order.payment_address && order.total_xmr
      ? `monero:${order.payment_address}?tx_amount=${order.total_xmr}`
      : '')

  return (
    <div className="fixed inset-0 bg-gray-900 flex items-center justify-center p-4 z-50 overflow-y-auto">
      {/* Back button — pushed below macOS traffic light buttons */}
      <button
        onClick={onBack}
        className="absolute top-10 left-5 inline-flex items-center gap-3 text-gray-400 hover:text-white transition z-10 px-4 py-3 rounded-xl hover:bg-gray-800"
      >
        <ArrowLeft size={32} />
        <span className="text-lg font-semibold">Back</span>
      </button>

      <Card className="max-w-3xl w-full">
        <h2 className="text-2xl font-bold text-center mb-4">
          {isPaid ? 'Payment Received' : 'Waiting for Payment'}
        </h2>
        <p className="text-center text-gray-400 text-sm mb-6">
          Order #{order.order_number || order.id?.slice(0, 8)}
          {order.customer_name && <span> — {order.customer_name}</span>}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: QR + copyable fields */}
          <div>
            <div className="relative bg-white p-6 rounded-lg mb-4 flex justify-center">
              {paymentUri ? (
                <QRCode value={paymentUri} size={260} level="H" />
              ) : (
                <div className="w-[260px] h-[260px] flex items-center justify-center text-gray-400 text-sm text-center">
                  No payment URI — check wallet-rpc connection
                </div>
              )}

              {/* Paid overlay */}
              {isPaid && (
                <div className="absolute inset-0 bg-green-600/90 rounded-lg flex flex-col items-center justify-center">
                  <Check size={64} className="text-white mb-2" />
                  <p className="text-white text-2xl font-bold">Order Paid</p>
                  {order.paid_at && (
                    <p className="text-green-100 text-sm mt-1">
                      {new Date(order.paid_at).toLocaleString()}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* XMR Amount — 1-click copy */}
            <button
              onClick={() => copyToClipboard(parseFloat(String(order.total_xmr || '0')).toFixed(12), 'xmr')}
              className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-gray-700/50 hover:bg-gray-700 rounded-lg mb-2 transition group"
            >
              <div className="text-left min-w-0">
                <p className="text-xs text-gray-400">Amount</p>
                <p className="font-mono text-monero-400 font-bold truncate">
                  {parseFloat(String(order.total_xmr || '0')).toFixed(12)} XMR
                </p>
              </div>
              {copiedField === 'xmr' ? (
                <Check size={16} className="text-green-400 flex-shrink-0" />
              ) : (
                <Copy size={16} className="text-gray-500 group-hover:text-gray-300 flex-shrink-0" />
              )}
            </button>

            {/* Subaddress — 1-click copy */}
            {order.payment_address && (
              <button
                onClick={() => copyToClipboard(order.payment_address, 'addr')}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-gray-700/50 hover:bg-gray-700 rounded-lg mb-2 transition group"
              >
                <div className="text-left min-w-0">
                  <p className="text-xs text-gray-400">Subaddress</p>
                  <p className="font-mono text-xs break-all leading-relaxed">{order.payment_address}</p>
                </div>
                {copiedField === 'addr' ? (
                  <Check size={16} className="text-green-400 flex-shrink-0" />
                ) : (
                  <Copy size={16} className="text-gray-500 group-hover:text-gray-300 flex-shrink-0" />
                )}
              </button>
            )}
          </div>

          {/* Right: Cart items + totals */}
          <div className="flex flex-col">
            {/* Items list — Tip always sorted to the bottom */}
            {order.items && order.items.length > 0 && (
              <div className="bg-gray-700/30 rounded-lg p-4 mb-4 flex-1">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Items</p>
                <div className="space-y-2">
                  {[...order.items]
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
            <div className="bg-gray-700/50 rounded-lg p-4 mb-4">
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span>${(order.total_fiat || 0).toFixed(2)}</span>
              </div>
              {(order.tax_fiat || 0) > 0 && (
                <div className="flex justify-between text-sm text-gray-400 mt-1">
                  <span>includes tax</span>
                  <span>${(order.tax_fiat || 0).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm text-monero-400 mt-2 pt-2 border-t border-gray-600">
                <span>XMR</span>
                <span className="font-mono font-bold">{parseFloat(String(order.total_xmr || '0')).toFixed(4)}</span>
              </div>
            </div>

            {/* Countdown or status */}
            {showCountdown && !isPaid && (
              <div className="text-center p-3 bg-yellow-900/20 border border-yellow-700 rounded-lg mb-4">
                <p className="text-yellow-200 font-medium">Expires in {formatCountdown(countdown)}</p>
                <p className="text-xs text-gray-400 mt-1">Scan QR code with Monero wallet</p>
              </div>
            )}
            {isPaid && (
              <div className="text-center p-3 bg-green-900/20 border border-green-700 rounded-lg mb-4">
                <p className="text-green-200 font-medium">Payment confirmed</p>
              </div>
            )}
            {!showCountdown && !isPaid && (
              <div className="text-center p-3 bg-yellow-900/20 border border-yellow-700 rounded-lg mb-4">
                <p className="text-yellow-200 font-medium">Scan QR code with Monero wallet</p>
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-2">
              {onPrint && (
                <button
                  onClick={onPrint}
                  className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition font-medium inline-flex items-center justify-center gap-2"
                >
                  <Printer size={16} />
                  Print Receipt
                </button>
              )}
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition font-medium"
                >
                  Cancel Order
                </button>
              )}
              {!onCancel && (
                <button
                  onClick={onBack}
                  className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition font-medium"
                >
                  Back
                </button>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
