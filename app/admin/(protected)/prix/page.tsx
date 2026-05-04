export const dynamic = 'force-dynamic'

import AdminLayout from '@/components/ui/AdminLayout'
import { getPriceHistory } from '@/lib/db'
import { formatEur } from '@/utils/price'

const SUPPLIER_BADGE: Record<string, string> = {
  sligro: 'bg-orange-500/20 text-orange-400',
  colruyt: 'bg-red-500/20 text-red-400',
  nespresso: 'bg-amber-700/20 text-amber-500',
}

export default async function PrixPage({
  searchParams,
}: {
  searchParams: Promise<{ supplier?: string; days?: string }>
}) {
  const { supplier, days: daysParam } = await searchParams
  const days = parseInt(daysParam ?? '7', 10)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const priceChanges = await getPriceHistory({ since, supplier, limit: 200 })

  const increases = priceChanges.filter((c) => (c.change_pct ?? 0) > 0).length
  const decreases = priceChanges.filter((c) => (c.change_pct ?? 0) < 0).length

  return (
    <AdminLayout>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Variations de prix</h1>
          <p className="text-gray-400 text-sm mt-1">
            {priceChanges.length} variations détectées sur les {days} derniers jours
          </p>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
            <p className="text-gray-400 text-sm">Total</p>
            <p className="text-2xl font-bold text-white mt-1">{priceChanges.length}</p>
          </div>
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
            <p className="text-gray-400 text-sm">Hausses</p>
            <p className="text-2xl font-bold text-red-400 mt-1">{increases}</p>
          </div>
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
            <p className="text-gray-400 text-sm">Baisses</p>
            <p className="text-2xl font-bold text-green-400 mt-1">{decreases}</p>
          </div>
        </div>

        {/* Filtres */}
        <form className="flex gap-3 mb-6">
          <select name="days" defaultValue={days}
            className="px-4 py-2 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="1">Dernières 24h</option>
            <option value="7">7 derniers jours</option>
            <option value="30">30 derniers jours</option>
          </select>
          <select name="supplier" defaultValue={supplier ?? ''}
            className="px-4 py-2 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Tous les fournisseurs</option>
            <option value="sligro">Sligro</option>
            <option value="colruyt">Colruyt</option>
            <option value="nespresso">Nespresso</option>
          </select>
          <button type="submit"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-xl transition font-medium">
            Filtrer
          </button>
        </form>

        {/* Table */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Produit</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Fournisseur</th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Ancien prix</th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Nouveau prix</th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Variation</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {priceChanges.map((change) => {
                const pct = change.change_pct ?? 0
                return (
                  <tr key={change.id} className="hover:bg-gray-800/50 transition">
                    <td className="px-4 py-3">
                      <p className="text-white text-sm font-medium">{change.product_name}</p>
                      {change.product_reference && (
                        <p className="text-gray-500 text-xs mt-0.5">{change.product_reference}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-medium
                        ${SUPPLIER_BADGE[change.product_supplier] ?? 'bg-gray-700 text-gray-400'}`}>
                        {change.product_supplier}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-gray-400 text-sm">
                        {change.old_price ? formatEur(change.old_price) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-white text-sm font-medium">
                        {change.new_price ? formatEur(change.new_price) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex items-center gap-1 text-sm font-semibold
                        ${pct > 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {pct > 0 ? '↑' : '↓'}{pct > 0 ? '+' : ''}{pct}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-gray-500 text-xs">
                        {new Date(change.recorded_at).toLocaleString('fr-FR', {
                          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {priceChanges.length === 0 && (
            <div className="text-center py-16 text-gray-500">Aucune variation de prix sur cette période</div>
          )}
        </div>
      </div>
    </AdminLayout>
  )
}
