-- Add wallet_name column to orders to track which wallet was used
ALTER TABLE orders ADD COLUMN wallet_name TEXT DEFAULT '';
