'use client'

import AdminLayout from '@/components/ui/AdminLayout'
import { useState, useEffect } from 'react'

interface AppConfigItem {
  key: string
  value: string
  label: string
  updated_at: string
}

interface SupplierConfig {
  id: string
  supplier: string
  display_name: string
  frais_achat_pct: number
  currency: string
  notes: string | null
  active: boolean
}

const CONFIG_LABELS: Record<string, { label: string; unit: string; desc: string }> = {
  fret_par_kg_eur: { label: 'Fret par kg', unit: '€/kg', desc: 'Coût transport vers Kinshasa par kilogramme' },
  taux_eur_usd: { label: 'Taux EUR/USD', unit: 'USD', desc: 'Taux de change Euro → Dollar (saisi manuellement)' },
  taux_eur_cdf: { label: 'Taux EUR/CDF', unit: 'CDF', desc: 'Taux de change Euro → Franc Congolais' },
  price_alert_threshold_pct: { label: 'Seuil alerte prix', unit: '%', desc: 'Variation minimum déclenchant une alerte email' },
}

export default function ConfigPage() {
  const [appConfig, setAppConfig] = useState<AppConfigItem[]>([])
  const [suppliers, setSuppliers] = useState<SupplierConfig[]>([])
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/config')
      .then(r => r.json())
      .then(data => {
        setAppConfig(data.appConfig ?? [])
        setSuppliers(data.suppliers ?? [])
        const vals: Record<string, string> = {}
        for (const item of data.appConfig ?? []) vals[item.key] = item.value
        for (const s of data.suppliers ?? []) vals[`supplier_${s.supplier}`] = String(s.frais_achat_pct)
        setEditValues(vals)
        setLoading(false)
      })
  }, [])

  async function saveConfig(type: 'app_config' | 'supplier', key: string, supplierKey?: string) {
    setSaving(key)
    try {
      const body = type === 'app_config'
        ? { type, key, value: editValues[key] }
        : { type, supplier: supplierKey, frais_achat_pct: parseFloat(editValues[key]) }

      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setSaved(key)
        setTimeout(() => setSaved(null), 2000)
      }
    } finally {
      setSaving(null)
    }
  }

  return (
    <AdminLayout>
      <div className="p-8 max-w-3xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Configuration</h1>
          <p className="text-gray-400 mt-1">Taux de change, fret et commissions — pilotez la logique financière</p>
        </div>

        {loading ? (
          <div className="text-gray-400">Chargement...</div>
        ) : (
          <>
            {/* Formule recap */}
            <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5 mb-8">
              <h2 className="text-sm font-semibold text-gray-300 mb-3">📐 Formule de prix</h2>
              <div className="font-mono text-sm text-emerald-400 space-y-1">
                <div>Prix total € = Prix achat € × (1 + frais_achat%) + (poids_kg × fret/kg)</div>
                <div>Prix USD = Prix total € × taux EUR/USD</div>
                <div>Prix CDF = Prix total € × taux EUR/CDF</div>
              </div>
            </div>

            {/* App config */}
            <div className="space-y-4 mb-8">
              <h2 className="text-lg font-semibold text-white">Paramètres globaux</h2>
              {appConfig
                .filter(item => CONFIG_LABELS[item.key])
                .map(item => {
                  const meta = CONFIG_LABELS[item.key]
                  return (
                    <div key={item.key} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-white font-medium">{meta.label}</span>
                            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{meta.unit}</span>
                          </div>
                          <p className="text-xs text-gray-500">{meta.desc}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            step="any"
                            value={editValues[item.key] ?? item.value}
                            onChange={e => setEditValues(v => ({ ...v, [item.key]: e.target.value }))}
                            className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm text-right focus:outline-none focus:border-blue-500"
                          />
                          <button
                            onClick={() => saveConfig('app_config', item.key)}
                            disabled={saving === item.key}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                              saved === item.key
                                ? 'bg-emerald-600 text-white'
                                : 'bg-blue-600 hover:bg-blue-500 text-white'
                            } disabled:opacity-50`}
                          >
                            {saved === item.key ? '✓' : saving === item.key ? '...' : 'Sauver'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>

            {/* Supplier frais achat */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white">Frais d&apos;achat par fournisseur</h2>
              <p className="text-sm text-gray-500">Ces % s&apos;appliquent au prix d&apos;achat pour calculer le prix de revient</p>
              {suppliers.map(s => {
                const editKey = `supplier_${s.supplier}`
                return (
                  <div key={s.supplier} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <span className="text-white font-medium">{s.display_name}</span>
                        {s.notes && <p className="text-xs text-gray-500 mt-0.5">{s.notes}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max="100"
                            value={editValues[editKey] ?? String(s.frais_achat_pct)}
                            onChange={e => setEditValues(v => ({ ...v, [editKey]: e.target.value }))}
                            className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm text-right focus:outline-none focus:border-blue-500"
                          />
                          <span className="text-gray-400 text-sm">%</span>
                        </div>
                        <button
                          onClick={() => saveConfig('supplier', editKey, s.supplier)}
                          disabled={saving === editKey}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                            saved === editKey
                              ? 'bg-emerald-600 text-white'
                              : 'bg-blue-600 hover:bg-blue-500 text-white'
                          } disabled:opacity-50`}
                        >
                          {saved === editKey ? '✓' : saving === editKey ? '...' : 'Sauver'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  )
}
