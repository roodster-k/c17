/**
 * lib/scrapers/sligro.ts
 *
 * Scraper Sligro.be :
 * 1. Login → JWT via /api/user/sligro-ispc-as400/fr-BE/login
 * 2. Catégories via /api/user/sligro-ispc-as400/fr-BE/categories/hierarchy
 * 3. Page catégorie (SSR HTML) → extraction codes + noms via data-code
 * 4. Prix via /api/cart/sligro-ispc-as400/customerorganizationdatas
 */

const BASE = 'https://www.sligro.be'
const STORE_ID = 'sligro-ispc-as400'
const LANG = 'fr-BE'

export interface SligroProduct {
  code: string
  name: string
  brand: string
  contentDescription: string
  categoryId: string
  categoryName: string
  priceEur: number | null
  salesUnit: string
  purchasable: boolean
  sourceUrl: string
  imageUrl: string | null
  poidsKg: number | null
}

// ─── Auth ──────────────────────────────────────────────────

interface SligroAuthResult {
  accessToken: string
  houseId: string
}

/**
 * Login via l'API JWT Sligro (sans navigateur).
 * Format découvert par analyse réseau du formulaire de connexion.
 */
export async function loginSligro(): Promise<SligroAuthResult> {
  const email = process.env.SLIGRO_EMAIL ?? ''
  const password = process.env.SLIGRO_PASSWORD

  if (!email || !password) {
    throw new Error('SLIGRO_EMAIL et SLIGRO_PASSWORD manquants')
  }

  // Sligro strips spaces from username in the form
  const username = email.replace(/\s+/g, '')

  const loginRes = await fetch(`${BASE}/api/user/${STORE_ID}/${LANG}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'x-sligro-language': LANG,
      'Referer': `${BASE}/fr/connexion.html`,
      'Origin': BASE,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({
      cookies: {
        currentConsent: {
          functional: true,
          analytical: true,
          advertising: true,
          personalisation: true,
          socialMedia: true,
        }
      },
      username,
      password,
      rememberMe: false,
    }),
  })

  if (!loginRes.ok) {
    const text = await loginRes.text()
    throw new Error(`Login Sligro échoué: ${loginRes.status} — ${text.slice(0, 200)}`)
  }

  const data = await loginRes.json()
  if (!data.access_token) {
    throw new Error(`Login Sligro: pas de access_token. Réponse: ${JSON.stringify(data).slice(0, 200)}`)
  }

  // Get houseId from user details
  const houseId = await getSligroHouseId(data.access_token)

  return { accessToken: data.access_token, houseId }
}

/**
 * Récupère le mainHouseId (ID de l'organisation cliente) depuis l'API user
 */
async function getSligroHouseId(token: string): Promise<string> {
  try {
    const res = await fetch(`${BASE}/api/user/${STORE_ID}/${LANG}/users/current`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    })
    if (res.ok) {
      const data = await res.json()
      const orgId = data?.data?.customerOrganisationId || data?.customerOrganisationId
      if (orgId) return String(orgId)
    }
  } catch {}

  // Fallback: get from org details
  try {
    const orgRes = await fetch(`${BASE}/api/user/${STORE_ID}/${LANG}/users/customerorganization`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    })
    if (orgRes.ok) {
      const data = await orgRes.json()
      const orgId = data?.data?.uid || data?.uid || data?.data?.id
      if (orgId) return String(orgId)
    }
  } catch {}

  // Known fallback for this account
  return '116990'
}

function extractCookies(setCookieHeader: string): string {
  return setCookieHeader.split(',')
    .map(c => c.split(';')[0].trim())
    .filter(c => c.includes('='))
    .join('; ')
}

// ─── Categories ────────────────────────────────────────────

export interface SligroCategory {
  id: string
  name: string
  numberOfProducts: number
  slug: string  // URL suffix (fr-BE)
}

export async function getSligroCategories(token: string): Promise<SligroCategory[]> {
  const [hierarchyRes, ] = await Promise.all([
    fetch(`${BASE}/api/user/${STORE_ID}/${LANG}/categories/hierarchy`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    })
  ])

  if (!hierarchyRes.ok) throw new Error(`Categories API: ${hierarchyRes.status}`)

  const data = await hierarchyRes.json()
  const subcats = data?.data?.categoriesHierarchyResponse?.subcategories ?? []

  // Get slug for each category
  const categories = await Promise.all(
    subcats.map(async (cat: { id: string; name: string; numberOfProducts: number }) => {
      const slugRes = await fetch(
        `${BASE}/api/product-overview/${STORE_ID}/categories/${cat.id}/suffix/fr-BE`,
        { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'text/plain' } }
      )
      const slug = slugRes.ok ? (await slugRes.text()).replace(/^\//, '').replace(/\.html$/, '') : cat.name.toLowerCase()
      return { ...cat, slug }
    })
  )

  return categories
}

// ─── Product Scraping ──────────────────────────────────────

/**
 * Extrait les produits d'une page catégorie Sligro.
 * La page est rendue côté serveur (SSR/AEM), les codes sont dans data-code.
 */
export async function scrapeCategory(
  token: string,
  category: SligroCategory,
  houseId: string,
  maxProducts = 200
): Promise<SligroProduct[]> {
  const catUrl = `${BASE}/fr/c.${category.id}.html/${category.slug}.html`
  const allProducts: SligroProduct[] = []
  let currentPage = 0

  while (allProducts.length < maxProducts) {
    const pageUrl = currentPage === 0 ? catUrl : `${catUrl}?currentPage=${currentPage}`

    const html = await fetchCategoryPage(token, pageUrl)
    if (!html) break

    // Extract product data from SSR HTML
    const { products, hasMore } = extractProductsFromHtml(html, category, currentPage)
    if (products.length === 0) break

    // Get prices for this batch
    const codes = products.map(p => p.code)
    const prices = await getProductPrices(token, codes, houseId)

    // Merge prices into products
    for (const product of products) {
      const priceData = prices[product.code]
      const contentDesc = priceData?.contentDescription || product.contentDescription
      allProducts.push({
        ...product,
        priceEur: priceData?.price ?? null,
        contentDescription: contentDesc,
        salesUnit: priceData?.salesUnit || product.salesUnit,
        purchasable: priceData?.purchasable ?? true,
        poidsKg: product.poidsKg ?? parsePoidsKg(contentDesc),
      })
    }

    if (!hasMore || allProducts.length >= maxProducts) break
    currentPage++

    // Rate limiting
    await sleep(500)
  }

  return allProducts
}

async function fetchCategoryPage(token: string, url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Cookie': `xt=${token}`,  // Sligro uses xt cookie for session
      }
    })
    if (!res.ok) return null
    return res.text()
  } catch {
    return null
  }
}

interface ParsedProduct {
  code: string
  name: string
  brand: string
  contentDescription: string
  salesUnit: string
  sourceUrl: string
  categoryId: string
  categoryName: string
  purchasable: boolean
  priceEur: null
  imageUrl: string | null
  poidsKg: number | null
}

function extractProductsFromHtml(
  html: string,
  category: SligroCategory,
  page: number
): { products: ParsedProduct[]; hasMore: boolean } {
  const products: ParsedProduct[] = []

  // Each product block starts with data-code="XXXXX"
  // We split the page into per-product blocks first, then parse each
  const productRegex = /data-code="(\d{4,7})"[^>]*>([\s\S]*?)(?=data-code="\d{4,7}"|<\/section>|$)/g
  let match

  while ((match = productRegex.exec(html)) !== null) {
    const code = match[1]
    const block = match[2]

    // ── Brand (dedicated anchor element)
    const brandMatch = block.match(/class="[^"]*cmp-productoverview-product-info-name__brand[^"]*"[^>]*>([\s\S]*?)<\/a>/)
    const brand = brandMatch ? cleanText(brandMatch[1]) : ''

    // ── Product name (h5 inside the name anchor)
    const nameMatch = block.match(/class="[^"]*cmp-productoverview-product-info-name__name[^"]*"[^>]*>[\s\S]*?<h5[^>]*>([\s\S]*?)<\/h5>/)
    const name = nameMatch ? cleanText(nameMatch[1]) : brand

    // ── Image URL (sligro image-service CDN)
    const imgMatch = block.match(/src="(https:\/\/www\.sligro\.be\/fr\/image-service\/[^"]+)"/)
    const imageUrl = imgMatch ? imgMatch[1] : null

    // ── Content description (weight/volume/pack info)
    const descMatch = block.match(/class="[^"]*cmp-productoverview-product-info-content-description[^"]*"[^>]*>([\s\S]*?)<\/div>/)
    const contentDescription = descMatch ? cleanText(descMatch[1]) : ''

    // ── Product detail URL
    const urlMatch = block.match(/href="(\/fr\/p\.[^"]+)"/)
    const sourceUrl = urlMatch ? BASE + urlMatch[1] : `${BASE}/fr/c.${category.id}.html`

    if (code && (brand || name)) {
      products.push({
        code,
        name: name || brand,
        brand,
        contentDescription,
        salesUnit: '',
        sourceUrl,
        categoryId: category.id,
        categoryName: category.name,
        purchasable: true,
        priceEur: null,
        imageUrl,
        poidsKg: parsePoidsKg(contentDescription),
      })
    }
  }

  // Check if there's a next page
  const hasMore = html.includes(`currentPage=${page + 1}`) ||
    html.includes('cmp-productoverview--next') ||
    (products.length >= 24 && !html.includes('no-more-products'))

  return { products, hasMore }
}

// ─── Price API ─────────────────────────────────────────────

interface PriceData {
  price: number | null
  contentDescription: string
  salesUnit: string
  purchasable: boolean
}

async function getProductPrices(
  token: string,
  codes: string[],
  houseId: string
): Promise<Record<string, PriceData>> {
  const priceMap: Record<string, PriceData> = {}
  const BATCH_SIZE = 8

  for (let i = 0; i < codes.length; i += BATCH_SIZE) {
    const batch = codes.slice(i, i + BATCH_SIZE)
    const codesParam = batch.join('%2C')

    try {
      const res = await fetch(
        `${BASE}/api/cart/${STORE_ID}/customerorganizationdatas?productCodes=${codesParam}&mainHouseId=${houseId}`,
        {
          headers: {
            // Sligro requires token BOTH as Bearer AND as cookie for price access
            'Authorization': `Bearer ${token}`,
            'Cookie': `access_token=${token}`,
            'x-sligro-language': LANG,
            'Accept': 'application/json',
          }
        }
      )

      if (!res.ok) continue

      const data = await res.json()
      const products = data?.data?.products ?? []

      for (const p of products) {
        priceMap[p.code] = {
          price: p.price?.value ?? null,
          contentDescription: p.contentDescription || '',
          salesUnit: p.salesUnit?.name || '',
          purchasable: p.purchasable ?? true,
        }
      }
    } catch {
      // Skip batch on error
    }

    await sleep(200)
  }

  return priceMap
}

// ─── Helpers ───────────────────────────────────────────────

/**
 * Parse a content description string and returns weight in kg.
 * Examples: "500g" → 0.5 | "1.5kg" → 1.5 | "6x33cl" → 0.198 | "1L" → 1.0 | "250ml" → 0.25
 */
export function parsePoidsKg(desc: string): number | null {
  if (!desc) return null
  const s = desc.toLowerCase().trim()

  // kg: "1.5kg", "2 kg"
  const kgMatch = s.match(/(\d+(?:[.,]\d+)?)\s*kg/)
  if (kgMatch) return parseFloat(kgMatch[1].replace(',', '.'))

  // g: "500g", "250 g"
  const gMatch = s.match(/(\d+(?:[.,]\d+)?)\s*g(?!al)/)
  if (gMatch) return parseFloat(gMatch[1].replace(',', '.')) / 1000

  // L: "1l", "1.5 l", "1L"
  const lMatch = s.match(/(\d+(?:[.,]\d+)?)\s*l(?!b)(?:iter|itre)?(?:\b|$)/)
  if (lMatch) return parseFloat(lMatch[1].replace(',', '.'))

  // cl: "33cl" → 0.33L
  const clMatch = s.match(/(\d+(?:[.,]\d+)?)\s*cl/)
  if (clMatch) return parseFloat(clMatch[1].replace(',', '.')) / 100

  // ml: "250ml" → 0.25L
  const mlMatch = s.match(/(\d+(?:[.,]\d+)?)\s*ml/)
  if (mlMatch) return parseFloat(mlMatch[1].replace(',', '.')) / 1000

  // packs: "6x33cl" → 6 * 0.33 = 1.98 — use the last unit found after "x"
  const packMatch = s.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|l|cl|ml)/)
  if (packMatch) {
    const qty = parseInt(packMatch[1])
    const val = parseFloat(packMatch[2].replace(',', '.'))
    const unit = packMatch[3]
    if (unit === 'kg') return qty * val
    if (unit === 'g') return qty * val / 1000
    if (unit === 'l') return qty * val
    if (unit === 'cl') return qty * val / 100
    if (unit === 'ml') return qty * val / 1000
  }

  return null
}

function cleanText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x26;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
