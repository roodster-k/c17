import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

export interface ScrapedProduct {
  nom: string
  reference: string
  prix_eur: number
  categorie: string
  url_image: string
  url_source: string
  brand: string
  content_description: string   // ex: "500g", "1L x 6", "250ml"
  poids_kg: number | null       // poids extrait en kg (ex: 0.5)
  unite: string                  // unité de vente (ex: "pièce", "carton", "pack")
}

// Nettoie le HTML brut pour réduire les tokens envoyés à Gemini
export function cleanHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// Envoie le HTML nettoyé à Gemini et retourne les produits extraits
export async function extractProductsWithAI(
  html: string,
  supplier: string,
  baseUrl: string
): Promise<ScrapedProduct[]> {
  const cleanedHtml = cleanHtml(html)
  const truncatedHtml = cleanedHtml.slice(0, 80000)

  const prompt = `Tu es un extracteur de données produits B2B. Analyse le HTML suivant du site fournisseur "${supplier}" et extrait TOUS les produits visibles.

Retourne UNIQUEMENT un tableau JSON valide avec cette structure exacte, sans aucun texte avant ou après :
[
  {
    "nom": "Nom complet du produit sans la marque",
    "brand": "Marque du produit (ex: Coca-Cola, Nestlé)",
    "reference": "SKU ou code article unique du produit",
    "prix_eur": 12.50,
    "categorie": "Catégorie du produit",
    "content_description": "Contenu/poids du produit tel qu'affiché (ex: '500g', '1L', '6x33cl', '250ml x 24')",
    "poids_kg": 0.5,
    "unite": "Unité de vente (ex: pièce, carton, pack, bouteille, boîte)",
    "url_image": "URL absolue de l'image produit",
    "url_source": "URL absolue de la page produit"
  }
]

Règles importantes :
- prix_eur doit être un nombre décimal (ex: 12.50), JAMAIS une string ni null — utilise 0 si absent
- poids_kg doit être un nombre en kilogrammes (ex: 0.5 pour 500g, 1.5 pour 1.5kg) ou null si inconnu
- Si l'URL image est relative, la rendre absolue avec la base : ${baseUrl}
- Si une valeur est manquante, utilise une string vide "" (sauf poids_kg qui est null)
- N'invente aucune donnée, extrait uniquement ce qui est visible dans le HTML
- Inclus chaque produit visible même si certains champs sont manquants
- La marque (brand) est souvent affichée séparément du nom du produit

HTML à analyser :
${truncatedHtml}`

  const result = await model.generateContent(prompt)
  const text = result.response.text()

  // Extrait le JSON même si Gemini ajoute du texte autour
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error('Aucun JSON trouvé dans la réponse Gemini')

  const products: ScrapedProduct[] = JSON.parse(jsonMatch[0])
  return products
}
