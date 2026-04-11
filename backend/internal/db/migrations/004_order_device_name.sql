-- Persist device_name directly on orders so dashboard orders ("SuperPay Main")
-- can be identified without a device_id foreign key.
ALTER TABLE orders ADD COLUMN device_name TEXT DEFAULT '';
