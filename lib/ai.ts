import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

export interface ScrapedProduct {
  nom: string
  reference: string
  prix_eur: number
  categorie: string
  url_image: string
  url_source: string
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

  const prompt = `Tu es un extracteur de données produits. Analyse le HTML suivant du site fournisseur "${supplier}" et extrait tous les produits visibles.

Retourne UNIQUEMENT un tableau JSON valide avec cette structure exacte, sans aucun texte avant ou après :
[
  {
    "nom": "Nom complet du produit",
    "reference": "SKU ou référence unique du produit",
    "prix_eur": 12.50,
    "categorie": "Catégorie du produit",
    "url_image": "URL absolue de l'image produit",
    "url_source": "URL absolue de la page du produit"
  }
]

Règles :
- prix_eur doit être un nombre décimal (ex: 12.50), jamais une string
- Si l'URL image est relative, la rendre absolue avec la base : ${baseUrl}
- Si une valeur est manquante, utilise une string vide "" (jamais null)
- N'invente aucune donnée, extrait uniquement ce qui est visible dans le HTML

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
