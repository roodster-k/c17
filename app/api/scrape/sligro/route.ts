/**
 * POST /api/scrape/sligro
 * Lance le scraping du catalogue Sligro.be
 *
 * Query params:
 *   ?categoryId=001   — scraper une seule catégorie (optionnel)
 *   ?maxProducts=100  — limite de produits par catégorie (défaut: 200)
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql, insertPriceHistory } from '@/lib/db'
import { loginSligro, getSligroCategories, scrapeCategory } from '@/lib/scrapers/sligro'
import { getPricingConfig } from '@/lib/pricing'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startTime = Date.now()
  const { searchParams } = new URL(req.url)
  const targetCategoryId = searchParams.get('categoryId')
  const maxProducts = parseInt(searchParams.get('maxProducts') ?? '200', 10)

  const logId = await startScrapingLog('sligro')
  let productsFound = 0
  let productsUpdated = 0
  const errors: string[] = []

  try {
    // 1. Login
    console.log('[Sligro] Login...')
    const { accessToken, houseId } = await loginSligro()
    console.log('[Sligro] ✓ Connecté')

    // 2. Get categories
    const allCategories = await getSligroCategories(accessToken)
    const categories = targetCategoryId
      ? allCategories.filter(c => c.id === targetCategoryId)
      : allCategories
    console.log(`[Sligro] ${categories.length} catégorie(s) à scraper`)

    // 3. Pricing config
    const pricingConfig = await getPricingConfig()
    const supplierConfig = await sql`
      SELECT frais_achat_pct FROM supplier_configs WHERE supplier = 'sligro' LIMIT 1
    `
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fraisAchatPct = parseFloat((supplierConfig[0] as any)?.frais_achat_pct ?? '10')

    // 4. Scrape each category
    for (const category of categories) {
      console.log(`[Sligro] Scraping catégorie [${category.id}] ${category.name}...`)

      try {
        const products = await scrapeCategory(accessToken, category, houseId, maxProducts)
        productsFound += products.length
        console.log(`[Sligro]   → ${products.length} produits trouvés`)

        for (const product of products) {
          try {
            const existing = await getProductBySligroCode(product.code)
            const buyPriceEur = product.priceEur

            // Calcul prix de vente
            let sellPriceCdf: number | null = null
            if (buyPriceEur !== null) {
              const fraisAchat = buyPriceEur * (fraisAchatPct / 100)
              const poids = 0.5
              const fret = poids * pricingConfig.fret_par_kg
              const totalEur = buyPriceEur + fraisAchat + fret
              sellPriceCdf = Math.round(totalEur * pricingConfig.taux_eur_cdf)
            }

            const upserted = await upsertSligroProduct({
              sligro_code: product.code,
              name: product.name,
              brand: product.brand,
              supplier: 'sligro',
              reference: product.code,
              category: product.categoryName,
              buy_price_eur: buyPriceEur,
              sell_price_cdf: sellPriceCdf,
              margin_pct: fraisAchatPct,
              content_description: product.contentDescription,
              source_url: product.sourceUrl,
              active: product.purchasable,
              image_url: product.imageUrl ?? null,
              poids_kg: product.poidsKg ?? null,
              unite: product.salesUnit || null,
            })

            // Price change detection
            if (existing && existing.buy_price_eur !== null && buyPriceEur !== null) {
              const changePct = Math.abs((buyPriceEur - existing.buy_price_eur) / existing.buy_price_eur) * 100
              if (changePct > 0.01) {
                await insertPriceHistory({
                  product_id: upserted.id,
                  old_price: existing.buy_price_eur,
                  new_price: buyPriceEur,
                  change_pct: Math.round(changePct * 100) / 100,
                })
                if (changePct >= pricingConfig.price_alert_threshold_pct) {
                  await sendPriceAlert(product.name, existing.buy_price_eur, buyPriceEur, changePct, 'sligro')
                }
              }
            }

            productsUpdated++
          } catch (productErr) {
            const msg = productErr instanceof Error ? productErr.message : String(productErr)
            errors.push(`[${product.code}] ${msg}`)
          }
        }
      } catch (catErr) {
        const msg = catErr instanceof Error ? catErr.message : String(catErr)
        errors.push(`[Cat ${category.id}] ${msg}`)
        console.error(`[Sligro] Erreur catégorie ${category.id}:`, msg)
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000)
    await finishScrapingLog(logId, 'success', productsFound, productsUpdated)
    console.log(`[Sligro] ✓ Terminé en ${duration}s`)

    return NextResponse.json({
      success: true,
      productsFound,
      productsUpdated,
      errors: errors.slice(0, 20),
      durationSeconds: duration,
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Sligro] Erreur critique:', msg)
    await finishScrapingLog(logId, 'error', productsFound, productsUpdated, msg)
    return NextResponse.json({ success: false, error: msg, productsFound, productsUpdated }, { status: 500 })
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return POST(req)
}

// ─── DB helpers ────────────────────────────────────────────

async function getProductBySligroCode(code: string) {
  const rows = await sql`SELECT id, buy_price_eur FROM products WHERE sligro_code = ${code} LIMIT 1`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (rows[0] as any) ?? null
}

async function upsertSligroProduct(data: {
  sligro_code: string; name: string; brand: string | null; supplier: string
  reference: string; category: string; buy_price_eur: number | null; sell_price_cdf: number | null
  margin_pct: number; content_description: string; source_url: string; active: boolean
  image_url: string | null; poids_kg: number | null; unite: string | null
}) {
  const rows = await sql`
    INSERT INTO products (
      sligro_code, name, brand, supplier, reference, category,
      buy_price_eur, sell_price_cdf, margin_pct,
      content_description, source_url, active,
      image_url, poids_kg, unite, updated_at
    ) VALUES (
      ${data.sligro_code}, ${data.name}, ${data.brand ?? null}, ${data.supplier},
      ${data.reference}, ${data.category},
      ${data.buy_price_eur}, ${data.sell_price_cdf}, ${data.margin_pct},
      ${data.content_description}, ${data.source_url}, ${data.active},
      ${data.image_url}, ${data.poids_kg}, ${data.unite}, now()
    )
    ON CONFLICT (sligro_code) DO UPDATE SET
      name                = EXCLUDED.name,
      brand               = EXCLUDED.brand,
      category            = EXCLUDED.category,
      buy_price_eur       = EXCLUDED.buy_price_eur,
      sell_price_cdf      = EXCLUDED.sell_price_cdf,
      content_description = EXCLUDED.content_description,
      source_url          = EXCLUDED.source_url,
      active              = EXCLUDED.active,
      image_url           = EXCLUDED.image_url,
      poids_kg            = COALESCE(EXCLUDED.poids_kg, products.poids_kg),
      unite               = COALESCE(EXCLUDED.unite, products.unite),
      updated_at          = now()
    RETURNING id, buy_price_eur
  `
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows[0] as any
}

async function startScrapingLog(supplier: string): Promise<string> {
  const rows = await sql`
    INSERT INTO scraping_logs (supplier, status, started_at)
    VALUES (${supplier}, 'running', now()) RETURNING id
  `
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (rows[0] as any).id
}

async function finishScrapingLog(id: string, status: string, found: number, updated: number, error?: string) {
  await sql`
    UPDATE scraping_logs
    SET status = ${status}, products_found = ${found}, products_updated = ${updated},
        error = ${error ?? null}, finished_at = now()
    WHERE id = ${id}
  `
}

async function sendPriceAlert(name: string, oldPrice: number, newPrice: number, changePct: number, supplier: string) {
  if (!process.env.RESEND_API_KEY || !process.env.ALERT_EMAIL) return
  const resend = new Resend(process.env.RESEND_API_KEY)
  const direction = newPrice > oldPrice ? '🔴 hausse' : '🟢 baisse'
  try {
    await resend.emails.send({
      from: 'C17 Alerts <alerts@c17.pro>',
      to: process.env.ALERT_EMAIL,
      subject: `Alerte prix ${supplier}: ${name} ${direction} ${changePct.toFixed(1)}%`,
      html: `<p><b>${name}</b> chez <b>${supplier}</b></p><p>Ancien: €${oldPrice.toFixed(2)} → Nouveau: €${newPrice.toFixed(2)}</p><p>Variation: <b>${direction} ${changePct.toFixed(1)}%</b></p>`,
    })
  } catch {}
}
