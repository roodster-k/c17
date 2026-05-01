import { neon } from '@neondatabase/serverless'
import type { Product, PriceHistory } from '@/types/database'

// Client SQL Neon — driver HTTP serverless (compatible Vercel)
export const sql = neon(process.env.DATABASE_URL!)

// Helper pour requêtes dynamiques paramétrées (contourne la limitation tagged template)
async function query<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  // Neon supporte aussi l'appel direct avec .query() via l'objet sous-jacent
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (sql as any).query(text, params).then((r: any) => r.rows ?? r) as Promise<T[]>
}

// ─── Products ────────────────────────────────────────────────

export async function getProducts(filters?: {
  supplier?: string
  active?: boolean
  search?: string
  limit?: number
}): Promise<Product[]> {
  const { supplier, active, search, limit = 100 } = filters ?? {}

  // Construction dynamique de la requête
  let q = 'SELECT * FROM products WHERE 1=1'
  const params: unknown[] = []
  let i = 1

  if (supplier) { q += ` AND supplier = $${i++}`; params.push(supplier) }
  if (active !== undefined) { q += ` AND active = $${i++}`; params.push(active) }
  if (search) { q += ` AND name ILIKE $${i++}`; params.push(`%${search}%`) }

  q += ` ORDER BY updated_at DESC LIMIT $${i}`
  params.push(limit)

  const rows = await query<Product>(q, params)
  return rows
}

export async function getProductById(id: string): Promise<Product | null> {
  const rows = await sql`SELECT * FROM products WHERE id = ${id} LIMIT 1`
  return (rows[0] as Product) ?? null
}

export async function getProductByAirtableId(airtableId: string): Promise<Product | null> {
  const rows = await sql`SELECT * FROM products WHERE airtable_id = ${airtableId} LIMIT 1`
  return (rows[0] as Product) ?? null
}

export async function upsertProduct(data: {
  name: string
  supplier: string | null
  reference: string | null
  category: string | null
  buy_price_eur: number
  margin_pct: number
  sell_price_cdf: number
  image_url: string | null
  source_url: string | null
  active: boolean
  airtable_id: string
}): Promise<Product> {
  const rows = await sql`
    INSERT INTO products (
      name, supplier, reference, category,
      buy_price_eur, margin_pct, sell_price_cdf,
      image_url, source_url, active, airtable_id, updated_at
    ) VALUES (
      ${data.name}, ${data.supplier}, ${data.reference}, ${data.category},
      ${data.buy_price_eur}, ${data.margin_pct}, ${data.sell_price_cdf},
      ${data.image_url}, ${data.source_url}, ${data.active}, ${data.airtable_id}, now()
    )
    ON CONFLICT (airtable_id) DO UPDATE SET
      name           = EXCLUDED.name,
      supplier       = EXCLUDED.supplier,
      reference      = EXCLUDED.reference,
      category       = EXCLUDED.category,
      buy_price_eur  = EXCLUDED.buy_price_eur,
      margin_pct     = EXCLUDED.margin_pct,
      sell_price_cdf = EXCLUDED.sell_price_cdf,
      image_url      = EXCLUDED.image_url,
      source_url     = EXCLUDED.source_url,
      active         = EXCLUDED.active,
      updated_at     = now()
    RETURNING *
  `
  return rows[0] as Product
}

export async function updateProduct(id: string, data: Partial<{
  active: boolean
  margin_pct: number
  sell_price_cdf: number
}>): Promise<void> {
  const sets: string[] = []
  const params: unknown[] = []
  let i = 1

  if (data.active !== undefined) { sets.push(`active = $${i++}`); params.push(data.active) }
  if (data.margin_pct !== undefined) { sets.push(`margin_pct = $${i++}`); params.push(data.margin_pct) }
  if (data.sell_price_cdf !== undefined) { sets.push(`sell_price_cdf = $${i++}`); params.push(data.sell_price_cdf) }

  if (sets.length === 0) return
  sets.push(`updated_at = now()`)
  params.push(id)

  await query(`UPDATE products SET ${sets.join(', ')} WHERE id = $${i}`, params)
}

// ─── Price History ───────────────────────────────────────────

export async function insertPriceHistory(data: {
  product_id: string
  old_price: number
  new_price: number
  change_pct: number
}): Promise<void> {
  await sql`
    INSERT INTO price_history (product_id, old_price, new_price, change_pct)
    VALUES (${data.product_id}, ${data.old_price}, ${data.new_price}, ${data.change_pct})
  `
}

export async function getPriceHistory(filters?: {
  since?: string
  supplier?: string
  limit?: number
}): Promise<(PriceHistory & { product_name: string; product_supplier: string; product_reference: string })[]> {
  const { since, supplier, limit = 200 } = filters ?? {}

  let q = `
    SELECT ph.*, p.name AS product_name, p.supplier AS product_supplier, p.reference AS product_reference
    FROM price_history ph
    JOIN products p ON p.id = ph.product_id
    WHERE 1=1
  `
  const params: unknown[] = []
  let i = 1

  if (since) { q += ` AND ph.recorded_at >= $${i++}`; params.push(since) }
  if (supplier) { q += ` AND p.supplier = $${i++}`; params.push(supplier) }

  q += ` ORDER BY ph.recorded_at DESC LIMIT $${i}`
  params.push(limit)

  return query<PriceHistory & { product_name: string; product_supplier: string; product_reference: string }>(q, params)
}

// ─── Stats dashboard ─────────────────────────────────────────

export async function getDashboardStats() {
  const [totals, bySupplier, recentChanges] = await Promise.all([
    sql`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE active) AS active FROM products`,
    sql`SELECT supplier, COUNT(*) AS count FROM products GROUP BY supplier`,
    sql`
      SELECT ph.id, ph.change_pct, ph.recorded_at
      FROM price_history ph
      WHERE ph.recorded_at >= now() - interval '24 hours'
      ORDER BY ph.recorded_at DESC
    `,
  ])

  const lastUpdate = await sql`SELECT MAX(updated_at) AS last FROM products`

  return {
    total: Number((totals[0] as { total: string }).total),
    active: Number((totals[0] as { active: string }).active),
    bySupplier: bySupplier as { supplier: string; count: string }[],
    recentChanges: recentChanges as { id: string; change_pct: number; recorded_at: string }[],
    lastUpdate: (lastUpdate[0] as { last: string | null }).last,
  }
}
