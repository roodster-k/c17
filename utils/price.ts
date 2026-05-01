// Utilitaires de calcul de prix

// Calcule le prix de vente CDF depuis le prix d'achat EUR
export function calculateSellPriceCdf(
  buyPriceEur: number,
  marginPct: number,
  eurToCdfRate?: number
): number {
  const rate = eurToCdfRate ?? Number(process.env.EUR_TO_CDF_RATE ?? 2850)
  const priceInCdf = buyPriceEur * rate
  const withMargin = priceInCdf * (1 + marginPct / 100)
  // Arrondi au franc congolais le plus proche
  return Math.round(withMargin)
}

// Calcule le pourcentage de variation entre deux prix
export function calculateChangePercent(oldPrice: number, newPrice: number): number {
  if (oldPrice === 0) return 0
  return Number((((newPrice - oldPrice) / oldPrice) * 100).toFixed(2))
}

// Formate un prix en CDF (ex: "1 250 000 CDF")
export function formatCdf(amount: number): string {
  return new Intl.NumberFormat('fr-CD', {
    style: 'currency',
    currency: 'CDF',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

// Formate un prix en EUR
export function formatEur(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount)
}

// Retourne la couleur CSS selon la variation de prix
export function getPriceChangeColor(changePct: number): string {
  if (changePct > 0) return 'text-red-600'
  if (changePct < 0) return 'text-green-600'
  return 'text-gray-500'
}
