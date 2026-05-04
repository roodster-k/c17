import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

/**
 * Layout de protection — vérifie l'authentification admin.
 * S'applique à toutes les routes sous /admin/** sauf /admin/login.
 * Route group (protected) ne modifie pas les URLs.
 */
export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')?.value
  const isAuthenticated = !!session && session === process.env.ADMIN_PASSWORD

  if (!isAuthenticated) {
    redirect('/admin/login')
  }

  return <>{children}</>
}
