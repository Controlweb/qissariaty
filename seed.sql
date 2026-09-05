-- Local development seed. Applied with: pnpm db:seed
-- Ids are fixed so you can link to them while developing.
-- The demo password for every account below is: qissariaty-dev

DELETE FROM order_items;
DELETE FROM reviews;
DELETE FROM product_variants;
DELETE FROM product_options;
DELETE FROM deliveries;
DELETE FROM orders;
DELETE FROM cart_items;
DELETE FROM carts;
DELETE FROM products;
DELETE FROM stores;
DELETE FROM markets;
DELETE FROM categories;
DELETE FROM sessions;
DELETE FROM addresses;
DELETE FROM users;

-- password_hash is PBKDF2-SHA256 at 100k iterations (the Workers ceiling) for
-- the shared demo password above, so these accounts can actually sign in.
INSERT INTO users (id, email, name, role, status, password_hash, created_at) VALUES
  ('11111111-1111-4111-8111-111111111111', 'owner@qissariaty.ma',     'Rachid Benali',  'STORE_OWNER', 'ACTIVE', 'pbkdf2$100000$XqBqgEL36GnMIsK9DL1z1g==$7F7gVFV2iEeDr1sXPQVbOuUUS6Jy9A+YwoMQG+Rv1Go=', unixepoch()),
  ('22222222-2222-4222-8222-222222222222', 'deliverer@qissariaty.ma', 'Youssef Amrani', 'DELIVERER',   'ACTIVE', 'pbkdf2$100000$XqBqgEL36GnMIsK9DL1z1g==$7F7gVFV2iEeDr1sXPQVbOuUUS6Jy9A+YwoMQG+Rv1Go=', unixepoch()),
  ('33333333-3333-4333-8333-333333333333', 'admin@qissariaty.ma',     'Admin',          'ADMIN',       'ACTIVE', 'pbkdf2$100000$XqBqgEL36GnMIsK9DL1z1g==$7F7gVFV2iEeDr1sXPQVbOuUUS6Jy9A+YwoMQG+Rv1Go=', unixepoch());

INSERT INTO categories (id, slug, name) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'artisanat', 'Artisanat'),
  ('c0000000-0000-4000-8000-000000000002', 'epicerie',  'Épicerie'),
  ('c0000000-0000-4000-8000-000000000003', 'textile',   'Textile');

INSERT INTO markets (id, slug, name, name_ar, city, description, lat, lng, status, created_at) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'qissariat-habous',   'Qissariat Habous',   'قيسارية الحبوس',  'Casablanca', 'Le quartier des Habous et ses boutiques d''artisanat.', 33.5820, -7.6100, 'ACTIVE', unixepoch()),
  ('a0000000-0000-4000-8000-000000000002', 'souk-derb-ghallef',  'Souk Derb Ghallef',  NULL,               'Casablanca', 'Électronique, textile et bonnes affaires.',            33.5680, -7.6350, 'ACTIVE', unixepoch()),
  ('a0000000-0000-4000-8000-000000000003', 'souk-semmarine',     'Souk Semmarine',     'سوق السماريــن',  'Marrakech',  'Le coeur de la médina de Marrakech.',                  31.6295, -7.9890, 'ACTIVE', unixepoch());

INSERT INTO stores (id, market_id, owner_id, slug, name, description, phone, status, lat, lng, created_at) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'maison-du-cuir', 'Maison du Cuir', 'Babouches, sacs et ceintures faits main.', '+212600000001', 'ACTIVE', 33.5821, -7.6101, unixepoch()),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'epices-atlas',   'Épices Atlas',   'Épices, safran et huile d''argan.',        '+212600000002', 'ACTIVE', 33.5819, -7.6099, unixepoch());

-- Prices are in centimes: 24900 = 249,00 MAD.
INSERT INTO products (id, store_id, category_id, name, description, price_minor, currency, stock, status, created_at) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Babouches en cuir',      'Cuir tanné à Fès, cousu main.',    24900, 'MAD', 12, 'ACTIVE', unixepoch()),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Sac bandoulière',        'Cuir naturel, doublure coton.',    49900, 'MAD',  4, 'ACTIVE', unixepoch()),
  ('d0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'Safran de Taliouine 1g', 'Récolte de l''année.',              8900, 'MAD', 30, 'ACTIVE', unixepoch()),
  ('d0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'Huile d''argan 250ml',   'Pressée à froid, coopérative.',    12900, 'MAD',  0, 'ACTIVE', unixepoch());

-- Options and declinaisons for the babouches, so the variant picker has
-- something real to resolve. Prices differ per colour and some sizes are out of
-- stock, which is what makes the picker's strike-through visible.
--
-- "values" is a SQLite reserved word and must be quoted in raw SQL. Drizzle
-- quotes it automatically, so this only bites hand-written statements.
INSERT INTO product_options (id, product_id, name, "values", position) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Couleur',  '["Naturel","Noir","Safran"]', 0),
  ('e0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'Pointure', '["40","42","44"]', 1);

INSERT INTO product_variants (id, product_id, options, label, sku, price_minor, stock) VALUES
  ('f0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', '{"Couleur":"Naturel","Pointure":"40"}', 'Naturel 40', 'BAB-NAT-40', 24900, 4),
  ('f0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', '{"Couleur":"Naturel","Pointure":"42"}', 'Naturel 42', 'BAB-NAT-42', 24900, 6),
  ('f0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', '{"Couleur":"Naturel","Pointure":"44"}', 'Naturel 44', 'BAB-NAT-44', 24900, 0),
  ('f0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000001', '{"Couleur":"Noir","Pointure":"40"}',    'Noir 40',    'BAB-NOI-40', 26900, 2),
  ('f0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000001', '{"Couleur":"Noir","Pointure":"42"}',    'Noir 42',    'BAB-NOI-42', 26900, 3),
  ('f0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000001', '{"Couleur":"Noir","Pointure":"44"}',    'Noir 44',    'BAB-NOI-44', 26900, 1),
  ('f0000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000001', '{"Couleur":"Safran","Pointure":"40"}',  'Safran 40',  'BAB-SAF-40', 29900, 0),
  ('f0000000-0000-4000-8000-000000000008', 'd0000000-0000-4000-8000-000000000001', '{"Couleur":"Safran","Pointure":"42"}',  'Safran 42',  'BAB-SAF-42', 29900, 2),
  ('f0000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000001', '{"Couleur":"Safran","Pointure":"44"}',  'Safran 44',  'BAB-SAF-44', 29900, 0);

-- Keep the product row consistent with its declinaisons: cheapest price, total stock.
UPDATE products SET price_minor = 24900, stock = 18 WHERE id = 'd0000000-0000-4000-8000-000000000001';
