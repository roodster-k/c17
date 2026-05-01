import { NextRequest, NextResponse } from 'next/server'
import type { ScrapingLog } from '@/types/database'

// Protège l'endpoint avec CRON_SECRET
function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  return authHeader === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(request.url).origin
    : 'http://localhost:3000'

  const logs: ScrapingLog[] = []
  const errors: string[] = []

  console.log('[Cron] Démarrage du scraping complet —', new Date().toISOString())

  // 1. Scraping Colruyt
  try {
    const colruytRes = await fetch(`${baseUrl}/api/scrape/colruyt`, {
      headers: { Cookie: request.headers.get('cookie') ?? '' },
    })
    const colruytData = await colruytRes.json()
    if (colruytData.log) logs.push(colruytData.log)
    if (!colruytData.success) errors.push(`Colruyt: ${colruytData.log?.error ?? 'Erreur inconnue'}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`Colruyt: ${msg}`)
    console.error('[Cron] Colruyt échoué:', msg)
  }

  // 2. Scraping Sligro
  try {
    const sligroRes = await fetch(`${baseUrl}/api/scrape/sligro`, {
      headers: { Cookie: request.headers.get('cookie') ?? '' },
    })
    const sligroData = await sligroRes.json()
    if (sligroData.log) logs.push(sligroData.log)
    if (!sligroData.success) errors.push(`Sligro: ${sligroData.log?.error ?? 'Erreur inconnue'}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`Sligro: ${msg}`)
    console.error('[Cron] Sligro échoué:', msg)
  }

  // 3. Scraping Nespresso
  try {
    const nespressoRes = await fetch(`${baseUrl}/api/scrape/nespresso`, {
      headers: { Cookie: request.headers.get('cookie') ?? '' },
    })
    const nespressoData = await nespressoRes.json()
    if (nespressoData.log) logs.push(nespressoData.log)
    if (!nespressoData.success)
      errors.push(`Nespresso: ${nespressoData.log?.error ?? 'Erreur inconnue'}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`Nespresso: ${msg}`)
    console.error('[Cron] Nespresso échoué:', msg)
  }

  // 4. Synchronisation Airtable → Supabase
  try {
    const syncRes = await fetch(`${baseUrl}/api/sync`)
    const syncData = await syncRes.json()
    if (!syncData.success) {
      errors.push(`Sync: ${syncData.result?.errors?.join(', ') ?? 'Erreur inconnue'}`)
    }
    console.log('[Cron] Sync terminée:', syncData.result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`Sync: ${msg}`)
    console.error('[Cron] Sync échouée:', msg)
  }

  console.log('[Cron] Scraping complet terminé —', new Date().toISOString())

  return NextResponse.json({
    success: errors.length === 0,
    logs,
    errors,
    completedAt: new Date().toISOString(),
  })
}
