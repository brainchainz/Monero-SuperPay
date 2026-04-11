import type { Order } from './types'

/**
 * Receipt printing — opens the server-rendered receipt page in a new tab.
 * The receipt page auto-triggers window.print() and includes a Print button.
 */

export function printReceipt(order: Order) {
  const url = `/api/orders/${order.id}/receipt`
  window.open(url, '_blank')
}
