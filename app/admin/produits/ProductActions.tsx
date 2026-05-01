'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface ProductActionsProps {
  productId: string
  active: boolean
}

export default function ProductActions({ productId, active }: ProductActionsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function toggleActive() {
    setLoading(true)
    try {
      await fetch(`/api/admin/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !active }),
      })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={toggleActive}
      disabled={loading}
      title={active ? 'Désactiver' : 'Activer'}
      className={`p-2 rounded-lg transition disabled:opacity-50
        ${active
          ? 'text-gray-400 hover:text-red-400 hover:bg-red-500/10'
          : 'text-gray-400 hover:text-green-400 hover:bg-green-500/10'}`}
    >
      {active ? (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )}
    </button>
  )
}
