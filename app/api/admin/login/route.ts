import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { password, redirect } = await request.json()

  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Mot de passe incorrect' }, { status: 401 })
  }

  const response = NextResponse.json({ success: true, redirect: redirect ?? '/admin' })

  // Cookie de session sécurisé (httpOnly, 7 jours)
  response.cookies.set('admin_session', password, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })

  return response
}

export async function DELETE(): Promise<NextResponse> {
  const response = NextResponse.json({ success: true })
  response.cookies.delete('admin_session')
  return response
}
