export const dynamic = 'force-dynamic'

import AdminLayout from '@/components/ui/AdminLayout'
import { getDashboardStats, sql } from '@/lib/db'
import { getPricingConfig } from '@/lib/pricing'

const SUPPLIER_COLORS: Record<string, string> = {
  sligro: 'bg-orange-500',
  colruyt: 'bg-red-500',
  nespresso: 'bg-amber-700',
}
const SUPPLIER_TEXT: Record<string, string> = {
  sligro: 'text-orange-400',
  colruyt: 'text-red-400',
  nespresso: 'text-amber-500',
}

export default async function AdminDashboard() {
  const [stats, pricingConfig, lastLogs, sampleProducts] = await Promise.all([
    getDashboardStats(),
    getPricingConfig().catch(() => null),
    // Last scraping logs
    sql`
      SELECT supplier, status, products_found, products_updated, started_at, finished_at
      FROM scraping_logs
      ORDER BY started_at DESC
      LIMIT 5
    `.catch(() => []),
    // Sample products with prices
    sql`
      SELECT name, brand, supplier, buy_price_eur, sell_price_cdf, category
      FROM products
      WHERE buy_price_eur IS NOT NULL AND supplier IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 6
    `.catch(() => []),
  ])

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
              Dernière mise à jour catalogue : {lastUpdateFormatted}
            </p>
          </div>
          <ScraperButton />
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KpiCard title="Produits actifs" value={stats.active.toString()}
            subtitle={`sur ${stats.total} au total`} color="blue" />
          <KpiCard title="Variations 24h" value={stats.recentChanges.length.toString()}
            subtitle="variations détectées" color={stats.recentChanges.length > 0 ? 'yellow' : 'green'} />
          <KpiCard title="Sligro" value={(bySupplier['sligro'] ?? 0).toString()}
            subtitle="produits dans le catalogue" color="orange" />
          <KpiCard title="Taux EUR/USD"
            value={pricingConfig ? `$${pricingConfig.taux_eur_usd}` : 'N/A'}
            subtitle={pricingConfig ? `Fret: €${pricingConfig.fret_par_kg}/kg` : ''}
            color="blue" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Derniers produits scrapés */}
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
            <h2 className="text-base font-semibold text-white mb-4">
              Derniers produits ajoutés
            </h2>
            <div className="space-y-3">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(sampleProducts as any[]).map((p: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-800 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{p.name}</p>
                    <p className="text-xs text-gray-500">{p.category}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium text-emerald-400">€{Number(p.buy_price_eur).toFixed(2)}</p>
                    {p.sell_price_cdf && (
                      <p className="text-xs text-gray-500">
                        {Math.round(Number(p.sell_price_cdf)).toLocaleString('fr-FR')} CDF
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {(sampleProducts as unknown[]).length === 0 && (
                <p className="text-gray-500 text-sm">Aucun produit — lancez un scraping</p>
              )}
            </div>
          </div>

          {/* Logs de scraping */}
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
            <h2 className="text-base font-semibold text-white mb-4">Historique scraping</h2>
            <div className="space-y-3">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(lastLogs as any[]).map((log: any, i: number) => (
                <div key={i} className="flex items-center gap-3 py-1.5 border-b border-gray-800 last:border-0">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    log.status === 'success' ? 'bg-emerald-400' :
                    log.status === 'error' ? 'bg-red-400' : 'bg-yellow-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium capitalize ${SUPPLIER_TEXT[log.supplier] ?? 'text-gray-300'}`}>
                        {log.supplier}
                      </span>
                      <span className="text-xs text-gray-500">
                        {log.products_updated} mis à jour
                      </span>
                    </div>
                    <p className="text-xs text-gray-600">
                      {new Date(log.started_at).toLocaleString('fr-FR', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                      })}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    log.status === 'success' ? 'bg-emerald-900/40 text-emerald-400' :
                    log.status === 'error' ? 'bg-red-900/40 text-red-400' :
                    'bg-yellow-900/40 text-yellow-400'
                  }`}>
                    {log.status}
                  </span>
                </div>
              ))}
              {(lastLogs as unknown[]).length === 0 && (
                <p className="text-gray-500 text-sm">Aucun log — lancez un scraping</p>
              )}
            </div>
          </div>
        </div>

        {/* Répartition par fournisseur */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
          <h2 className="text-base font-semibold text-white mb-4">Répartition par fournisseur</h2>
          <div className="space-y-3">
            {stats.bySupplier.length === 0 && (
              <p className="text-gray-500 text-sm">Aucun produit en base — lancez le scraping Sligro</p>
            )}
            {stats.bySupplier.map((row) => (
              <div key={row.supplier} className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${SUPPLIER_COLORS[row.supplier] ?? 'bg-gray-500'}`} />
                <span className="text-gray-300 text-sm capitalize flex-1">{row.supplier ?? 'inconnu'}</span>
                <span className="text-white font-medium text-sm">{row.count}</span>
                <div className="w-32 bg-gray-800 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${SUPPLIER_COLORS[row.supplier] ?? 'bg-gray-500'}`}
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

function ScraperButton() {
  return (
    <a
      href="/admin/scraping"
      className="flex items-center gap-2 px-4 py-2.5 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium rounded-xl transition"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      Lancer scraping
    </a>
  )
}
