/**
 * GET /api/cron/scrape-all
 * Déclenché automatiquement par Cloudflare Cron Triggers (wrangler.toml).
 * Lance les 3 scrapers en parallèle.
 */

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  return authHeader === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  const origin = new URL(request.url).origin
  const startedAt = new Date().toISOString()
  console.log('[Cron] Démarrage scraping complet —', startedAt)

  // Lance les 3 scrapers en parallèle
  const results = await Promise.allSettled([
    fetch(`${origin}/api/scrape/colruyt`).then(r => r.json()),
    fetch(`${origin}/api/scrape/sligro`, { method: 'POST' }).then(r => r.json()),
    fetch(`${origin}/api/scrape/nespresso`).then(r => r.json()),
  ])

  const suppliers = ['colruyt', 'sligro', 'nespresso']
  const errors: string[] = []
  let totalFound = 0
  let totalUpdated = 0

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const supplier = suppliers[i]
    if (result.status === 'fulfilled') {
      const data = result.value as { success: boolean; productsFound?: number; productsUpdated?: number; error?: string }
      totalFound += data.productsFound ?? 0
      totalUpdated += data.productsUpdated ?? 0
      if (!data.success) errors.push(`${supplier}: ${data.error ?? 'Erreur inconnue'}`)
      console.log(`[Cron] ${supplier}: ${data.productsFound ?? 0} trouvés, ${data.productsUpdated ?? 0} mis à jour`)
    } else {
      errors.push(`${supplier}: ${result.reason}`)
      console.error(`[Cron] ${supplier} échoué:`, result.reason)
    }
  }

  const completedAt = new Date().toISOString()
  console.log(`[Cron] ✓ Terminé — ${totalFound} trouvés, ${totalUpdated} mis à jour, ${errors.length} erreur(s)`)

  return NextResponse.json({
    success: errors.length === 0,
    totalFound,
    totalUpdated,
    errors,
    startedAt,
    completedAt,
  })
}
