import type { Order } from './types'
import { getApiBase } from './api'

/**
 * Receipt printing — opens the server-rendered receipt page in the system browser.
 * Uses BrowserOpenURL (Wails runtime) to open in Safari/Chrome, since window.open
 * and window.print are blocked in Wails WebView (WKWebView).
 * The receipt page auto-triggers window.print() and includes a Print button.
 */

export function printReceipt(order: Order) {
  const url = `${getApiBase()}/orders/${order.id}/receipt`

  // Try Wails BrowserOpenURL first (opens in system browser)
  if ((window as any).runtime?.BrowserOpenURL) {
    ;(window as any).runtime.BrowserOpenURL(url)
    return
  }

  // Fallback: open in new tab (works for connected devices accessing via browser)
  window.open(url, '_blank')
}
