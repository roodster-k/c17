import { NextResponse } from 'next/server'
import { extractProductsWithAI } from '@/lib/ai'
import { findProductByReference, upsertProduct } from '@/lib/airtable'
import { fetchWithRetry } from '@/utils/scraping'
import type { ScrapingLog } from '@/types/database'

const SLIGRO_BASE_URL = 'https://www.sligro.nl'
const SLIGRO_LOGIN_URL = 'https://www.sligro.nl/login'

// Catégories Sligro à scraper
const SLIGRO_CATEGORIES = [
  '/assortiment/dranken',
  '/assortiment/kruidenierswaren',
  '/assortiment/zuivel-eieren-boter',
  '/assortiment/diepvries',
  '/assortiment/snacks-koek-chips',
]

async function loginSligro(): Promise<string> {
  const email = process.env.SLIGRO_EMAIL
  const password = process.env.SLIGRO_PASSWORD

  if (!email || !password) {
    throw new Error('SLIGRO_EMAIL et SLIGRO_PASSWORD manquants dans .env.local')
  }

  // Récupération du token CSRF depuis la page de login
  const loginPageRes = await fetchWithRetry(SLIGRO_LOGIN_URL)
  const loginPageHtml = await loginPageRes.text()

  // Extraction du token CSRF (hidden input)
  const csrfMatch = loginPageHtml.match(/name="_token"\s+value="([^"]+)"/)
  const csrfToken = csrfMatch?.[1] ?? ''

  // Récupération des cookies initiaux
  const initialCookies = loginPageRes.headers.get('set-cookie') ?? ''

  // POST de connexion
  const loginRes = await fetch(SLIGRO_LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: initialCookies,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      Referer: SLIGRO_LOGIN_URL,
    },
    body: new URLSearchParams({
      _token: csrfToken,
      email,
      password,
    }).toString(),
    redirect: 'manual',
  })

  const sessionCookie = loginRes.headers.get('set-cookie')
  if (!sessionCookie) {
    throw new Error('Sligro : échec de connexion — aucun cookie de session reçu')
  }

  // Extrait uniquement la valeur du cookie de session
  const sessionMatch = sessionCookie.match(/sligro_session=[^;]+/)
  if (!sessionMatch) {
    throw new Error('Sligro : cookie de session introuvable dans la réponse')
  }

  return sessionMatch[0]
}

export async function GET(): Promise<NextResponse> {
  const log: ScrapingLog = {
    supplier: 'sligro',
    status: 'running',
    productsFound: 0,
    productsUpdated: 0,
    startedAt: new Date().toISOString(),
  }

  try {
    // Authentification
    let sessionCookie: string
    try {
      sessionCookie = await loginSligro()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.status = 'error'
      log.error = `Authentification Sligro échouée : ${message}`
      log.finishedAt = new Date().toISOString()
      return NextResponse.json({ success: false, log }, { status: 500 })
    }

    let totalFound = 0
    let totalUpdated = 0

    for (const categoryPath of SLIGRO_CATEGORIES) {
      const url = `${SLIGRO_BASE_URL}${categoryPath}`
      let page = 1

      // Parcours de toutes les pages de la catégorie
      while (true) {
        const pageUrl = page === 1 ? url : `${url}?page=${page}`

        let html: string
        try {
          const res = await fetchWithRetry(pageUrl, {
            headers: { Cookie: sessionCookie },
          })
          html = await res.text()

          // Si la page redirige vers le login → session expirée
          if (html.includes('login') && html.includes('password')) {
            throw new Error('Session Sligro expirée pendant le scraping')
          }
        } catch (err) {
          console.error(`[Sligro] Erreur fetch ${pageUrl}:`, err)
          break
        }

        // Extraction via Claude API
        let products
        try {
          products = await extractProductsWithAI(html, 'Sligro', SLIGRO_BASE_URL)
        } catch (err) {
          console.error(`[Sligro] Erreur Claude pour ${pageUrl}:`, err)
          break
        }

        if (products.length === 0) break // Plus de produits → fin de pagination

        totalFound += products.length

        for (const product of products) {
          try {
            if (!product.nom || !product.reference) continue

            const existing = await findProductByReference(product.reference, 'Sligro')

            let imageAttachment: Array<{ url: string }> | undefined
            if (product.url_image) {
              imageAttachment = [{ url: product.url_image }]
            }

            await upsertProduct(
              {
                Nom: product.nom,
                Fournisseur: 'Sligro',
                Reference: product.reference,
                Prix_Achat_EUR: product.prix_eur,
                Categorie: product.categorie,
                URL_Source: product.url_source || pageUrl,
                Derniere_MAJ: new Date().toISOString().split('T')[0],
                ...(imageAttachment ? { Image: imageAttachment } : {}),
              },
              existing?.id
            )

            totalUpdated++
          } catch (err) {
            console.error(`[Sligro] Erreur upsert ${product.reference}:`, err)
          }
        }

        // Vérifie s'il existe une page suivante
        const hasNextPage = html.includes(`page=${page + 1}`) || html.includes('rel="next"')
        if (!hasNextPage) break
        page++
      }
    }

    log.status = 'success'
    log.productsFound = totalFound
    log.productsUpdated = totalUpdated
    log.finishedAt = new Date().toISOString()

    return NextResponse.json({ success: true, log })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.status = 'error'
    log.error = message
    log.finishedAt = new Date().toISOString()

    console.error('[Sligro] Erreur critique:', message)
    return NextResponse.json({ success: false, log }, { status: 500 })
  }
}
