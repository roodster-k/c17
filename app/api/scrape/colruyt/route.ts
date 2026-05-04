import { NextResponse } from 'next/server'
import { extractProductsWithAI } from '@/lib/ai'
import { sql, upsertProductByRef, insertPriceHistory } from '@/lib/db'
import { getPricingConfig } from '@/lib/pricing'
import { fetchWithRetry } from '@/utils/scraping'
import { Resend } from 'resend'

const COLRUYT_BASE_URL = 'https://www.colruyt.be'

// On utilise le catalogue général paginé au lieu de catégories fixes
// ?page=N retourne ~24 produits par page
const MAX_PRODUCTS = 50

export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<NextResponse> {
  const startTime = Date.now()
  const { searchParams } = new URL(req.url)
  const maxProducts = parseInt(searchParams.get('maxProducts') ?? String(MAX_PRODUCTS), 10)

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

    const pagesToFetch = Math.ceil(maxProducts / 24) + 1

    for (let page = 1; page <= pagesToFetch && productsUpdated < maxProducts; page++) {
      const url = `${COLRUYT_BASE_URL}/fr/produits?page=${page}`
      console.log(`[Colruyt] Fetching page ${page}...`)

      let html: string
      try {
        const res = await fetchWithRetry(url)
        html = await res.text()
      } catch (err) {
        errors.push(`Fetch page ${page}: ${err instanceof Error ? err.message : String(err)}`)
        continue
      }

      let products
      try {
        products = await extractProductsWithAI(html, 'Colruyt', COLRUYT_BASE_URL)
      } catch (err) {
        errors.push(`AI page ${page}: ${err instanceof Error ? err.message : String(err)}`)
        continue
      }

      console.log(`[Colruyt] Page ${page}: ${products.length} produits extraits par Gemini`)
      productsFound += products.length

      for (const product of products) {
        if (productsUpdated >= maxProducts) break
        try {
          if (!product.nom || !product.reference) continue

          const buyPriceEur: number | null = product.prix_eur > 0 ? product.prix_eur : null
          let sellPriceCdf: number | null = null
          const poidsKg = product.poids_kg ?? 0.5  // défaut 0.5kg si inconnu

          if (buyPriceEur !== null) {
            const fraisAchat = buyPriceEur * (fraisAchatPct / 100)
            const fret = poidsKg * pricingConfig.fret_par_kg
            const totalEur = buyPriceEur + fraisAchat + fret
            sellPriceCdf = Math.round(totalEur * pricingConfig.taux_eur_cdf)
          }

          const { id, previousBuyPriceEur, isNew } = await upsertProductByRef({
            name: product.nom,
            supplier: 'colruyt',
            reference: product.reference,
            category: product.categorie || null,
            buy_price_eur: buyPriceEur,
            sell_price_cdf: sellPriceCdf,
            margin_pct: fraisAchatPct,
            image_url: product.url_image || null,
            source_url: product.url_source || url,
            active: true,
            brand: product.brand || null,
            content_description: product.content_description || null,
            poids_kg: product.poids_kg ?? null,
            unite: product.unite || null,
          })

          // Détection variation de prix
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
                await sendPriceAlert(product.nom, previousBuyPriceEur, buyPriceEur, changePct, 'colruyt')
              }
            }
          }

          productsUpdated++
        } catch (err) {
          errors.push(`[${product.reference}] ${err instanceof Error ? err.message : String(err)}`)
        }
      }
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
