export const dynamic = 'force-dynamic'

import AdminLayout from '@/components/ui/AdminLayout'
import { getComparisonData, getComparisonCategories } from '@/lib/db'
import { formatEur } from '@/utils/price'

export default async function ComparaisonPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string }>
}) {
  const { category, q } = await searchParams

  const [groups, categories] = await Promise.all([
    getComparisonData({ category, minSuppliers: 1 }),
    getComparisonCategories(),
  ])

  // Filtrage par recherche texte
  const filtered = q
    ? groups.filter(g => g.canonicalName.toLowerCase().includes(q.toLowerCase()))
    : groups

  // Liste dynamique de tous les fournisseurs présents
  const allSuppliers = [...new Set(
    filtered.flatMap(g => Object.keys(g.suppliers))
  )].sort()

  // Statistiques rapides
  const multiSupplier = filtered.filter(g => Object.keys(g.suppliers).length >= 2)
  const savings = multiSupplier.reduce((acc, g) => {
    const prices = Object.values(g.suppliers)
      .map(s => s.buyPriceEur)
      .filter((p): p is number => p !== null && p > 0)
    if (prices.length < 2) return acc
    const max = Math.max(...prices)
    const min = Math.min(...prices)
    return acc + (max - min)
  }, 0)

  return (
    <AdminLayout>
      <div className="p-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Comparaison fournisseurs</h1>
          <p className="text-gray-400 text-sm mt-1">
            {filtered.length} produits · {allSuppliers.length} fournisseurs · économie max identifiée{' '}
            <span className="text-green-400 font-medium">{formatEur(savings)}</span>
          </p>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
            <p className="text-gray-400 text-sm">Produits suivis</p>
            <p className="text-2xl font-bold text-white mt-1">{filtered.length}</p>
          </div>
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
            <p className="text-gray-400 text-sm">Multi-fournisseurs</p>
            <p className="text-2xl font-bold text-blue-400 mt-1">{multiSupplier.length}</p>
          </div>
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
            <p className="text-gray-400 text-sm">Fournisseurs actifs</p>
            <p className="text-2xl font-bold text-purple-400 mt-1">{allSuppliers.length}</p>
          </div>
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
            <p className="text-gray-400 text-sm">Économie potentielle</p>
            <p className="text-2xl font-bold text-green-400 mt-1">{formatEur(savings)}</p>
          </div>
        </div>

        {/* Filtres */}
        <form className="flex flex-wrap gap-3 mb-6">
          <input
            name="q"
            defaultValue={q}
            placeholder="Rechercher un produit..."
            className="px-4 py-2 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm
                       placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
          />
          <select
            name="category"
            defaultValue={category ?? ''}
            className="px-4 py-2 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Toutes les catégories</option>
            {categories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-xl transition font-medium"
          >
            Filtrer
          </button>
        </form>

        {/* Légende fournisseurs */}
        {allSuppliers.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {allSuppliers.map(s => (
              <span key={s} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${SUPPLIER_STYLE[s] ?? 'bg-gray-700/50 text-gray-300 border-gray-600'}`}>
                <span className={`w-2 h-2 rounded-full ${SUPPLIER_DOT[s] ?? 'bg-gray-400'}`} />
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </span>
            ))}
          </div>
        )}

        {/* Tableau comparaison dynamique */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">
                    Produit
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">
                    Catégorie
                  </th>
                  {allSuppliers.map(supplier => (
                    <th
                      key={supplier}
                      className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3"
                    >
                      {supplier}
                    </th>
                  ))}
                  <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">
                    Meilleur prix
                  </th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">
                    Économie
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filtered.map(group => {
                  const prices = allSuppliers
                    .map(s => ({ supplier: s, price: group.suppliers[s]?.buyPriceEur ?? null }))
                    .filter(x => x.price !== null && x.price > 0) as { supplier: string; price: number }[]

                  const minPrice = prices.length > 0 ? Math.min(...prices.map(p => p.price)) : null
                  const maxPrice = prices.length > 0 ? Math.max(...prices.map(p => p.price)) : null
                  const bestSupplier = prices.find(p => p.price === minPrice)?.supplier
                  const saving = minPrice !== null && maxPrice !== null && prices.length >= 2
                    ? maxPrice - minPrice
                    : null

                  return (
                    <tr key={group.groupId} className="hover:bg-gray-800/50 transition">
                      <td className="px-4 py-3">
                        <p className="text-white text-sm font-medium">{group.canonicalName}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-gray-500 text-xs">{group.category ?? '—'}</span>
                      </td>

                      {allSuppliers.map(supplier => {
                        const entry = group.suppliers[supplier]
                        const price = entry?.buyPriceEur ?? null
                        const isBest = price !== null && price === minPrice && prices.length >= 2

                        return (
                          <td key={supplier} className="px-4 py-3 text-right">
                            {price !== null ? (
                              <span className={`text-sm font-medium inline-flex items-center gap-1 justify-end
                                ${isBest ? 'text-green-400' : 'text-gray-300'}`}>
                                {isBest && <span className="text-xs">✓</span>}
                                {formatEur(price)}
                              </span>
                            ) : (
                              <span className="text-gray-700 text-sm">—</span>
                            )}
                          </td>
                        )
                      })}

                      <td className="px-4 py-3 text-right">
                        {bestSupplier ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium
                            ${SUPPLIER_STYLE[bestSupplier] ?? 'bg-gray-700 text-gray-300 border border-gray-600'}`}>
                            {bestSupplier}
                          </span>
                        ) : (
                          <span className="text-gray-700 text-sm">—</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right">
                        {saving !== null && saving > 0 ? (
                          <span className="text-green-400 text-sm font-semibold">
                            -{formatEur(saving)}
                          </span>
                        ) : (
                          <span className="text-gray-700 text-sm">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {filtered.length === 0 && (
              <div className="text-center py-16 text-gray-500">
                Aucun produit trouvé — lancez une sync pour peupler les groupes
              </div>
            )}
          </div>
        </div>

        {/* Note informative */}
        {filtered.length > 0 && (
          <p className="text-gray-600 text-xs mt-4 text-center">
            Les produits sont regroupés automatiquement par nom similaire.
            Un même produit vendu chez plusieurs fournisseurs apparaît sur la même ligne.
          </p>
        )}
      </div>
    </AdminLayout>
  )
}

// Styles par fournisseur — extensible sans toucher au tableau
const SUPPLIER_STYLE: Record<string, string> = {
  sligro:    'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  colruyt:   'bg-red-500/20 text-red-400 border border-red-500/30',
  nespresso: 'bg-amber-700/20 text-amber-500 border border-amber-700/30',
}

const SUPPLIER_DOT: Record<string, string> = {
  sligro:    'bg-orange-400',
  colruyt:   'bg-red-400',
  nespresso: 'bg-amber-500',
}
