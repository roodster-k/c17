'use client'

import AdminLayout from '@/components/ui/AdminLayout'
import { useState, useEffect } from 'react'

interface Client {
  id: string
  name: string
  city: string
  country: string
  contact_email: string | null
  frais_achat_pct: number | null
  notes: string | null
  active: boolean
  created_at: string
}

const emptyClient = (): Omit<Client, 'id' | 'created_at'> => ({
  name: '',
  city: 'Kinshasa',
  country: 'Congo',
  contact_email: null,
  frais_achat_pct: null,
  notes: null,
  active: true,
})

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Partial<Client> | null>(null)
  const [saving, setSaving] = useState(false)

  async function loadClients() {
    const res = await fetch('/api/admin/clients')
    const data = await res.json()
    setClients(data.clients ?? [])
    setLoading(false)
  }

  useEffect(() => { loadClients() }, [])

  async function saveClient() {
    if (!editing?.name) return
    setSaving(true)
    try {
      await fetch('/api/admin/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      })
      setShowForm(false)
      setEditing(null)
      await loadClients()
    } finally {
      setSaving(false)
    }
  }

  async function deleteClient(id: string, name: string) {
    if (!confirm(`Supprimer "${name}" ?`)) return
    await fetch(`/api/admin/clients?id=${id}`, { method: 'DELETE' })
    await loadClients()
  }

  function startEdit(client: Client) {
    setEditing({ ...client })
    setShowForm(true)
  }

  function startNew() {
    setEditing(emptyClient())
    setShowForm(true)
  }

  return (
    <AdminLayout>
      <div className="p-8 max-w-4xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Clients</h1>
            <p className="text-gray-400 mt-1">Hôtels partenaires à Kinshasa</p>
          </div>
          <button
            onClick={startNew}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nouveau client
          </button>
        </div>

        {/* Form modal */}
        {showForm && editing && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md">
              <h2 className="text-lg font-semibold text-white mb-5">
                {editing.id ? 'Modifier le client' : 'Nouveau client'}
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Nom *</label>
                  <input
                    value={editing.name ?? ''}
                    onChange={e => setEditing(v => ({ ...v!, name: e.target.value }))}
                    placeholder="Ex: Hilton Kinshasa"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">Ville</label>
                    <input
                      value={editing.city ?? 'Kinshasa'}
                      onChange={e => setEditing(v => ({ ...v!, city: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">Pays</label>
                    <input
                      value={editing.country ?? 'Congo'}
                      onChange={e => setEditing(v => ({ ...v!, country: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Email contact</label>
                  <input
                    type="email"
                    value={editing.contact_email ?? ''}
                    onChange={e => setEditing(v => ({ ...v!, contact_email: e.target.value || null }))}
                    placeholder="achat@hilton-kinshasa.com"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-400 block mb-1">
                    Frais d&apos;achat spécifiques (%)
                    <span className="text-gray-500 ml-1">— laissez vide pour utiliser le défaut fournisseur</span>
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    value={editing.frais_achat_pct ?? ''}
                    onChange={e => setEditing(v => ({ ...v!, frais_achat_pct: e.target.value ? parseFloat(e.target.value) : null }))}
                    placeholder="15"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Notes</label>
                  <textarea
                    value={editing.notes ?? ''}
                    onChange={e => setEditing(v => ({ ...v!, notes: e.target.value || null }))}
                    rows={2}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 resize-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="active"
                    checked={editing.active ?? true}
                    onChange={e => setEditing(v => ({ ...v!, active: e.target.checked }))}
                    className="rounded"
                  />
                  <label htmlFor="active" className="text-sm text-gray-400">Client actif</label>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={saveClient}
                  disabled={saving || !editing.name}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-medium transition"
                >
                  {saving ? 'Sauvegarde...' : 'Sauvegarder'}
                </button>
                <button
                  onClick={() => { setShowForm(false); setEditing(null) }}
                  className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-sm transition"
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Client list */}
        {loading ? (
          <div className="text-gray-400">Chargement...</div>
        ) : clients.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p>Aucun client. Commencez par en créer un.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {clients.map(client => (
              <div key={client.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="text-white font-medium">{client.name}</span>
                    {!client.active && (
                      <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">Inactif</span>
                    )}
                    {client.frais_achat_pct !== null && (
                      <span className="text-xs text-blue-400 bg-blue-900/30 px-2 py-0.5 rounded">
                        {client.frais_achat_pct}% frais
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm text-gray-400">{client.city}, {client.country}</span>
                    {client.contact_email && (
                      <>
                        <span className="text-gray-600">·</span>
                        <span className="text-sm text-gray-500">{client.contact_email}</span>
                      </>
                    )}
                  </div>
                  {client.notes && <p className="text-xs text-gray-600 mt-1">{client.notes}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startEdit(client)}
                    className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => deleteClient(client.id, client.name)}
                    className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
