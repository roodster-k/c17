/**
 * Migration v2 — Suppression Airtable, ajout logique financière complète
 * Run: node scripts/migrate-v2.mjs
 */

import { neon } from '@neondatabase/serverless'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local
const envFile = resolve(__dirname, '../.env.local')
const envContent = readFileSync(envFile, 'utf8')
for (const line of envContent.split('\n')) {
  const [key, ...vals] = line.split('=')
  if (key && !key.startsWith('#') && vals.length) {
    process.env[key.trim()] = vals.join('=').trim()
  }
}

const sql = neon(process.env.DATABASE_URL)

async function run() {
  console.log('🚀 Migration v2 — Start\n')

  // 1. Update products table
  console.log('1. Updating products table...')
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS poids_kg numeric`
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS unite text`
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS brand text`
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS content_description text`
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS sligro_code text`
  console.log('   ✓ products updated')

  // 2. Supplier configs table
  console.log('2. Creating supplier_configs...')
  await sql`
    CREATE TABLE IF NOT EXISTS supplier_configs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      supplier text NOT NULL UNIQUE,
      display_name text NOT NULL,
      frais_achat_pct numeric NOT NULL DEFAULT 0,
      currency text NOT NULL DEFAULT 'EUR',
      notes text,
      active boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `
  // Insert defaults
  await sql`
    INSERT INTO supplier_configs (supplier, display_name, frais_achat_pct, notes)
    VALUES
      ('sligro', 'Sligro (Belgique)', 10, 'Grossiste néerlandais, retrait Hyper/Select'),
      ('colruyt', 'Colruyt', 12, 'Distributeur belge, 2 formats magasin'),
      ('nespresso', 'Nespresso', 15, 'Produits café premium')
    ON CONFLICT (supplier) DO NOTHING
  `
  console.log('   ✓ supplier_configs created with defaults')

  // 3. Exchange rates table
  console.log('3. Creating exchange_rates...')
  await sql`
    CREATE TABLE IF NOT EXISTS exchange_rates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      currency_from text NOT NULL DEFAULT 'EUR',
      currency_to text NOT NULL DEFAULT 'USD',
      rate numeric NOT NULL,
      note text,
      recorded_at timestamptz NOT NULL DEFAULT now(),
      active boolean NOT NULL DEFAULT true
    )
  `
  // Insert current rate
  await sql`
    INSERT INTO exchange_rates (currency_from, currency_to, rate, note, active)
    VALUES ('EUR', 'USD', 1.08, 'Taux initial — à mettre à jour manuellement', true)
    ON CONFLICT DO NOTHING
  `
  console.log('   ✓ exchange_rates created')

  // 4. Clients table
  console.log('4. Creating clients...')
  await sql`
    CREATE TABLE IF NOT EXISTS clients (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      city text NOT NULL DEFAULT 'Kinshasa',
      country text NOT NULL DEFAULT 'Congo',
      contact_email text,
      frais_achat_pct numeric,
      notes text,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `
  // Insert known clients
  await sql`
    INSERT INTO clients (name, city, country, notes)
    VALUES
      ('Hilton', 'Kinshasa', 'Congo', 'Hôtel haut de gamme'),
      ('IBIS', 'Kinshasa', 'Congo', 'Frais achat 15%'),
      ('Golden Tulip', 'Kinshasa', 'Congo', NULL),
      ('Kertel Suites', 'Kinshasa', 'Congo', NULL),
      ('CFH (Congo Free Hotel)', 'Kinshasa', 'Congo', NULL),
      ('Four Points', 'Kinshasa', 'Congo', NULL)
    ON CONFLICT DO NOTHING
  `
  console.log('   ✓ clients created with 6 hôtels')

  // 5. App config table (fret, taux courant, etc.)
  console.log('5. Creating app_config...')
  await sql`
    CREATE TABLE IF NOT EXISTS app_config (
      key text PRIMARY KEY,
      value text NOT NULL,
      label text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `
  await sql`
    INSERT INTO app_config (key, value, label)
    VALUES
      ('fret_par_kg_eur', '2.50', 'Coût fret par kg (€)'),
      ('taux_eur_usd', '1.08', 'Taux EUR/USD courant'),
      ('taux_eur_cdf', '2900', 'Taux EUR/CDF courant'),
      ('price_alert_threshold_pct', '5', 'Seuil alerte variation prix (%)')
    ON CONFLICT (key) DO UPDATE SET updated_at = now()
  `
  console.log('   ✓ app_config created')

  // 6. Scraping logs table
  console.log('6. Creating scraping_logs...')
  await sql`
    CREATE TABLE IF NOT EXISTS scraping_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      supplier text NOT NULL,
      status text NOT NULL CHECK (status IN ('running', 'success', 'error')),
      products_found integer NOT NULL DEFAULT 0,
      products_updated integer NOT NULL DEFAULT 0,
      error text,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz,
      metadata jsonb
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_scraping_logs_supplier ON scraping_logs(supplier)`
  await sql`CREATE INDEX IF NOT EXISTS idx_scraping_logs_started ON scraping_logs(started_at DESC)`
  console.log('   ✓ scraping_logs created')

  // 7. Verify
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `
  console.log('\n✅ Tables in DB:')
  tables.forEach(t => console.log(`   - ${t.table_name}`))

  console.log('\n✓ Migration v2 completed!')
}

run().catch(err => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})
