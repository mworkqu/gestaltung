-- ============================================================================
-- OPTIONAL TEST DATA — not a migration. Run only to try the bill of materials.
-- ============================================================================
-- Adds four clearly-marked TEST products to the store so one analysis shows
-- all three BOM states:
--   * a servo line        → one clear product      (Matched)
--   * a controller line   → two equal candidates   (Choose one)
--   * a soil probe line   → nothing in the store   (Not stocked → sourcing gap)
-- They are PUBLISHED (the matcher only reads published products), so they
-- are visible in the live store while they exist. Remove them afterwards with
-- the DELETE at the bottom.
--
-- Needs 0023 (parts.tags). Safe to re-run.
-- ============================================================================

insert into public.parts (sku, name, name_ar, description, category, unit_price, min_order_qty, stock_status, is_published, tags)
values
  ('TEST-SERVO-5V', 'TEST Standard servo 5V 3.5 kg.cm', 'اختبار — محرك سيرفو قياسي 5 فولت',
   'Standard-size hobby servo, 5V, 3.5 kg.cm torque.', 'Electronics', 45.00, 1, 'in_stock', true,
   array['servo', 'steering', 'steering servo', '5v', 'motor']),
  ('TEST-CTRL-WIFI', 'TEST Main controller board, WiFi, 3.3V', 'اختبار — لوحة تحكم رئيسية واي فاي',
   'Microcontroller development board with WiFi, 3.3V logic.', 'Electronics modules', 38.00, 1, 'in_stock', true,
   array['controller', 'main controller', 'microcontroller', 'mcu', 'wifi', '3.3v']),
  ('TEST-CTRL-BT', 'TEST Main controller board, Bluetooth, 3.3V', 'اختبار — لوحة تحكم رئيسية بلوتوث',
   'Microcontroller development board with Bluetooth, 3.3V logic.', 'Electronics modules', 32.00, 1, 'low_stock', true,
   array['controller', 'main controller', 'microcontroller', 'mcu', 'bluetooth', '3.3v']),
  ('TEST-M3-SCREW', 'TEST M3 x 10 stainless screw (pack of 50)', 'اختبار — براغي M3 ستانلس',
   'M3 x 10 mm stainless socket head screws, pack of 50.', 'Fasteners', 12.00, 1, 'in_stock', true,
   array['screw', 'screws', 'mounting screws', 'm3', 'stainless', 'fastener'])
on conflict (sku) do update set
  name = excluded.name, name_ar = excluded.name_ar, description = excluded.description,
  category = excluded.category, unit_price = excluded.unit_price, stock_status = excluded.stock_status,
  is_published = excluded.is_published, tags = excluded.tags;

-- Remove the test products when you are done:
-- delete from public.parts where sku like 'TEST-%';
