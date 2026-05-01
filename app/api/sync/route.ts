import { NextResponse } from 'next/server'
import { getAllProducts } from '@/lib/airtable'
import {
  getProductByAirtableId,
  upsertProduct,
  insertPriceHistory,
} from '@/lib/db'
import { calculateSellPriceCdf, calculateChangePercent } from '@/utils/price'
import { downloadImage, getImageFilename } from '@/utils/scraping'
import { put } from '@vercel/blob'
import type { SyncResult } from '@/types/database'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const PRICE_ALERT_THRESHOLD = 5

export async function GET(): Promise<NextResponse> {
  const startTime = Date.now()
  const result: SyncResult = {
    upserted: 0,
    priceChanges: 0,
    imagesUploaded: 0,
    errors: [],
    duration: 0,
  }

  try {
    const airtableRecords = await getAllProducts()

    for (const record of airtableRecords) {
      const fields = record.fields
      if (!fields.Nom) continue

      try {
        // Récupération du produit existant dans Neon
        const existing = await getProductByAirtableId(record.id)

        const buyPriceEur = fields.Prix_Achat_EUR ?? 0
        const marginPct = fields.Marge_Pct ?? 30
        const sellPriceCdf = calculateSellPriceCdf(buyPriceEur, marginPct)

        // Gestion des images via Vercel Blob
        let imageUrl = existing?.image_url ?? null
        const airtableImageUrl = fields.Image?.[0]?.url

        if (airtableImageUrl && airtableImageUrl !== existing?.image_url) {
          try {
            const { buffer, contentType } = await downloadImage(airtableImageUrl)
            const filename = getImageFilename(airtableImageUrl, fields.Reference ?? record.id)

            const blob = await put(`products/${filename}`, buffer, {
              access: 'public',
              contentType,
            })

            imageUrl = blob.url
            result.imagesUploaded++
          } catch (imgErr) {
            console.warn(`[Sync] Image upload échouée pour ${fields.Nom}:`, imgErr)
          }
        }

        // Upsert dans Neon
        const upserted = await upsertProduct({
          name: fields.Nom,
          supplier: fields.Fournisseur?.toLowerCase() ?? null,
          reference: fields.Reference ?? null,
          category: fields.Categorie ?? null,
          buy_price_eur: buyPriceEur,
          margin_pct: marginPct,
          sell_price_cdf: sellPriceCdf,
          image_url: imageUrl,
          source_url: fields.URL_Source ?? null,
          active: fields.Actif ?? true,
          airtable_id: record.id,
        })

        result.upserted++

        // Détection variation de prix
        if (
          existing?.buy_price_eur !== null &&
          existing?.buy_price_eur !== undefined &&
          existing.buy_price_eur !== buyPriceEur
        ) {
          const changePct = calculateChangePercent(existing.buy_price_eur, buyPriceEur)

          await insertPriceHistory({
            product_id: upserted.id,
            old_price: existing.buy_price_eur,
            new_price: buyPriceEur,
            change_pct: changePct,
          })

          result.priceChanges++

          if (Math.abs(changePct) >= PRICE_ALERT_THRESHOLD) {
            await sendPriceAlert(fields.Nom, fields.Fournisseur ?? 'Inconnu', existing.buy_price_eur, buyPriceEur, changePct)
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        result.errors.push(`"${fields.Nom}": ${message}`)
        console.error(`[Sync] Erreur produit ${fields.Nom}:`, err)
      }
    }

    result.duration = Date.now() - startTime
    return NextResponse.json({ success: true, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    result.errors.push(`Erreur critique: ${message}`)
    result.duration = Date.now() - startTime
    return NextResponse.json({ success: false, result }, { status: 500 })
  }
}

async function sendPriceAlert(
  productName: string,
  supplier: string,
  oldPrice: number,
  newPrice: number,
  changePct: number
): Promise<void> {
  const direction = changePct > 0 ? 'hausse' : 'baisse'
  const sign = changePct > 0 ? '+' : ''
  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM ?? 'alertes@noreply.com',
      to: process.env.RESEND_TO ?? '',
      subject: `[B2B Congo] ${direction.charAt(0).toUpperCase() + direction.slice(1)} de prix — ${productName}`,
      html: `
        <h2>Alerte variation de prix</h2>
        <p><strong>Produit :</strong> ${productName}</p>
        <p><strong>Fournisseur :</strong> ${supplier}</p>
        <p><strong>Ancien prix :</strong> €${oldPrice.toFixed(2)}</p>
        <p><strong>Nouveau prix :</strong> €${newPrice.toFixed(2)}</p>
        <p><strong>Variation :</strong> ${sign}${changePct}%</p>
      `,
    })
  } catch (err) {
    console.error('[Sync] Alerte email échouée:', err)
  }
}
