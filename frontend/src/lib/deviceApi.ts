/**
 * Device API client - uses X-API-Key header for authentication.
 * Only accesses /api/pos/* endpoints (restricted to safe operations).
 */

import { Product, Category, Order, ExchangeRate } from './types'
import { getApiBase } from './api'

class DeviceAPIError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown
  ) {
    super(message)
    this.name = 'DeviceAPIError'
  }
}

function getApiKey(): string | null {
  return localStorage.getItem('device_api_key')
}

function getDeviceId(): string | null {
  return localStorage.getItem('device_id')
}

function getDeviceName(): string | null {
  return localStorage.getItem('device_name')
}

function getBaseUrl(): string | null {
  return localStorage.getItem('device_base_url')
}

async function deviceRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new DeviceAPIError(401, 'Not paired - no API key')
  }

  const url = `${getApiBase()}${path}`
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
  }

  if (body) {
    options.body = JSON.stringify(body)
  }

  const response = await fetch(url, options)

  if (response.status === 204) {
    return undefined as T
  }

  const data = await response.json()

  if (!response.ok) {
    if (response.status === 401) {
      // API key invalid - clear stored data
      localStorage.removeItem('device_api_key')
      localStorage.removeItem('device_id')
      localStorage.removeItem('device_name')
      window.location.reload()
    }
    throw new DeviceAPIError(response.status, data.error || 'API Error', data)
  }

  // Backend wraps all responses in { data: ... }
  if (data && typeof data === 'object' && 'data' in data) {
    return data.data as T
  }

  return data as T
}

// PoS Device API
export const posApi = {
  products: {
    list: () => deviceRequest<Product[]>('GET', '/pos/products'),
  },

  categories: {
    list: () => deviceRequest<Category[]>('GET', '/pos/categories'),
  },

  settings: {
    get: async () => {
      const raw = await deviceRequest<Record<string, string>>('GET', '/pos/settings')
      return {
        business_name: raw.business_name || '',
        fiat_currency: raw.fiat_currency || 'USD',
        tax_rate: parseFloat(raw.tax_rate) || 0,
        confirmation_threshold: parseInt(raw.confirmation_threshold) || 0,
      }
    },
  },

  rate: {
    get: (currency: string) => deviceRequest<ExchangeRate>('GET', `/pos/rate/${currency}`),
  },

  orders: {
    create: (data: {
      device_id?: string
      items: Array<{ product_id: string; product_name: string; quantity: number; unit_price: number; line_total: number; note?: string }>
      customer_name?: string
      note?: string
      subtotal_fiat: number
      tax_fiat: number
      total_fiat: number
      fiat_currency: string
      total_xmr: string
      xmr_rate: number
    }) => {
      // Auto-inject device_id
      const deviceId = getDeviceId()
      return deviceRequest<Order>('POST', '/pos/orders', { ...data, device_id: deviceId })
    },
    list: (filters?: { status?: string; limit?: number; offset?: number }) => {
      const params = new URLSearchParams()
      if (filters) {
        if (filters.status) params.append('status', filters.status)
        if (filters.limit) params.append('limit', filters.limit.toString())
        if (filters.offset) params.append('offset', filters.offset.toString())
      }
      const query = params.toString()
      return deviceRequest<Order[]>('GET', `/pos/orders${query ? '?' + query : ''}`)
    },
    get: (id: string) => deviceRequest<Order>('GET', `/pos/orders/${id}`),
    deliverOrder: (id: string) => deviceRequest<Order>('POST', `/pos/orders/${id}/deliver`),
    cancelOrder: (id: string) => deviceRequest<Order>('POST', `/pos/orders/${id}/cancel`, { status: 'cancelled' }),
  },

  heartbeat: () => {
    const deviceId = getDeviceId()
    if (deviceId) {
      deviceRequest<void>('POST', `/devices/${deviceId}/heartbeat`).catch(() => { })
    }
  },
}

// Pairing functions
export async function pairDevice(token: string): Promise<{ device_id: string; device_name: string; device_type: string; api_key: string }> {
  const response = await fetch(`${getApiBase()}/devices/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new DeviceAPIError(response.status, data.error || 'Pairing failed', data)
  }

  const result = data.data || data
  const apiKey = result.api_key
  const device = result.device

  // Store credentials
  localStorage.setItem('device_api_key', apiKey)
  localStorage.setItem('device_id', device.id)
  localStorage.setItem('device_name', device.name)
  localStorage.setItem('device_type', device.device_type || 'pos')
  localStorage.setItem('device_base_url', window.location.origin)

  return {
    device_id: device.id,
    device_name: device.name,
    device_type: device.device_type || 'pos',
    api_key: apiKey,
  }
}

export function isDevicePaired(): boolean {
  return !!getApiKey() && !!getDeviceId()
}

export function unpairDevice() {
  localStorage.removeItem('device_api_key')
  localStorage.removeItem('device_id')
  localStorage.removeItem('device_name')
  localStorage.removeItem('device_type')
  localStorage.removeItem('device_base_url')
}

export function getDeviceType(): string {
  return localStorage.getItem('device_type') || 'pos'
}

export function getDeviceInfo() {
  return {
    id: getDeviceId(),
    name: getDeviceName(),
    type: getDeviceType(),
    baseUrl: getBaseUrl(),
  }
}

export { DeviceAPIError }
