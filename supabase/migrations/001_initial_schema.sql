-- Migration 001 : Schéma Phase 1
-- Tables : products + price_history
-- NE PAS créer customers, orders, order_items (Phase 2)

-- Activer l'extension UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Table products
CREATE TABLE IF NOT EXISTS products (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  supplier       TEXT CHECK (supplier IN ('sligro', 'colruyt', 'nespresso')),
  reference      TEXT,
  category       TEXT,
  buy_price_eur  DECIMAL(10, 2),
  margin_pct     DECIMAL(5, 2) DEFAULT 30,
  sell_price_cdf DECIMAL(12, 2),
  image_url      TEXT,
  source_url     TEXT,
  active         BOOLEAN DEFAULT true,
  airtable_id    TEXT UNIQUE,
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- Index pour accélérer les recherches fréquentes
CREATE INDEX IF NOT EXISTS idx_products_supplier  ON products (supplier);
CREATE INDEX IF NOT EXISTS idx_products_active    ON products (active);
CREATE INDEX IF NOT EXISTS idx_products_airtable  ON products (airtable_id);

-- Table price_history
CREATE TABLE IF NOT EXISTS price_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID REFERENCES products (id) ON DELETE CASCADE,
  old_price   DECIMAL(10, 2),
  new_price   DECIMAL(10, 2),
  change_pct  DECIMAL(5, 2),
  recorded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_history_product   ON price_history (product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_recorded  ON price_history (recorded_at DESC);

-- Trigger : met à jour updated_at automatiquement à chaque modification
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Bucket Supabase Storage pour les images produits
-- (à créer manuellement dans le dashboard Supabase ou via CLI)
-- Nom du bucket : product-images
-- Accès : public
