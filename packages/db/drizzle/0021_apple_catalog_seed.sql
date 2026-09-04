-- 0021 · Catálogo Apple completo para el alta de unidades.
--
-- La tabla es global y la siembra es idempotente: una instalación con las ocho filas históricas
-- recibe las capacidades/colores corregidos y las nuevas líneas sin cambiar ids existentes.
INSERT INTO "catalog_models" (
  "id", "slug", "brand", "family", "display_name", "release_year",
  "storage_options_gb", "colors", "is_active"
) VALUES
  ('00000000-0000-4000-8000-000000000101', 'iphone-11', 'Apple', 'iPhone', 'iPhone 11', 2019, ARRAY[64, 128, 256], ARRAY['Negro', 'Blanco', 'Verde', 'Amarillo', 'Morado', '(PRODUCT)RED'], true),
  ('00000000-0000-4000-8000-000000000102', 'iphone-12', 'Apple', 'iPhone', 'iPhone 12', 2020, ARRAY[64, 128, 256], ARRAY['Negro', 'Blanco', 'Verde', 'Azul', 'Morado', '(PRODUCT)RED'], true),
  ('00000000-0000-4000-8000-000000000103', 'iphone-13', 'Apple', 'iPhone', 'iPhone 13', 2021, ARRAY[128, 256, 512], ARRAY['Medianoche', 'Blanco estelar', 'Azul', 'Rosa', 'Verde', '(PRODUCT)RED'], true),
  ('00000000-0000-4000-8000-000000000104', 'iphone-13-pro', 'Apple', 'iPhone', 'iPhone 13 Pro', 2021, ARRAY[128, 256, 512, 1024], ARRAY['Grafito', 'Oro', 'Plata', 'Azul Sierra', 'Verde alpino'], true),
  ('00000000-0000-4000-8000-000000000105', 'iphone-14', 'Apple', 'iPhone', 'iPhone 14', 2022, ARRAY[128, 256, 512], ARRAY['Medianoche', 'Morado', 'Blanco estelar', 'Azul', 'Amarillo', '(PRODUCT)RED'], true),
  ('00000000-0000-4000-8000-000000000106', 'iphone-14-pro', 'Apple', 'iPhone', 'iPhone 14 Pro', 2022, ARRAY[128, 256, 512, 1024], ARRAY['Negro espacial', 'Plata', 'Oro', 'Morado oscuro'], true),
  ('00000000-0000-4000-8000-000000000107', 'iphone-15', 'Apple', 'iPhone', 'iPhone 15', 2023, ARRAY[128, 256, 512], ARRAY['Negro', 'Azul', 'Verde', 'Amarillo', 'Rosa'], true),
  ('00000000-0000-4000-8000-000000000108', 'iphone-15-pro-max', 'Apple', 'iPhone', 'iPhone 15 Pro Max', 2023, ARRAY[256, 512, 1024], ARRAY['Titanio negro', 'Titanio blanco', 'Titanio azul', 'Titanio natural'], true),
  ('00000000-0000-4000-8000-000000000109', 'iphone-xr', 'Apple', 'iPhone', 'iPhone XR', 2018, ARRAY[64, 128, 256], ARRAY['Negro', 'Blanco', 'Azul', 'Amarillo', 'Coral', '(PRODUCT)RED'], true),
  ('00000000-0000-4000-8000-000000000110', 'iphone-se-2a-gen', 'Apple', 'iPhone', 'iPhone SE 2ª gen', 2020, ARRAY[64, 128, 256], ARRAY['Negro', 'Blanco', '(PRODUCT)RED'], true),
  ('00000000-0000-4000-8000-000000000111', 'iphone-11-pro', 'Apple', 'iPhone', 'iPhone 11 Pro', 2019, ARRAY[64, 256, 512], ARRAY['Gris espacial', 'Plata', 'Oro', 'Verde medianoche'], true),
  ('00000000-0000-4000-8000-000000000112', 'iphone-11-pro-max', 'Apple', 'iPhone', 'iPhone 11 Pro Max', 2019, ARRAY[64, 256, 512], ARRAY['Gris espacial', 'Plata', 'Oro', 'Verde medianoche'], true),
  ('00000000-0000-4000-8000-000000000113', 'iphone-12-mini', 'Apple', 'iPhone', 'iPhone 12 mini', 2020, ARRAY[64, 128, 256], ARRAY['Negro', 'Blanco', 'Verde', 'Azul', 'Morado', '(PRODUCT)RED'], true),
  ('00000000-0000-4000-8000-000000000114', 'iphone-12-pro', 'Apple', 'iPhone', 'iPhone 12 Pro', 2020, ARRAY[128, 256, 512], ARRAY['Plata', 'Grafito', 'Oro', 'Azul pacífico'], true),
  ('00000000-0000-4000-8000-000000000115', 'iphone-12-pro-max', 'Apple', 'iPhone', 'iPhone 12 Pro Max', 2020, ARRAY[128, 256, 512], ARRAY['Plata', 'Grafito', 'Oro', 'Azul pacífico'], true),
  ('00000000-0000-4000-8000-000000000116', 'iphone-13-mini', 'Apple', 'iPhone', 'iPhone 13 mini', 2021, ARRAY[128, 256, 512], ARRAY['Medianoche', 'Blanco estelar', 'Azul', 'Rosa', 'Verde', '(PRODUCT)RED'], true),
  ('00000000-0000-4000-8000-000000000117', 'iphone-13-pro-max', 'Apple', 'iPhone', 'iPhone 13 Pro Max', 2021, ARRAY[128, 256, 512, 1024], ARRAY['Grafito', 'Oro', 'Plata', 'Azul Sierra', 'Verde alpino'], true),
  ('00000000-0000-4000-8000-000000000118', 'iphone-se-3a-gen', 'Apple', 'iPhone', 'iPhone SE 3ª gen', 2022, ARRAY[64, 128, 256], ARRAY['Medianoche', 'Blanco estelar', '(PRODUCT)RED'], true),
  ('00000000-0000-4000-8000-000000000119', 'iphone-14-plus', 'Apple', 'iPhone', 'iPhone 14 Plus', 2022, ARRAY[128, 256, 512], ARRAY['Medianoche', 'Morado', 'Blanco estelar', 'Azul', 'Amarillo', '(PRODUCT)RED'], true),
  ('00000000-0000-4000-8000-000000000120', 'iphone-14-pro-max', 'Apple', 'iPhone', 'iPhone 14 Pro Max', 2022, ARRAY[128, 256, 512, 1024], ARRAY['Negro espacial', 'Plata', 'Oro', 'Morado oscuro'], true),
  ('00000000-0000-4000-8000-000000000121', 'iphone-15-plus', 'Apple', 'iPhone', 'iPhone 15 Plus', 2023, ARRAY[128, 256, 512], ARRAY['Negro', 'Azul', 'Verde', 'Amarillo', 'Rosa'], true),
  ('00000000-0000-4000-8000-000000000122', 'iphone-15-pro', 'Apple', 'iPhone', 'iPhone 15 Pro', 2023, ARRAY[128, 256, 512, 1024], ARRAY['Titanio negro', 'Titanio blanco', 'Titanio azul', 'Titanio natural'], true),
  ('00000000-0000-4000-8000-000000000123', 'iphone-16', 'Apple', 'iPhone', 'iPhone 16', 2024, ARRAY[128, 256, 512], ARRAY['Negro', 'Blanco', 'Rosa', 'Verde azulado', 'Ultramarino'], true),
  ('00000000-0000-4000-8000-000000000124', 'iphone-16-plus', 'Apple', 'iPhone', 'iPhone 16 Plus', 2024, ARRAY[128, 256, 512], ARRAY['Negro', 'Blanco', 'Rosa', 'Verde azulado', 'Ultramarino'], true),
  ('00000000-0000-4000-8000-000000000125', 'iphone-16e', 'Apple', 'iPhone', 'iPhone 16e', 2025, ARRAY[128, 256, 512], ARRAY['Negro', 'Blanco'], true),
  ('00000000-0000-4000-8000-000000000126', 'iphone-16-pro', 'Apple', 'iPhone', 'iPhone 16 Pro', 2024, ARRAY[128, 256, 512, 1024], ARRAY['Titanio negro', 'Titanio blanco', 'Titanio natural', 'Titanio del desierto'], true),
  ('00000000-0000-4000-8000-000000000127', 'iphone-16-pro-max', 'Apple', 'iPhone', 'iPhone 16 Pro Max', 2024, ARRAY[256, 512, 1024], ARRAY['Titanio negro', 'Titanio blanco', 'Titanio natural', 'Titanio del desierto'], true),
  ('00000000-0000-4000-8000-000000000128', 'iphone-17', 'Apple', 'iPhone', 'iPhone 17', 2025, ARRAY[256, 512], ARRAY['Negro', 'Blanco', 'Azul neblina', 'Salvia', 'Lavanda'], true),
  ('00000000-0000-4000-8000-000000000129', 'iphone-air', 'Apple', 'iPhone', 'iPhone Air', 2025, ARRAY[256, 512, 1024], ARRAY['Negro espacial', 'Blanco nube', 'Oro claro', 'Azul cielo'], true),
  ('00000000-0000-4000-8000-000000000130', 'iphone-17-pro', 'Apple', 'iPhone', 'iPhone 17 Pro', 2025, ARRAY[256, 512, 1024], ARRAY['Plata', 'Naranja cósmico', 'Azul profundo'], true),
  ('00000000-0000-4000-8000-000000000131', 'iphone-17-pro-max', 'Apple', 'iPhone', 'iPhone 17 Pro Max', 2025, ARRAY[256, 512, 1024, 2048], ARRAY['Plata', 'Naranja cósmico', 'Azul profundo'], true),
  ('00000000-0000-4000-8000-000000000132', 'iphone-17e', 'Apple', 'iPhone', 'iPhone 17e', 2026, ARRAY[256, 512], ARRAY['Negro', 'Blanco', 'Rosa pálido'], true)
ON CONFLICT ("slug") DO UPDATE SET
  "brand" = EXCLUDED."brand",
  "family" = EXCLUDED."family",
  "display_name" = EXCLUDED."display_name",
  "release_year" = EXCLUDED."release_year",
  "storage_options_gb" = EXCLUDED."storage_options_gb",
  "colors" = EXCLUDED."colors",
  "is_active" = EXCLUDED."is_active",
  "updated_at" = now();
