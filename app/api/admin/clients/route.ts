/**
 * GET  /api/admin/clients — List all clients
 * POST /api/admin/clients — Create/update a client
 * DELETE /api/admin/clients?id=... — Delete a client
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const clients = await sql`
    SELECT id, name, city, country, contact_email, frais_achat_pct, notes, active, created_at
    FROM clients
    ORDER BY name
  `
  return NextResponse.json({ clients })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json()
  const { id, name, city, country, contact_email, frais_achat_pct, notes, active } = body

  if (!name) return NextResponse.json({ error: 'name requis' }, { status: 400 })

  if (id) {
    // Update
    await sql`
      UPDATE clients SET
        name = ${name},
        city = ${city ?? 'Kinshasa'},
        country = ${country ?? 'Congo'},
        contact_email = ${contact_email ?? null},
        frais_achat_pct = ${frais_achat_pct ?? null},
        notes = ${notes ?? null},
        active = ${active ?? true}
      WHERE id = ${id}
    `
    return NextResponse.json({ success: true, action: 'updated' })
  }

  // Create
  const rows = await sql`
    INSERT INTO clients (name, city, country, contact_email, frais_achat_pct, notes, active)
    VALUES (
      ${name},
      ${city ?? 'Kinshasa'},
      ${country ?? 'Congo'},
      ${contact_email ?? null},
      ${frais_achat_pct ?? null},
      ${notes ?? null},
      ${active ?? true}
    )
    RETURNING id
  `
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return NextResponse.json({ success: true, id: (rows[0] as any).id, action: 'created' })
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
  await sql`DELETE FROM clients WHERE id = ${id}`
  return NextResponse.json({ success: true })
}
