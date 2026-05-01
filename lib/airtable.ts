const AIRTABLE_PAT = process.env.AIRTABLE_PAT!
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!
const AIRTABLE_API_URL = 'https://api.airtable.com/v0'

export interface AirtableRecord {
  id: string
  fields: AirtableProductFields
  createdTime: string
}

export interface AirtableProductFields {
  Nom?: string
  Fournisseur?: string
  Reference?: string
  Prix_Achat_EUR?: number
  Marge_Pct?: number
  Prix_Vente_CDF?: number
  Categorie?: string
  Image?: Array<{ url: string; id?: string; filename?: string; size?: number; type?: string }>
  URL_Source?: string
  Actif?: boolean
  Derniere_MAJ?: string
}

interface AirtableListResponse {
  records: AirtableRecord[]
  offset?: string
}

// Récupère tous les produits Airtable (avec pagination automatique)
export async function getAllProducts(): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = []
  let offset: string | undefined

  do {
    const params = new URLSearchParams({ pageSize: '100' })
    if (offset) params.set('offset', offset)

    const res = await fetch(
      `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/Produits?${params}`,
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_PAT}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!res.ok) {
      const error = await res.text()
      throw new Error(`Airtable API error ${res.status}: ${error}`)
    }

    const data: AirtableListResponse = await res.json()
    records.push(...data.records)
    offset = data.offset
  } while (offset)

  return records
}

// Crée ou met à jour un produit dans Airtable
export async function upsertProduct(
  fields: AirtableProductFields,
  recordId?: string
): Promise<AirtableRecord> {
  const url = recordId
    ? `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/Produits/${recordId}`
    : `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/Produits`

  const method = recordId ? 'PATCH' : 'POST'

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  })

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`Airtable upsert error ${res.status}: ${error}`)
  }

  return res.json()
}

// Cherche un produit par référence fournisseur
export async function findProductByReference(
  reference: string,
  supplier: string
): Promise<AirtableRecord | null> {
  const formula = encodeURIComponent(
    `AND({Reference}="${reference}", {Fournisseur}="${supplier}")`
  )

  const res = await fetch(
    `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/Produits?filterByFormula=${formula}`,
    {
      headers: {
        Authorization: `Bearer ${AIRTABLE_PAT}`,
      },
    }
  )

  if (!res.ok) throw new Error(`Airtable search error ${res.status}`)

  const data: AirtableListResponse = await res.json()
  return data.records[0] ?? null
}
