import {
  Device,
  PairingToken,
  Product,
  Category,
  Order,
  DashboardStats,
  Settings,
  ExchangeRate,
  WalletStatus,
  WalletFile,
} from './types'

// In Wails, the Go backend runs on a random localhost port.
// We discover it via the Wails runtime bindings at startup.
// IMPORTANT: This must be a function (not a constant) because the Wails
// runtime sets __SUPERPAY_API_BASE__ asynchronously in main.tsx's initApp(),
// which runs AFTER ES module evaluation. A top-level constant would always
// get the fallback value.
// Set to true once initApp() in main.tsx has resolved the API base URL
export let apiReady = false
export function markApiReady() { apiReady = true }

export function getApiBase(): string {
  // 1. Prefer the live Wails-injected value
  if ((window as any).__SUPERPAY_API_BASE__) {
    return (window as any).__SUPERPAY_API_BASE__
  }
  // 2. Fall back to cached value from previous page load (survives reloads)
  const cached = localStorage.getItem('superpay_api_base')
  if (cached) {
    return cached
  }
  // 3. Last resort — works in normal browsers but NOT in Wails WebKit
  return '/api'
}

// Call after discovering the API base URL to persist across page reloads
export function cacheApiBase(url: string) {
  (window as any).__SUPERPAY_API_BASE__ = url
  localStorage.setItem('superpay_api_base', url)
}

// Resolve a product image URL (e.g. "/uploads/foo.jpg") to an absolute URL
// that points to the Go API server, not the Wails WebView origin.
export function resolveImageUrl(imageUrl: string | undefined | null): string {
  if (!imageUrl) return ''
  // Already absolute
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) return imageUrl
  // Strip /api suffix from the API base to get the server root
  const apiBase = getApiBase()
  const serverRoot = apiBase.replace(/\/api\/?$/, '')
  return serverRoot + imageUrl
}

