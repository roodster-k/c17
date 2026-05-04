/**
 * GET  /api/admin/config — Read all config (app + suppliers)
 * POST /api/admin/config — Update a config key
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const [appConfig, suppliers] = await Promise.all([
    sql`SELECT key, value, label, updated_at FROM app_config ORDER BY key`,
    sql`SELECT id, supplier, display_name, frais_achat_pct, currency, notes, active FROM supplier_configs ORDER BY display_name`,
  ])

  return NextResponse.json({ appConfig, suppliers })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json()
  const { type, key, value, supplier, frais_achat_pct } = body

  if (type === 'app_config') {
    if (!key || value === undefined) {
      return NextResponse.json({ error: 'key et value requis' }, { status: 400 })
    }
    await sql`
      INSERT INTO app_config (key, value, updated_at)
      VALUES (${key}, ${String(value)}, now())
      ON CONFLICT (key) DO UPDATE SET value = ${String(value)}, updated_at = now()
    `
    return NextResponse.json({ success: true, key, value })
  }

  if (type === 'supplier') {
    if (!supplier) return NextResponse.json({ error: 'supplier requis' }, { status: 400 })
    await sql`
      UPDATE supplier_configs
      SET frais_achat_pct = ${frais_achat_pct}, updated_at = now()
      WHERE supplier = ${supplier}
    `
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'type invalide' }, { status: 400 })
}
