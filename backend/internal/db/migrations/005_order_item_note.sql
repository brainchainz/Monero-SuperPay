-- Add note column to order_items for per-item notes (e.g., "no pickles")
ALTER TABLE order_items ADD COLUMN note TEXT NOT NULL DEFAULT '';
