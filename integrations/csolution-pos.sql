-- Run on the CSolution shop database as the schema owner.
-- Supply a dedicated, existing login role with psql -v reader=csbot_reader.
BEGIN;
CREATE SCHEMA IF NOT EXISTS csbot_catalog;
REVOKE ALL ON SCHEMA csbot_catalog FROM PUBLIC;

CREATE OR REPLACE VIEW csbot_catalog.products AS
SELECT p.id, p.name, p.sku, b.name AS brand, c.name AS category, p.type, p.unit,
       p.description, p.price AS retail_price, p.on_hand AS available_to_sell,
       p.warranty, business.currency,
       CASE WHEN p.image_url ~ '^/api/images/[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' THEN
              substring(p.image_url FROM 13)::uuid END AS image_id,
       CASE WHEN p.image_url LIKE 'https://%' THEN p.image_url END AS image_url
FROM public.products p
LEFT JOIN public.brands b ON b.id=p.brand_id
LEFT JOIN public.categories c ON c.id=p.category_id
JOIN public.business ON business.id=1
WHERE p.active;

CREATE OR REPLACE VIEW csbot_catalog.product_images AS
SELECT i.id, i.content_type, i.data
FROM public.images i
WHERE octet_length(i.data) <= 5242880
  AND i.content_type IN ('image/png','image/jpeg','image/webp')
  AND EXISTS (SELECT 1 FROM csbot_catalog.products p WHERE p.image_id=i.id);

GRANT USAGE ON SCHEMA csbot_catalog TO :"reader";
GRANT SELECT ON csbot_catalog.products, csbot_catalog.product_images TO :"reader";
COMMIT;
