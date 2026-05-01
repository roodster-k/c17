import { NextRequest, NextResponse } from 'next/server'
import { getProductById, updateProduct } from '@/lib/db'
import { calculateSellPriceCdf } from '@/utils/price'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  const body = await request.json()

  const updates: Parameters<typeof updateProduct>[1] = {}

  if (typeof body.active === 'boolean') {
    updates.active = body.active
  }

  if (typeof body.margin_pct === 'number') {
    updates.margin_pct = body.margin_pct
    const product = await getProductById(id)
    if (product?.buy_price_eur) {
      updates.sell_price_cdf = calculateSellPriceCdf(product.buy_price_eur, body.margin_pct)
    }
  }

  try {
    await updateProduct(id, updates)
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
