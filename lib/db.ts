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

/**
 * Upsert un produit par (supplier, reference).
 * Retourne l'id du produit + l'ancien prix (null si nouveau produit).
 */
export async function upsertProductByRef(data: {
  name: string
  supplier: string
  reference: string
  category: string | null
  buy_price_eur: number | null
  sell_price_cdf: number | null
  margin_pct: number
  image_url: string | null
  source_url: string | null
  active: boolean
  brand?: string | null
  content_description?: string | null
  poids_kg?: number | null
  unite?: string | null
}): Promise<{ id: string; previousBuyPriceEur: number | null; isNew: boolean }> {
  // Lookup by supplier + reference (no unique constraint, so we do SELECT first)
  const existing = await sql`
    SELECT id, buy_price_eur FROM products
    WHERE supplier = ${data.supplier} AND reference = ${data.reference}
    LIMIT 1
  `

  const brand = data.brand ?? null
  const contentDescription = data.content_description ?? null
  const poidsKg = data.poids_kg ?? null
  const unite = data.unite ?? null

  if (existing.length > 0) {
    const row = existing[0] as { id: string; buy_price_eur: number | null }
    await sql`
      UPDATE products SET
        name                = ${data.name},
        category            = ${data.category},
        buy_price_eur       = ${data.buy_price_eur},
        sell_price_cdf      = ${data.sell_price_cdf},
        margin_pct          = ${data.margin_pct},
        image_url           = ${data.image_url},
        source_url          = ${data.source_url},
        active              = ${data.active},
        brand               = COALESCE(${brand}, brand),
        content_description = COALESCE(${contentDescription}, content_description),
        poids_kg            = COALESCE(${poidsKg}, poids_kg),
        unite               = COALESCE(${unite}, unite),
        updated_at          = now()
      WHERE id = ${row.id}
    `
    return { id: row.id, previousBuyPriceEur: row.buy_price_eur, isNew: false }
  }

  const rows = await sql`
    INSERT INTO products (
      name, supplier, reference, category,
      buy_price_eur, sell_price_cdf, margin_pct,
      image_url, source_url, active,
      brand, content_description, poids_kg, unite,
      updated_at
    ) VALUES (
      ${data.name}, ${data.supplier}, ${data.reference}, ${data.category},
      ${data.buy_price_eur}, ${data.sell_price_cdf}, ${data.margin_pct},
      ${data.image_url}, ${data.source_url}, ${data.active},
      ${brand}, ${contentDescription}, ${poidsKg}, ${unite},
      now()
    )
    RETURNING id
  `
  return { id: (rows[0] as { id: string }).id, previousBuyPriceEur: null, isNew: true }
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

// ─── Product Groups ──────────────────────────────────────────

// Normalise un nom pour la comparaison : minuscules, sans accents ni ponctuation
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function findOrCreateGroup(name: string, category: string | null): Promise<string> {
  const normalized = normalizeName(name)

  // Recherche d'un groupe existant par premier mot significatif
  const firstWord = normalized.split(' ').find(w => w.length > 3) ?? normalized.split(' ')[0]
  const existing = await query<{ id: string; canonical_name: string }>(`
    SELECT id, canonical_name
    FROM product_groups
    WHERE lower(canonical_name) LIKE $1
    LIMIT 10
  `, [`%${firstWord}%`])

  const wordsA = new Set(normalized.split(' ').filter(w => w.length > 3))
  for (const candidate of existing) {
    const existingNorm = normalizeName(candidate.canonical_name)
    const wordsB = new Set(existingNorm.split(' ').filter(w => w.length > 3))
    const intersection = [...wordsA].filter(w => wordsB.has(w))
    const score = wordsA.size > 0 ? intersection.length / wordsA.size : 0
    if (score >= 0.6) return candidate.id
  }

  // Aucun groupe trouvé → on en crée un
  const created = await query<{ id: string }>(`
    INSERT INTO product_groups (canonical_name, category)
    VALUES ($1, $2)
    RETURNING id
  `, [name, category])

  return created[0].id
}

export async function linkProductToGroup(productId: string, groupId: string): Promise<void> {
  await query(`UPDATE products SET group_id = $1 WHERE id = $2`, [groupId, productId])
}

export async function mergeGroups(keepGroupId: string, deleteGroupId: string): Promise<void> {
  await query(`UPDATE products SET group_id = $1 WHERE group_id = $2`, [keepGroupId, deleteGroupId])
  await query(`DELETE FROM product_groups WHERE id = $1`, [deleteGroupId])
}

export async function unlinkProductFromGroup(productId: string): Promise<void> {
  await query(`UPDATE products SET group_id = NULL WHERE id = $1`, [productId])
}

// Données pour la page comparaison :
// Retourne les groupes avec leurs produits par fournisseur
export async function getComparisonData(filters?: {
  category?: string
  minSuppliers?: number
}): Promise<{
  groupId: string
  canonicalName: string
  category: string | null
  suppliers: Record<string, { productId: string; name: string; buyPriceEur: number | null; active: boolean }>
}[]> {
  const { category, minSuppliers = 2 } = filters ?? {}

  let q = `
    SELECT
      pg.id          AS group_id,
      pg.canonical_name,
      pg.category,
      p.id           AS product_id,
      p.name         AS product_name,
      p.supplier,
      p.buy_price_eur,
      p.active
    FROM product_groups pg
    JOIN products p ON p.group_id = pg.id
    WHERE p.supplier IS NOT NULL
  `
  const params: unknown[] = []
  let i = 1

  if (category) { q += ` AND pg.category = $${i++}`; params.push(category) }

  q += ` ORDER BY pg.canonical_name, p.supplier`

  const rows = await query<{
    group_id: string
    canonical_name: string
    category: string | null
    product_id: string
    product_name: string
    supplier: string
    buy_price_eur: number | null
    active: boolean
  }>(q, params)

  // Regroupement par group_id
  const groupMap = new Map<string, {
    groupId: string
    canonicalName: string
    category: string | null
    suppliers: Record<string, { productId: string; name: string; buyPriceEur: number | null; active: boolean }>
  }>()

  for (const row of rows) {
    if (!groupMap.has(row.group_id)) {
      groupMap.set(row.group_id, {
        groupId: row.group_id,
        canonicalName: row.canonical_name,
        category: row.category,
        suppliers: {},
      })
    }
    groupMap.get(row.group_id)!.suppliers[row.supplier] = {
      productId: row.product_id,
      name: row.product_name,
      buyPriceEur: row.buy_price_eur,
      active: row.active,
    }
  }

  // Filtre : uniquement les groupes avec ≥ minSuppliers fournisseurs
  return [...groupMap.values()].filter(g => Object.keys(g.suppliers).length >= minSuppliers)
}

export async function getComparisonCategories(): Promise<string[]> {
  const rows = await sql`
    SELECT DISTINCT category FROM product_groups
    WHERE category IS NOT NULL ORDER BY category
  `
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (rows as any[]).map((r) => r.category as string)
}

export async function getAllGroups(): Promise<{ id: string; canonical_name: string; category: string | null; product_count: number }[]> {
  return query<{ id: string; canonical_name: string; category: string | null; product_count: number }>(`
    SELECT pg.id, pg.canonical_name, pg.category, COUNT(p.id)::int AS product_count
    FROM product_groups pg
    LEFT JOIN products p ON p.group_id = pg.id
    GROUP BY pg.id, pg.canonical_name, pg.category
    ORDER BY pg.canonical_name
  `)
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
