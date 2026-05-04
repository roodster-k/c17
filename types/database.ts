// Types TypeScript générés depuis le schéma Supabase (Phase 1)
// Ces types seront régénérés automatiquement avec : npx supabase gen types typescript

export type Supplier = 'sligro' | 'colruyt' | 'nespresso'

export interface Database {
  public: {
    Tables: {
      products: {
        Row: Product
        Insert: ProductInsert
        Update: ProductUpdate
      }
      price_history: {
        Row: PriceHistory
        Insert: PriceHistoryInsert
        Update: PriceHistoryUpdate
      }
    }
  }
}

// ─── Products ────────────────────────────────────────────────

export interface Product {
  id: string
  name: string
  supplier: Supplier | null
  reference: string | null
  category: string | null
  buy_price_eur: number | null
  margin_pct: number | null
  sell_price_cdf: number | null
  image_url: string | null
  source_url: string | null
  active: boolean
  airtable_id: string | null
  updated_at: string
}

export type ProductInsert = Omit<Product, 'id' | 'updated_at'> & {
  id?: string
  updated_at?: string
}

export type ProductUpdate = Partial<ProductInsert>

// ─── Price History ───────────────────────────────────────────

export interface PriceHistory {
  id: string
  product_id: string
  old_price: number | null
  new_price: number | null
  change_pct: number | null
  recorded_at: string
}

export type PriceHistoryInsert = Omit<PriceHistory, 'id' | 'recorded_at'> & {
  id?: string
  recorded_at?: string
}

export type PriceHistoryUpdate = Partial<PriceHistoryInsert>

// ─── Scraping ────────────────────────────────────────────────

export type ScrapingStatus = 'idle' | 'running' | 'success' | 'error'

export interface ScrapingLog {
  supplier: Supplier
  status: ScrapingStatus
  productsFound: number
  productsUpdated: number
  error?: string
  startedAt: string
  finishedAt?: string
}
