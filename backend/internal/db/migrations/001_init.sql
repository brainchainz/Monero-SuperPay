-- devices table
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,
  paired_at DATETIME NOT NULL DEFAULT (datetime('now')),
  last_seen DATETIME,
  is_active BOOLEAN DEFAULT 1,
  config TEXT DEFAULT '{}'
);

-- pairing_tokens table (one-time use)
CREATE TABLE IF NOT EXISTS pairing_tokens (
  token TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  used BOOLEAN DEFAULT 0
);

-- categories table
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  color TEXT DEFAULT '#6B7280'
);

-- products table
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price REAL NOT NULL,
  price_unit TEXT DEFAULT 'each',
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  image_path TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- orders table
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number INTEGER,
  device_id TEXT REFERENCES devices(id),
  customer_name TEXT DEFAULT '',
  note TEXT DEFAULT '',
  subtotal_fiat REAL NOT NULL,
  tax_fiat REAL DEFAULT 0,
  total_fiat REAL NOT NULL,
  fiat_currency TEXT NOT NULL,
  total_xmr TEXT NOT NULL,
  xmr_rate REAL NOT NULL,
  payment_id TEXT DEFAULT '',
  payment_address TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  paid_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- order_items table
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL
);

-- settings table (key-value)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- sequences table for auto-increment order numbers
CREATE TABLE IF NOT EXISTS sequences (
  name TEXT PRIMARY KEY,
  value INTEGER DEFAULT 0
);

-- Initialize order_number sequence
INSERT OR IGNORE INTO sequences (name, value) VALUES ('order_number', 1000);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_orders_device_id ON orders(device_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_payment_address ON orders(payment_address);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_devices_is_active ON devices(is_active);
CREATE INDEX IF NOT EXISTS idx_pairing_tokens_expires_at ON pairing_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_pairing_tokens_token ON pairing_tokens(token);