class APIError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown
  ) {
    super(message)
    this.name = 'APIError'
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${getApiBase()}${path}`
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  }

  if (body) {
    options.body = JSON.stringify(body)
  }

  const response = await fetch(url, options)

  // Handle 204 No Content (DELETE responses)
  if (response.status === 204) {
    return undefined as T
  }

  const data = await response.json()

  if (!response.ok) {
    throw new APIError(response.status, data.error || 'API Error', data)
  }

  // Backend wraps all responses in { data: ... }, unwrap it
  if (data && typeof data === 'object' && 'data' in data) {
    return data.data as T
  }

  return data as T
}

export const get = <T,>(path: string) => request<T>('GET', path)
export const post = <T,>(path: string, body?: unknown) => request<T>('POST', path, body)
export const put = <T,>(path: string, body?: unknown) => request<T>('PUT', path, body)
export const del = <T,>(path: string) => request<T>('DELETE', path)

// Devices
export const devices = {
  list: () => get<Device[]>('/devices'),
  get: (id: string) => get<Device>(`/devices/${id}`),
  createPairingToken: (name: string, type: 'pos' | 'order_monitor', tailscaleIP?: string) =>
    post<PairingToken>('/devices/pairing-token', { device_name: name, device_type: type, tailscale_ip: tailscaleIP || undefined }),
  pair: (token: string, deviceId: string) =>
    post<Device>('/devices/pair', { token, device_id: deviceId }),
  getPairingTokenStatus: (token: string) => get<{ token: string; used: boolean }>(`/devices/pairing-token/${token}`),
  update: (id: string, data: Partial<Device>) => put<Device>(`/devices/${id}`, data),
  delete: (id: string) => del<void>(`/devices/${id}`),
}

// Products
export const products = {
  list: () => get<Product[]>('/products'),
  get: (id: string) => get<Product>(`/products/${id}`),
  create: (data: Omit<Product, 'id' | 'created_at'>) => post<Product>('/products', data),
  update: (id: string, data: Partial<Product>) => put<Product>(`/products/${id}`, data),
  delete: (id: string) => del<void>(`/products/${id}`),
  uploadImage: async (id: string, file: File): Promise<{ image_url: string }> => {
    const formData = new FormData()
    formData.append('image', file)
    const response = await fetch(`${getApiBase()}/products/${id}/image`, {
      method: 'POST',
      body: formData,
    })
    const data = await response.json()
    if (!response.ok) {
      throw new APIError(response.status, data.error || 'Upload failed', data)
    }
    // Backend wraps in { data: ... }
    if (data && typeof data === 'object' && 'data' in data) {
      return data.data
    }
    return data
  },
}

// Categories
export const categories = {
  list: () => get<Category[]>('/categories'),
  create: (data: Omit<Category, 'id'>) => post<Category>('/categories', data),
  update: (id: string, data: Partial<Category>) => put<Category>(`/categories/${id}`, data),
  delete: (id: string) => del<void>(`/categories/${id}`),
}

// Orders
export const orders = {
  list: (filters?: {
    status?: string
    device_id?: string
    limit?: number
    offset?: number
  }) => {
    const params = new URLSearchParams()
    if (filters) {
      if (filters.status) params.append('status', filters.status)
      if (filters.device_id) params.append('device_id', filters.device_id)
      if (filters.limit) params.append('limit', filters.limit.toString())
      if (filters.offset) params.append('offset', filters.offset.toString())
    }
    const query = params.toString()
    return get<Order[]>(`/orders${query ? '?' + query : ''}`)
  },
  get: (id: string) => get<Order>(`/orders/${id}`),
  create: (data: {
    device_id?: string
    items: Array<{ product_id?: string; product_name: string; quantity: number; unit_price: number; line_total: number; note?: string }>
    device_name?: string
    customer_name?: string
    note?: string
    subtotal_fiat: number
    tax_fiat: number
    total_fiat: number
    fiat_currency: string
    total_xmr: string
    xmr_rate: number
  }) => post<Order>('/orders', data),
  cancel: (id: string) => post<Order>(`/orders/${id}/cancel`, { status: 'cancelled' }),
  refund: (id: string) => post<Order>(`/orders/${id}/cancel`, { status: 'refunded' }),
  deliver: (id: string) => post<Order>(`/orders/${id}/deliver`),
  getStatus: (id: string) => get<{ status: string }>(`/orders/${id}/status`),
  getStats: () => get<{
    todays_total: number
    todays_count: number
    todays_paid_xmr: string
    week_total: number
    week_count: number
    month_total: number
    month_count: number
    sales_by_product: Array<{ product_name: string; quantity: number; total_fiat: number }>
    sales_by_device: Array<{ device_name: string; total_fiat: number; order_count: number }>
  }>('/orders/stats'),
  exportCSV: () => {
    // Return the URL so the browser can download it natively
    return `${getApiBase()}/orders/export/csv`
  }
}

// Settings
export const settings = {
  get: async (): Promise<Settings> => {
    const raw = await get<Record<string, string>>('/settings')
    // Backend stores all settings as key-value strings, convert to typed object
    return {
      business_name: raw.business_name || '',
      fiat_currency: raw.fiat_currency || 'USD',
      tax_rate: parseFloat(raw.tax_rate) || 0,
      confirmation_threshold: parseInt(raw.confirmation_threshold) || 0,
      tailscale_ip: raw.tailscale_ip || '',
      tor_address: raw.tor_address || '',
      monero_node_url: raw.monero_node_url || '',
      monero_node_type: raw.monero_node_type || '',
      monero_node_user: raw.monero_node_user || '',
      monero_node_pass: raw.monero_node_pass || '',
      show_prices_in_xmr: raw.show_prices_in_xmr !== 'false',
      show_fiat_price: raw.show_fiat_price !== 'false',
      monero_node_sync_status: raw.monero_node_sync_status
        ? JSON.parse(raw.monero_node_sync_status)
        : undefined,
    } as Settings
  },
  update: (data: Partial<Settings>) => {
    // Backend expects { settings: { key: value, ... } } format
    const settingsMap: Record<string, string> = {}
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        settingsMap[key] = String(value)
      }
    }
    return put<Settings>('/settings', { settings: settingsMap })
  },
}

// Wallet
export const node = {
  status: () => get<import('./types').NodeStatus>('/node/status'),
}

export const wallet = {
  status: () => get<WalletStatus>('/wallet/status'),
  setup: (data: { primary_address: string; secret_view_key: string; restore_height?: number; wallet_name?: string }) =>
    post<{ status: string; message: string; address: string }>('/wallet/setup', { ...data, confirm_overwrite: true }),
  list: () => get<WalletFile[]>('/wallet/list'),
  delete: () => post<{ status: string; message: string }>('/wallet/delete'),
  deleteFile: (name: string) => post<{ status: string; message: string }>('/wallet/delete-file', { name }),
}

// Stats
export const stats = {
  dashboard: () => get<DashboardStats>('/stats/dashboard'),
}

// Rate
export const rate = {
  get: (currency?: string) => get<ExchangeRate>(currency ? `/rate/${currency}` : '/rate'),
}

// Stores
export interface StoreListResponse {
  stores: { id: string; name: string; description: string; created_at: string; updated_at: string; node_address: string; node_type: string }[]
  active_store_id: string
}
export const stores = {
  list: () => get<StoreListResponse>('/stores'),
  create: (data: { name: string; description?: string }) => post<{ id: string; name: string }>('/stores', data),
  switch: (id: string) => post<{ id: string; name: string }>(`/stores/${id}/switch`),
  update: (id: string, data: { name: string; description?: string }) => put<{ id: string; name: string }>(`/stores/${id}`, data),
  delete: (id: string) => del<void>(`/stores/${id}`),
  exportStore: (id: string) => {
    // Returns download URL for the .superpay file
    return `${getApiBase()}/stores/${id}/export`
  },
  importStore: async (file: File): Promise<{ id: string; name: string }> => {
    const formData = new FormData()
    formData.append('file', file)
    const resp = await fetch(`${getApiBase()}/stores/import`, {
      method: 'POST',
      body: formData,
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Import failed' }))
      throw new APIError(resp.status, err.error || 'Import failed')
    }
    const json = await resp.json()
    return json.data || json
  },
}

export { APIError }
