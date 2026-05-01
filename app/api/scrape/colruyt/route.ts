import { NextResponse } from 'next/server'
import { extractProductsWithAI } from '@/lib/ai'
import { findProductByReference, upsertProduct } from '@/lib/airtable'
import { fetchWithRetry, downloadImage, getImageFilename } from '@/utils/scraping'
import type { ScrapingLog } from '@/types/database'

const COLRUYT_BASE_URL = 'https://www.colruyt.be'

// URLs des catégories Colruyt pertinentes pour le projet Congo
const COLRUYT_CATEGORIES = [
  '/fr/alimentation/boissons',
  '/fr/alimentation/epicerie',
  '/fr/alimentation/produits-frais',
  '/fr/alimentation/surgelés',
]

export async function GET(): Promise<NextResponse> {
  const log: ScrapingLog = {
    supplier: 'colruyt',
    status: 'running',
    productsFound: 0,
    productsUpdated: 0,
    startedAt: new Date().toISOString(),
  }

  try {
    let totalFound = 0
    let totalUpdated = 0

    for (const categoryPath of COLRUYT_CATEGORIES) {
      const url = `${COLRUYT_BASE_URL}${categoryPath}`

      let html: string
      try {
        const res = await fetchWithRetry(url)
        html = await res.text()
      } catch (err) {
        console.error(`[Colruyt] Erreur fetch ${url}:`, err)
        continue
      }

      // Extraction des produits via Claude API
      let products
      try {
        products = await extractProductsWithAI(html, 'Colruyt', COLRUYT_BASE_URL)
      } catch (err) {
        console.error(`[Colruyt] Erreur Claude pour ${categoryPath}:`, err)
        continue
      }

      totalFound += products.length

      // Écriture dans Airtable
      for (const product of products) {
        try {
          if (!product.nom || !product.reference) continue

          const existing = await findProductByReference(product.reference, 'Colruyt')

          // Téléchargement de l'image si présente
          let imageAttachment: Array<{ url: string }> | undefined
          if (product.url_image) {
            try {
              imageAttachment = [{ url: product.url_image }]
            } catch {
              // Image non critique, on continue
            }
          }

          await upsertProduct(
            {
              Nom: product.nom,
              Fournisseur: 'Colruyt',
              Reference: product.reference,
              Prix_Achat_EUR: product.prix_eur,
              Categorie: product.categorie,
              URL_Source: product.url_source || url,
              Derniere_MAJ: new Date().toISOString().split('T')[0],
              ...(imageAttachment ? { Image: imageAttachment } : {}),
            },
            existing?.id
          )

          totalUpdated++
        } catch (err) {
          console.error(`[Colruyt] Erreur upsert produit ${product.reference}:`, err)
        }
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

    console.error('[Colruyt] Erreur critique:', message)
    return NextResponse.json({ success: false, log }, { status: 500 })
  }
}
