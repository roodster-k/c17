import { NextResponse } from 'next/server'
import { findProductByReference, upsertProduct } from '@/lib/airtable'
import { extractProductsWithAI } from '@/lib/ai'
import { fetchWithRetry } from '@/utils/scraping'
import type { ScrapingLog } from '@/types/database'

const NESPRESSO_BASE_URL = 'https://www.nespresso.com'
const NESPRESSO_API_BASE = 'https://www.nespresso.com/api'

interface NespressoLoginResponse {
  access_token?: string
  token?: string
  sessionId?: string
}

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

  if (!email || !password) {
    throw new Error('NESPRESSO_EMAIL et NESPRESSO_PASSWORD manquants dans .env.local')
  }

  // Tentative d'authentification via l'API Nespresso B2B
  const loginRes = await fetch(`${NESPRESSO_API_BASE}/v2/users/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({ username: email, password }),
  })

  if (!loginRes.ok) {
    // Fallback : essai avec l'endpoint hybris standard
    const fallbackRes = await fetch(
      `${NESPRESSO_BASE_URL}/fr/fr/rest/v2/nespresso/users/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: email, password, rememberMe: false }),
      }
    )

    if (!fallbackRes.ok) {
      throw new Error(`Nespresso login échoué : HTTP ${fallbackRes.status}`)
    }

    const fallbackData: NespressoLoginResponse = await fallbackRes.json()
    const token = fallbackData.access_token ?? fallbackData.token
    if (!token) throw new Error('Nespresso : token introuvable dans la réponse login')
    return token
  }

  const data: NespressoLoginResponse = await loginRes.json()
  const token = data.access_token ?? data.token
  if (!token) throw new Error('Nespresso : token introuvable dans la réponse login')
  return token
}

// Essaie d'intercepter l'API JSON interne de Nespresso (méthode privilégiée)
async function fetchNespressoCatalogApi(token: string): Promise<NespressoProduct[]> {
  const catalogRes = await fetchWithRetry(
    `${NESPRESSO_BASE_URL}/fr/fr/rest/v2/nespresso/products/search?query=:relevance&pageSize=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    }
  )

  const data = await catalogRes.json()
  return data.products ?? data.results ?? []
}

// Fallback : scraping HTML + Claude si l'API JSON échoue
async function fetchNespressoCatalogHtml(token: string): Promise<NespressoProduct[]> {
  const res = await fetchWithRetry(`${NESPRESSO_BASE_URL}/fr/fr/coffee`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Cookie: `access_token=${token}`,
    },
  })

  const html = await res.text()
  const products = await extractProductsWithAI(html, 'Nespresso', NESPRESSO_BASE_URL)

  return products.map((p) => ({
    name: p.nom,
    sku: p.reference,
    price: { value: p.prix_eur },
    images: p.url_image ? [{ url: p.url_image }] : [],
    url: p.url_source,
    categories: p.categorie ? [{ name: p.categorie }] : [],
  }))
}

export async function GET(): Promise<NextResponse> {
  const log: ScrapingLog = {
    supplier: 'nespresso',
    status: 'running',
    productsFound: 0,
    productsUpdated: 0,
    startedAt: new Date().toISOString(),
  }

  try {
    // Authentification
    let token: string
    try {
      token = await loginNespresso()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.status = 'error'
      log.error = `Authentification Nespresso échouée : ${message}`
      log.finishedAt = new Date().toISOString()
      return NextResponse.json({ success: false, log }, { status: 500 })
    }

    // Récupération du catalogue
    let products: NespressoProduct[] = []
    try {
      products = await fetchNespressoCatalogApi(token)
    } catch {
      console.warn('[Nespresso] API JSON échouée, passage au scraping HTML')
      try {
        products = await fetchNespressoCatalogHtml(token)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.status = 'error'
        log.error = `Récupération catalogue Nespresso échouée : ${message}`
        log.finishedAt = new Date().toISOString()
        return NextResponse.json({ success: false, log }, { status: 500 })
      }
    }

    log.productsFound = products.length
    let totalUpdated = 0

    for (const product of products) {
      try {
        const nom = product.name ?? product.title ?? ''
        const reference = product.sku ?? product.code ?? ''
        const prix = product.price?.value ?? 0
        const categorie = product.categories?.[0]?.name ?? 'Café'
        const imageUrl = product.images?.[0]?.url ?? ''
        const sourceUrl = product.url
          ? `${NESPRESSO_BASE_URL}${product.url}`
          : NESPRESSO_BASE_URL

        if (!nom || !reference) continue

        const existing = await findProductByReference(reference, 'Nespresso')

        await upsertProduct(
          {
            Nom: nom,
            Fournisseur: 'Nespresso',
            Reference: reference,
            Prix_Achat_EUR: prix,
            Categorie: categorie,
            URL_Source: sourceUrl,
            Derniere_MAJ: new Date().toISOString().split('T')[0],
            ...(imageUrl ? { Image: [{ url: imageUrl }] } : {}),
          },
          existing?.id
        )

        totalUpdated++
      } catch (err) {
        console.error(`[Nespresso] Erreur upsert ${product.sku}:`, err)
      }
    }

    log.status = 'success'
    log.productsUpdated = totalUpdated
    log.finishedAt = new Date().toISOString()

    return NextResponse.json({ success: true, log })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.status = 'error'
    log.error = message
    log.finishedAt = new Date().toISOString()

    console.error('[Nespresso] Erreur critique:', message)
    return NextResponse.json({ success: false, log }, { status: 500 })
  }
}
