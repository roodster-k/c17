export const dynamic = 'force-dynamic'

import AdminLayout from '@/components/ui/AdminLayout'
import { getProducts } from '@/lib/db'
import { formatEur, formatCdf } from '@/utils/price'
import Image from 'next/image'
import ProductActions from './ProductActions'

const SUPPLIER_BADGE: Record<string, string> = {
  sligro: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  colruyt: 'bg-red-500/20 text-red-400 border-red-500/30',
  nespresso: 'bg-amber-700/20 text-amber-500 border-amber-700/30',
}

export default async function ProduitsPage({
  searchParams,
}: {
  searchParams: Promise<{ supplier?: string; actif?: string; q?: string }>
}) {
  const { supplier, actif, q } = await searchParams

  const products = await getProducts({
    supplier,
    active: actif === 'true' ? true : actif === 'false' ? false : undefined,
    search: q,
    limit: 100,
  })

  return (
    <AdminLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Produits</h1>
            <p className="text-gray-400 text-sm mt-1">{products.length} produits affichés</p>
          </div>
        </div>

        {/* Filtres */}
        <form className="flex flex-wrap gap-3 mb-6">
          <input name="q" defaultValue={q} placeholder="Rechercher un produit..."
            className="px-4 py-2 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm
                       placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 w-64" />
          <select name="supplier" defaultValue={supplier ?? ''}
            className="px-4 py-2 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Tous les fournisseurs</option>
            <option value="sligro">Sligro</option>
            <option value="colruyt">Colruyt</option>
            <option value="nespresso">Nespresso</option>
          </select>
          <select name="actif" defaultValue={actif ?? ''}
            className="px-4 py-2 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Tous les statuts</option>
            <option value="true">Actifs</option>
            <option value="false">Inactifs</option>
          </select>
          <button type="submit"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-xl transition font-medium">
            Filtrer
          </button>
        </form>

        {/* Table */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3 w-12"></th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Produit</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Fournisseur</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Prix achat</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Marge</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Prix vente CDF</th>
                  <th className="text-center text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Statut</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">MAJ</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {products.map((product) => (
                  <tr key={product.id} className="hover:bg-gray-800/50 transition">
                    <td className="px-4 py-3">
                      <div className="w-10 h-10 rounded-lg bg-gray-800 overflow-hidden flex-shrink-0">
                        {product.image_url ? (
                          <Image src={product.image_url} alt={product.name} width={40} height={40}
                            className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-white text-sm font-medium">{product.name}</p>
                      {product.reference && <p className="text-gray-500 text-xs mt-0.5">{product.reference}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-medium border
                        ${SUPPLIER_BADGE[product.supplier ?? ''] ?? 'bg-gray-700 text-gray-300 border-gray-600'}`}>
                        {product.supplier ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-gray-300 text-sm">
                        {product.buy_price_eur ? formatEur(product.buy_price_eur) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-blue-400 text-sm font-medium">{product.margin_pct ?? 30}%</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-white text-sm font-medium">
                        {product.sell_price_cdf ? formatCdf(product.sell_price_cdf) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium
                        ${product.active ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${product.active ? 'bg-green-400' : 'bg-gray-500'}`} />
                        {product.active ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-gray-500 text-xs">
                        {new Date(product.updated_at).toLocaleDateString('fr-FR')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ProductActions productId={product.id} active={product.active} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {products.length === 0 && (
              <div className="text-center py-16 text-gray-500">Aucun produit trouvé</div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}
