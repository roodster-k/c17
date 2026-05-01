export const dynamic = 'force-dynamic'

import AdminLayout from '@/components/ui/AdminLayout'
import { getDashboardStats } from '@/lib/db'
import { formatCdf } from '@/utils/price'

const SUPPLIER_COLORS: Record<string, string> = {
  sligro: 'bg-orange-500',
  colruyt: 'bg-red-500',
  nespresso: 'bg-amber-700',
}

export default async function AdminDashboard() {
  const stats = await getDashboardStats()

  const bySupplier: Record<string, number> = {}
  for (const row of stats.bySupplier) {
    bySupplier[row.supplier ?? 'inconnu'] = Number(row.count)
  }

  const lastUpdateFormatted = stats.lastUpdate
    ? new Date(stats.lastUpdate).toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : 'Jamais'

  return (
    <AdminLayout>
      <div className="p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="text-gray-400 text-sm mt-1">
              Dernière mise à jour : {lastUpdateFormatted}
            </p>
          </div>
          <SyncButton />
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KpiCard
            title="Produits actifs"
            value={stats.active.toString()}
            subtitle={`sur ${stats.total} au total`}
            color="blue"
          />
          <KpiCard
            title="Variations aujourd'hui"
            value={stats.recentChanges.length.toString()}
            subtitle="variations de prix détectées"
            color={stats.recentChanges.length > 0 ? 'yellow' : 'green'}
          />
          <KpiCard
            title="Sligro"
            value={(bySupplier['sligro'] ?? 0).toString()}
            subtitle="produits"
            color="orange"
          />
          <KpiCard
            title="Colruyt"
            value={(bySupplier['colruyt'] ?? 0).toString()}
            subtitle="produits"
            color="red"
          />
        </div>

        {/* Variations récentes */}
        {stats.recentChanges.length > 0 && (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              Variations de prix — dernières 24h
            </h2>
            <div className="space-y-2">
              {stats.recentChanges.slice(0, 5).map((change) => (
                <div key={change.id} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                  <span className="text-gray-400 text-sm">
                    {new Date(change.recorded_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className={`text-sm font-medium ${change.change_pct > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {change.change_pct > 0 ? '+' : ''}{change.change_pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Répartition par fournisseur */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Répartition par fournisseur</h2>
          <div className="space-y-3">
            {stats.bySupplier.map((row) => (
              <div key={row.supplier} className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${SUPPLIER_COLORS[row.supplier] ?? 'bg-gray-500'}`} />
                <span className="text-gray-300 text-sm capitalize flex-1">{row.supplier}</span>
                <span className="text-white font-medium">{row.count}</span>
                <div className="w-32 bg-gray-800 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${SUPPLIER_COLORS[row.supplier] ?? 'bg-gray-500'}`}
                    style={{ width: `${stats.total ? (Number(row.count) / stats.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}

function KpiCard({ title, value, subtitle, color }: {
  title: string; value: string; subtitle: string
  color: 'blue' | 'green' | 'yellow' | 'red' | 'orange'
}) {
  const colorMap = {
    blue: 'text-blue-400', green: 'text-green-400',
    yellow: 'text-yellow-400', red: 'text-red-400', orange: 'text-orange-400',
  }
  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
      <p className="text-gray-400 text-sm font-medium mb-2">{title}</p>
      <p className={`text-3xl font-bold ${colorMap[color]}`}>{value}</p>
      <p className="text-gray-500 text-xs mt-1">{subtitle}</p>
    </div>
  )
}

function SyncButton() {
  return (
    <form action="/api/sync" method="get" target="_blank">
      <button type="submit"
        className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Lancer sync manuelle
      </button>
    </form>
  )
}
