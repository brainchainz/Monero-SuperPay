export interface Device {
  id: string
  name: string
  device_type?: string // 'pos' or 'order_monitor'
  api_key_hash?: string
  paired_at: string
  last_seen: string
  is_active: boolean
  config?: string
}

export interface PairingToken {
  token: string
  qr_data?: {
    token: string
    device_name: string
    connections: ConnectionMethod[]
  }
  connections?: ConnectionMethod[]
}

export interface ConnectionMethod {
  type: 'local' | 'tor' | 'tailscale'
  url: string
  name: string
}

export interface Product {
  id: string
  name: string
  description: string
  price: number
  price_unit: 'each' | 'lb' | 'kg'
  category_id: string
  image_url?: string
  active: boolean
  created_at: string
}

export interface Category {
  id: string
  name: string
  color?: string
}

export interface OrderItem {
  id?: string
  order_id?: string
  product_id?: string
  product_name: string
  name?: string // alias for display
  quantity: number
  unit_price: number
  line_total: number
  note?: string
}

export interface Order {
  id: string
  order_number?: number
  device_id?: string
  device_name?: string
  customer_name?: string
  note?: string
  items: OrderItem[]
  subtotal_fiat: number
  tax_fiat: number
  total_fiat: number
  fiat_currency: string
  total_xmr: string
  xmr_rate: number
  payment_id?: string
  payment_address: string
  payment_uri?: string
  wallet_name?: string
  status: string
  created_at: string
  paid_at?: string
  delivered_at?: string
}

export interface DashboardStats {
  today_orders: number
  today_revenue_fiat: number
  today_revenue_xmr: number
  fiat_currency: string
  active_devices: number
  total_devices: number
  recent_orders: Order[]
}

export interface Settings {
  business_name: string
  fiat_currency: string
  tax_rate: number
  confirmation_threshold: number
  tailscale_ip?: string
  tor_address?: string
  monero_node_url?: string
  monero_node_type?: string
  monero_node_user?: string
  monero_node_pass?: string
  show_prices_in_xmr?: boolean
  show_fiat_price?: boolean
  monero_node_sync_status?: {
    height: number
    target_height: number
  }
  lock_pin?: string
}

export interface Store {
  id: string
  name: string
  description: string
  created_at: string
  updated_at: string
  node_address: string
  node_type: string
}

export interface ExchangeRate {
  currency: string
  rate: number
  timestamp: string
}

export interface WalletStatus {
  configured: boolean
  address?: string
  height: number
  target_height: number
  syncing: boolean
  daemon_height: number
  daemon_connected: boolean
  blocks_to_sync: number
  filename?: string
}

export interface WalletFile {
  name: string
}
