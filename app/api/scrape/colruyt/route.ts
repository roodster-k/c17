/**
 * GET /api/scrape/colruyt
 *
 * Scraper Colruyt.be utilisant l'API interne officielle (découverte par analyse réseau).
 * API endpoint : apip.colruyt.be/gateway/ictmgmt.emarkecom.cgproductretrsvc.v2/v2/v2/fr/products
 * Clé API : extraite du HTML global vars → X-CG-APIKey
 *
 * La clé API est publique (intégrée dans le JS du site) et requiert Origin: https://www.colruyt.be
 *
 * Query params:
 *   ?maxProducts=50   — limite de produits (défaut: 50)
 *   ?page=1           — page de départ (défaut: 1)
 */

import { NextResponse } from 'next/server'
import { sql, upsertProductByRef, insertPriceHistory } from '@/lib/db'
import { getPricingConfig } from '@/lib/pricing'
import { parsePoidsKg } from '@/lib/scrapers/sligro'
import { Resend } from 'resend'

const COLRUYT_API_KEY = 'a8ylmv13-b285-4788-9e14-0f79b7ed2411'
const COLRUYT_API_BASE = 'https://apip.colruyt.be/gateway/ictmgmt.emarkecom.cgproductretrsvc.v2/v2/v2/fr'
const COLRUYT_IMAGE_BASE = 'https://static.colruytgroup.com/images/500x500'
const PAGE_SIZE = 24

const COLRUYT_HEADERS = {
  'X-CG-APIKey': COLRUYT_API_KEY,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'fr-BE,fr;q=0.9,en;q=0.8',
  'Origin': 'https://www.colruyt.be',
  'Referer': 'https://www.colruyt.be/fr/produits',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
}

interface ColruytApiProduct {
  productId: string
  technicalArticleNumber: string
  name: string
  brand: string
  thumbNail: string
  fullImage: string
  content: string          // ex: "500g", "1L", "6x33cl"
  topCategoryName: string
  topCategoryId: string
  amount: number           // poids/volume numérique
  amountUnit: string       // "kg", "l", etc.
  OrderUnit: string        // "P" = pièce, "K" = kilo...
  LongName: string
  IsBio: boolean
  nutriscoreLabel?: string
}

export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<NextResponse> {
  const startTime = Date.now()
  const { searchParams } = new URL(req.url)
  const maxProducts = parseInt(searchParams.get('maxProducts') ?? '50', 10)
  const startPage = parseInt(searchParams.get('page') ?? '1', 10)

  const logId = await startScrapingLog('colruyt')
  let productsFound = 0
  let productsUpdated = 0
  const errors: string[] = []

  try {
    const pricingConfig = await getPricingConfig()
    const supplierConfig = await sql`
      SELECT frais_achat_pct FROM supplier_configs WHERE supplier = 'colruyt' LIMIT 1
    `
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fraisAchatPct = parseFloat((supplierConfig[0] as any)?.frais_achat_pct ?? '10')

    let page = startPage

    while (productsUpdated < maxProducts) {
      const url = `${COLRUYT_API_BASE}/products?page=${page}&size=${PAGE_SIZE}&clientCode=CLP`
      console.log(`[Colruyt] Fetching page ${page} (${productsUpdated}/${maxProducts} products)...`)

      let apiData: { productsFound: number; products: ColruytApiProduct[] }
      try {
        const res = await fetch(url, { headers: COLRUYT_HEADERS })
        if (!res.ok) {
          const body = await res.text()
          errors.push(`API page ${page}: HTTP ${res.status} — ${body.slice(0, 200)}`)
          break
        }
        apiData = await res.json()
      } catch (err) {
        errors.push(`Fetch page ${page}: ${err instanceof Error ? err.message : String(err)}`)
        break
      }

      const pageProducts = apiData.products ?? []
      if (pageProducts.length === 0) break

      console.log(`[Colruyt] Page ${page}: ${pageProducts.length} produits`)
      productsFound += pageProducts.length

      for (const product of pageProducts) {
        if (productsUpdated >= maxProducts) break
        try {
          const reference = product.technicalArticleNumber || product.productId
          if (!product.name || !reference) continue

          // Calcul poids en kg
          const poidsKg = product.amount && product.amountUnit
            ? convertToKg(product.amount, product.amountUnit)
            : parsePoidsKg(product.content ?? '')

          // Prix non disponible sans auth → null (calculé lors de la mise à jour manuelle)
          const buyPriceEur: number | null = null
          const sellPriceCdf: number | null = null

          // Image : préférer fullImage (500x500), sinon thumbNail
          const imageUrl = product.fullImage || product.thumbNail || null

          // Unité de vente
          const unite = product.OrderUnit === 'K' ? 'kg'
            : product.OrderUnit === 'P' ? 'pièce'
            : product.OrderUnit || null

          const { id, previousBuyPriceEur, isNew } = await upsertProductByRef({
            name: product.LongName || product.name,
            supplier: 'colruyt',
            reference,
            category: product.topCategoryName || null,
            buy_price_eur: buyPriceEur,
            sell_price_cdf: sellPriceCdf,
            margin_pct: fraisAchatPct,
            image_url: imageUrl,
            source_url: `https://www.colruyt.be/fr/produits/${reference}`,
            active: true,
            brand: product.brand || null,
            content_description: product.content || null,
            poids_kg: poidsKg,
            unite,
          })

          // Détection variation de prix (si prix disponible)
          if (!isNew && previousBuyPriceEur !== null && buyPriceEur !== null) {
            const changePct = Math.abs((buyPriceEur - previousBuyPriceEur) / previousBuyPriceEur) * 100
            if (changePct > 0.01) {
              await insertPriceHistory({
                product_id: id,
                old_price: previousBuyPriceEur,
                new_price: buyPriceEur,
                change_pct: Math.round(changePct * 100) / 100,
              })
              if (changePct >= pricingConfig.price_alert_threshold_pct) {
                await sendPriceAlert(product.name, previousBuyPriceEur, buyPriceEur, changePct, 'colruyt')
              }
            }
          }

          productsUpdated++
        } catch (err) {
          errors.push(`[${product.productId}] ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // Stop if fewer products than page size (last page)
      if (pageProducts.length < PAGE_SIZE) break
      page++
    }

    const duration = Math.round((Date.now() - startTime) / 1000)
    await finishScrapingLog(logId, 'success', productsFound, productsUpdated)
    console.log(`[Colruyt] ✓ Terminé en ${duration}s — ${productsFound} trouvés, ${productsUpdated} mis à jour`)

    return NextResponse.json({
      success: true,
      productsFound,
      productsUpdated,
      errors: errors.slice(0, 20),
      durationSeconds: duration,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await finishScrapingLog(logId, 'error', productsFound, productsUpdated, msg)
    console.error('[Colruyt] Erreur critique:', msg)
    return NextResponse.json({ success: false, error: msg, productsFound, productsUpdated }, { status: 500 })
  }
}

// ─── Helpers ───────────────────────────────────────────────

function convertToKg(amount: number, unit: string): number | null {
  const u = (unit ?? '').toLowerCase()
  if (u === 'kg' || u === 'k') return amount
  if (u === 'g') return amount / 1000
  if (u === 'l' || u === 'liter' || u === 'litre') return amount  // L ≈ kg pour l'eau
  if (u === 'cl') return amount / 100
  if (u === 'ml') return amount / 1000
  return null
}

// ─── DB helpers ────────────────────────────────────────────

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
  } catch { /* alertes non critiques */ }
}
