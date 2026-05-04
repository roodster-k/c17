/**
 * lib/pricing.ts — Logique financière du business
 *
 * Formule complète :
 *   Prix total € = Prix € × (1 + frais_achat_pct/100) + (poids_kg × fret_par_kg)
 *   Prix $ = Prix total € × taux_eur_usd
 *   Prix CDF = Prix total € × taux_eur_cdf
 */

import { sql } from './db'

// ─── Types ───────────────────────────────────────────────────

export interface PricingInput {
  prix_eur: number           // Prix d'achat brut chez fournisseur
  frais_achat_pct: number    // Commission d'achat (%)
  poids_kg: number           // Poids du produit en kg
  fret_par_kg: number        // Coût fret par kg (€)
  taux_eur_usd: number       // Taux EUR/USD
  taux_eur_cdf?: number      // Taux EUR/CDF (optionnel)
}

export interface PricingResult {
  prix_achat_eur: number     // Prix d'achat brut
  frais_achat_eur: number    // Montant frais d'achat
  fret_eur: number           // Coût fret
  prix_total_eur: number     // Prix de revient complet
  prix_usd: number           // Prix de vente en dollars
  prix_cdf: number | null    // Prix de vente en CDF (si taux disponible)
}

// ─── Calcul principal ────────────────────────────────────────

export function calculatePricing(input: PricingInput): PricingResult {
  const { prix_eur, frais_achat_pct, poids_kg, fret_par_kg, taux_eur_usd, taux_eur_cdf } = input

  const frais_achat_eur = prix_eur * (frais_achat_pct / 100)
  const fret_eur = poids_kg * fret_par_kg
  const prix_total_eur = prix_eur + frais_achat_eur + fret_eur
  const prix_usd = prix_total_eur * taux_eur_usd
  const prix_cdf = taux_eur_cdf ? prix_total_eur * taux_eur_cdf : null

  return {
    prix_achat_eur: round2(prix_eur),
    frais_achat_eur: round2(frais_achat_eur),
    fret_eur: round2(fret_eur),
    prix_total_eur: round2(prix_total_eur),
    prix_usd: round2(prix_usd),
    prix_cdf: prix_cdf !== null ? Math.round(prix_cdf) : null,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ─── Config depuis la DB ─────────────────────────────────────

export interface AppPricingConfig {
  fret_par_kg: number
  taux_eur_usd: number
  taux_eur_cdf: number
  price_alert_threshold_pct: number
}

export async function getPricingConfig(): Promise<AppPricingConfig> {
  const rows = await sql`SELECT key, value FROM app_config WHERE key IN ('fret_par_kg_eur', 'taux_eur_usd', 'taux_eur_cdf', 'price_alert_threshold_pct')`
  const config: Record<string, string> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of rows as any[]) config[row.key] = row.value

  return {
    fret_par_kg: parseFloat(config['fret_par_kg_eur'] ?? '2.50'),
    taux_eur_usd: parseFloat(config['taux_eur_usd'] ?? '1.08'),
    taux_eur_cdf: parseFloat(config['taux_eur_cdf'] ?? '2900'),
    price_alert_threshold_pct: parseFloat(config['price_alert_threshold_pct'] ?? '5'),
  }
}

export async function getSupplierFraisAchat(supplier: string): Promise<number> {
  const rows = await sql`SELECT frais_achat_pct FROM supplier_configs WHERE supplier = ${supplier} AND active = true LIMIT 1`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return parseFloat((rows[0] as any)?.frais_achat_pct ?? '10')
}

export async function updateAppConfig(key: string, value: string): Promise<void> {
  await sql`
    INSERT INTO app_config (key, value, updated_at)
    VALUES (${key}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = now()
  `
}

// ─── Formatage ───────────────────────────────────────────────

export function formatEur(amount: number): string {
  return new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' }).format(amount)
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

export function formatCdf(amount: number): string {
  return new Intl.NumberFormat('fr-CD', { maximumFractionDigits: 0 }).format(amount) + ' CDF'
}
