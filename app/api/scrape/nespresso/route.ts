import { NextResponse } from 'next/server'
import { extractProductsWithAI } from '@/lib/ai'
import { sql, upsertProductByRef, insertPriceHistory } from '@/lib/db'
import { getPricingConfig } from '@/lib/pricing'
import { fetchWithRetry } from '@/utils/scraping'
import { Resend } from 'resend'

const NESPRESSO_BASE_URL = 'https://www.nespresso.com'
const NESPRESSO_API_BASE = 'https://www.nespresso.com/api'

export const dynamic = 'force-dynamic'

interface NespressoProduct {
  name?: string
  title?: string
  sku?: string
  code?: string
  price?: { value?: number; formattedValue?: string }
  images?: Array<{ url?: string }>
  url?: string
  categories?: Array<{ name?: string }>
}

async function loginNespresso(): Promise<string> {
  const email = process.env.NESPRESSO_EMAIL
  const password = process.env.NESPRESSO_PASSWORD
  if (!email || !password) throw new Error('NESPRESSO_EMAIL et NESPRESSO_PASSWORD manquants')

  const loginRes = await fetch(`${NESPRESSO_API_BASE}/v2/users/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({ username: email, password }),
  })

  if (!loginRes.ok) {
    // Fallback endpoint hybris
    const fallbackRes = await fetch(`${NESPRESSO_BASE_URL}/fr/fr/rest/v2/nespresso/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password, rememberMe: false }),
    })
    if (!fallbackRes.ok) throw new Error(`Nespresso login échoué : HTTP ${fallbackRes.status}`)
    const fallbackData = await fallbackRes.json() as { access_token?: string; token?: string }
    const token = fallbackData.access_token ?? fallbackData.token
    if (!token) throw new Error('Nespresso : token introuvable dans la réponse login')
    return token
  }

  const data = await loginRes.json() as { access_token?: string; token?: string }
  const token = data.access_token ?? data.token
  if (!token) throw new Error('Nespresso : token introuvable dans la réponse login')
  return token
}

async function fetchNespressoCatalogApi(token: string): Promise<NespressoProduct[]> {
  const res = await fetchWithRetry(
    `${NESPRESSO_BASE_URL}/fr/fr/rest/v2/nespresso/products/search?query=:relevance&pageSize=100`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
  )
  const data = await res.json() as { products?: NespressoProduct[]; results?: NespressoProduct[] }
  return data.products ?? data.results ?? []
}

async function fetchNespressoCatalogHtml(token: string): Promise<NespressoProduct[]> {
  const res = await fetchWithRetry(`${NESPRESSO_BASE_URL}/fr/fr/coffee`, {
    headers: { Authorization: `Bearer ${token}`, Cookie: `access_token=${token}` },
  })
  const html = await res.text()
  const products = await extractProductsWithAI(html, 'Nespresso', NESPRESSO_BASE_URL)
  return products.map(p => ({
    name: p.nom,
    sku: p.reference,
    price: { value: p.prix_eur },
    images: p.url_image ? [{ url: p.url_image }] : [],
    url: p.url_source,
    categories: p.categorie ? [{ name: p.categorie }] : [],
  }))
}

export async function GET(): Promise<NextResponse> {
  const startTime = Date.now()
  const logId = await startScrapingLog('nespresso')
  let productsFound = 0
  let productsUpdated = 0
  const errors: string[] = []

  try {
    const pricingConfig = await getPricingConfig()
    const supplierConfig = await sql`
      SELECT frais_achat_pct FROM supplier_configs WHERE supplier = 'nespresso' LIMIT 1
    `
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fraisAchatPct = parseFloat((supplierConfig[0] as any)?.frais_achat_pct ?? '10')

    // Authentification
    let token: string
    try {
      token = await loginNespresso()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await finishScrapingLog(logId, 'error', 0, 0, `Auth échouée : ${msg}`)
      return NextResponse.json({ success: false, error: `Auth échouée : ${msg}` }, { status: 500 })
    }

    // Catalogue
    let products: NespressoProduct[] = []
    try {
      products = await fetchNespressoCatalogApi(token)
    } catch {
      console.warn('[Nespresso] API JSON échouée, passage au scraping HTML')
      try {
        products = await fetchNespressoCatalogHtml(token)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await finishScrapingLog(logId, 'error', 0, 0, msg)
        return NextResponse.json({ success: false, error: msg }, { status: 500 })
      }
    }

    productsFound = products.length

    for (const product of products) {
      try {
        const nom = product.name ?? product.title ?? ''
        const reference = product.sku ?? product.code ?? ''
        if (!nom || !reference) continue

        const buyPriceEur: number | null = product.price?.value ?? null
        let sellPriceCdf: number | null = null

        if (buyPriceEur !== null) {
          const totalEur = buyPriceEur * (1 + fraisAchatPct / 100) + 0.5 * pricingConfig.fret_par_kg
          sellPriceCdf = Math.round(totalEur * pricingConfig.taux_eur_cdf)
        }

        const sourceUrl = product.url ? `${NESPRESSO_BASE_URL}${product.url}` : NESPRESSO_BASE_URL

        const { id, previousBuyPriceEur, isNew } = await upsertProductByRef({
          name: nom,
          supplier: 'nespresso',
          reference,
          category: product.categories?.[0]?.name ?? 'Café',
          buy_price_eur: buyPriceEur,
          sell_price_cdf: sellPriceCdf,
          margin_pct: fraisAchatPct,
          image_url: product.images?.[0]?.url ?? null,
          source_url: sourceUrl,
          active: true,
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
              await sendPriceAlert(nom, previousBuyPriceEur, buyPriceEur, changePct, 'nespresso')
            }
          }
        }

        productsUpdated++
      } catch (err) {
        errors.push(`[${product.sku ?? product.code}] ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000)
    await finishScrapingLog(logId, 'success', productsFound, productsUpdated)
    console.log(`[Nespresso] ✓ Terminé en ${duration}s — ${productsFound} trouvés, ${productsUpdated} mis à jour`)

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
    console.error('[Nespresso] Erreur critique:', msg)
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
