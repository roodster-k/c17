'use client'

import AdminLayout from '@/components/ui/AdminLayout'
import { useState } from 'react'

type Supplier = 'colruyt' | 'sligro' | 'nespresso'
type RunStatus = 'idle' | 'running' | 'success' | 'error'

interface SupplierState {
  status: RunStatus
  productsFound: number
  productsUpdated: number
  error?: string
  lastRun?: string
  duration?: number
}

const SUPPLIERS: { key: Supplier; label: string; color: string }[] = [
  { key: 'colruyt', label: 'Colruyt', color: 'text-red-400' },
  { key: 'sligro', label: 'Sligro', color: 'text-orange-400' },
  { key: 'nespresso', label: 'Nespresso', color: 'text-amber-500' },
]

export default function ScrapingPage() {
  const [states, setStates] = useState<Record<Supplier, SupplierState>>({
    colruyt: { status: 'idle', productsFound: 0, productsUpdated: 0 },
    sligro: { status: 'idle', productsFound: 0, productsUpdated: 0 },
    nespresso: { status: 'idle', productsFound: 0, productsUpdated: 0 },
  })
  const [syncState, setSyncState] = useState<{
    status: RunStatus
    result?: { upserted: number; priceChanges: number; imagesUploaded: number; errors: string[] }
  }>({ status: 'idle' })
  const [allRunning, setAllRunning] = useState(false)

  async function runScraper(supplier: Supplier) {
    const start = Date.now()
    setStates((prev) => ({
      ...prev,
      [supplier]: { ...prev[supplier], status: 'running' },
    }))

    try {
      const res = await fetch(`/api/scrape/${supplier}`)
      const data = await res.json()
      const duration = Math.round((Date.now() - start) / 1000)

      setStates((prev) => ({
        ...prev,
        [supplier]: {
          status: data.success ? 'success' : 'error',
          productsFound: data.log?.productsFound ?? 0,
          productsUpdated: data.log?.productsUpdated ?? 0,
          error: data.log?.error,
          lastRun: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
          duration,
        },
      }))
    } catch (err) {
      setStates((prev) => ({
        ...prev,
        [supplier]: {
          status: 'error',
          productsFound: 0,
          productsUpdated: 0,
          error: err instanceof Error ? err.message : 'Erreur inconnue',
          lastRun: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        },
      }))
    }
  }

  async function runSync() {
    setSyncState({ status: 'running' })
    try {
      const res = await fetch('/api/sync')
      const data = await res.json()
      setSyncState({ status: data.success ? 'success' : 'error', result: data.result })
    } catch (err) {
      setSyncState({ status: 'error' })
    }
  }

  async function runAll() {
    setAllRunning(true)
    for (const s of SUPPLIERS) {
      await runScraper(s.key)
    }
    await runSync()
    setAllRunning(false)
  }

  const STATUS_ICON: Record<RunStatus, React.ReactNode> = {
    idle: <span className="w-2.5 h-2.5 rounded-full bg-gray-600 inline-block" />,
    running: (
      <svg className="w-4 h-4 text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    ),
    success: <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />,
    error: <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />,
  }

  return (
    <AdminLayout>
      <div className="p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Scraping</h1>
            <p className="text-gray-400 text-sm mt-1">
              Gérez les scrapings fournisseurs et la synchronisation
            </p>
          </div>

          <button
            onClick={runAll}
            disabled={allRunning}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500
                       disabled:opacity-50 text-white text-sm font-medium rounded-xl transition"
          >
            {allRunning ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            {allRunning ? 'En cours...' : 'Tout lancer'}
          </button>
        </div>

        {/* Fournisseurs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {SUPPLIERS.map(({ key, label, color }) => {
            const state = states[key]
            return (
              <div key={key} className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    {STATUS_ICON[state.status]}
                    <h2 className={`font-semibold ${color}`}>{label}</h2>
                  </div>
                  <button
                    onClick={() => runScraper(key)}
                    disabled={state.status === 'running' || allRunning}
                    className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50
                               text-white text-xs font-medium rounded-lg transition"
                  >
                    {state.status === 'running' ? 'En cours...' : 'Lancer'}
                  </button>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Produits trouvés</span>
                    <span className="text-white font-medium">{state.productsFound}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Mis à jour</span>
                    <span className="text-white font-medium">{state.productsUpdated}</span>
                  </div>
                  {state.duration !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Durée</span>
                      <span className="text-white font-medium">{state.duration}s</span>
                    </div>
                  )}
                  {state.lastRun && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Dernier run</span>
                      <span className="text-gray-400">{state.lastRun}</span>
                    </div>
                  )}
                  {state.error && (
                    <div className="mt-3 p-3 bg-red-950 rounded-lg">
                      <p className="text-red-400 text-xs">{state.error}</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Synchronisation */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {STATUS_ICON[syncState.status]}
              <h2 className="font-semibold text-white">Synchronisation Airtable → Supabase</h2>
            </div>
            <button
              onClick={runSync}
              disabled={syncState.status === 'running' || allRunning}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50
                         text-white text-xs font-medium rounded-lg transition"
            >
              {syncState.status === 'running' ? 'En cours...' : 'Lancer sync'}
            </button>
          </div>

          {syncState.result && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              <div>
                <p className="text-gray-500 text-xs">Produits synchronisés</p>
                <p className="text-white font-semibold text-lg">{syncState.result.upserted}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Variations de prix</p>
                <p className="text-yellow-400 font-semibold text-lg">{syncState.result.priceChanges}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Images uploadées</p>
                <p className="text-blue-400 font-semibold text-lg">{syncState.result.imagesUploaded}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Erreurs</p>
                <p className={`font-semibold text-lg ${syncState.result.errors.length > 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {syncState.result.errors.length}
                </p>
              </div>
              {syncState.result.errors.length > 0 && (
                <div className="col-span-4 mt-2 p-3 bg-red-950 rounded-lg">
                  <p className="text-red-400 text-xs">{syncState.result.errors.slice(0, 3).join(' | ')}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Info cron */}
        <div className="mt-4 p-4 bg-gray-800/50 rounded-xl border border-gray-700">
          <p className="text-gray-400 text-sm">
            <span className="text-gray-200 font-medium">Cron automatique :</span>{' '}
            Le scraping complet est déclenché automatiquement toutes les 6h par Vercel Cron
            (configuré dans <code className="text-blue-400">vercel.json</code>).
          </p>
        </div>
      </div>
    </AdminLayout>
  )
}
