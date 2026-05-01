import { NextRequest, NextResponse } from 'next/server'

// Protège toutes les routes /admin avec un mot de passe simple
// (Pas de Supabase Auth nécessaire en Phase 1)
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl

  // Seules les routes /admin sont protégées
  if (!pathname.startsWith('/admin')) {
    return NextResponse.next()
  }

  // Vérifie si l'utilisateur a déjà un cookie de session admin valide
  const adminSession = request.cookies.get('admin_session')?.value
  if (adminSession === process.env.ADMIN_PASSWORD) {
    return NextResponse.next()
  }

  // La page de login elle-même n'est pas protégée
  if (pathname === '/admin/login') {
    return NextResponse.next()
  }

  // Redirige vers la page de login
  const loginUrl = new URL('/admin/login', request.url)
  loginUrl.searchParams.set('redirect', pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/admin/:path*'],
}
