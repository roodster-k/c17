import { NextRequest, NextResponse } from 'next/server'
import { mergeGroups, unlinkProductFromGroup } from '@/lib/db'

// POST /api/admin/groups — fusionner deux groupes
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { action, keepGroupId, deleteGroupId, productId } = await request.json()

  try {
    if (action === 'merge' && keepGroupId && deleteGroupId) {
      await mergeGroups(keepGroupId, deleteGroupId)
      return NextResponse.json({ success: true })
    }

    if (action === 'unlink' && productId) {
      await unlinkProductFromGroup(productId)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Action invalide' }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
