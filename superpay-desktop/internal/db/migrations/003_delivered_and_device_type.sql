-- Add delivered_at timestamp to orders
ALTER TABLE orders ADD COLUMN delivered_at DATETIME;

-- Add device_type to devices (default 'pos' for Point of Sale)
ALTER TABLE devices ADD COLUMN device_type TEXT DEFAULT 'pos';

-- Add device_type to pairing_tokens
ALTER TABLE pairing_tokens ADD COLUMN device_type TEXT DEFAULT 'pos';
