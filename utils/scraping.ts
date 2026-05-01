// Utilitaires communs pour le scraping

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xhtml+xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
}

// Fetch HTTP avec retry automatique (x3)
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = 3
): Promise<Response> {
  let lastError: Error = new Error('Unknown error')

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          ...DEFAULT_HEADERS,
          ...(options.headers ?? {}),
        },
      })

      if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`)
      return res
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < retries) {
        // Attente exponentielle : 1s, 2s, 4s
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)))
      }
    }
  }

  throw lastError
}

// Télécharge une image depuis une URL et retourne le Buffer
export async function downloadImage(
  imageUrl: string,
  cookies?: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const headers: Record<string, string> = { ...DEFAULT_HEADERS }
  if (cookies) headers['Cookie'] = cookies

  const res = await fetchWithRetry(imageUrl, { headers })
  const contentType = res.headers.get('content-type') ?? 'image/jpeg'
  const arrayBuffer = await res.arrayBuffer()

  return { buffer: Buffer.from(arrayBuffer), contentType }
}

// Extrait le nom de fichier d'une URL image
export function getImageFilename(imageUrl: string, reference: string): string {
  const ext = imageUrl.match(/\.(jpg|jpeg|png|webp|gif)/i)?.[1] ?? 'jpg'
  const cleanRef = reference.replace(/[^a-zA-Z0-9-_]/g, '_')
  return `${cleanRef}.${ext}`
}
