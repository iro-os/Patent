import type { RetrievedRef } from '@/lib/types'
import { fetchWithRetry } from './http'

// OpenAlex (free; broad academic coverage). The polite pool wants a mailto.
const API = 'https://api.openalex.org/works'
const MAILTO = process.env.OPENALEX_MAILTO || process.env.NCBI_EMAIL || 'patent-ai@example.com'

interface OpenAlexWork {
  id?: string
  doi?: string
  display_name?: string
  publication_date?: string
  language?: string
  abstract_inverted_index?: Record<string, number[]>
  primary_location?: { landing_page_url?: string }
}

export async function searchOpenAlex(query: string, perPage = 15): Promise<RetrievedRef[]> {
  if (!query.trim()) return []
  const url = new URL(API)
  url.searchParams.set('search', query)
  url.searchParams.set('per_page', String(perPage))
  url.searchParams.set('mailto', MAILTO)

  const res = await fetchWithRetry(url, {
    headers: { 'User-Agent': `patent-ai (mailto:${MAILTO})` },
  })
  if (!res.ok) return []
  const json = await res.json()
  const results: OpenAlexWork[] = json?.results ?? []

  return results.map((w): RetrievedRef => {
    const extId = (w.id ?? '').replace('https://openalex.org/', '') || (w.id ?? '')
    const doi = w.doi ? w.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase() : undefined
    return {
      source: 'openalex',
      ext_id: extId,
      doi,
      url: w.doi || w.primary_location?.landing_page_url || w.id,
      pub_date: w.publication_date, // already YYYY-MM-DD
      lang: w.language,
      title: w.display_name,
      abstract: reconstructAbstract(w.abstract_inverted_index),
    }
  })
}

// OpenAlex returns abstracts as an inverted index {word: [positions]} for copyright
// reasons; rebuild the running text by placing each word at its positions.
function reconstructAbstract(inv?: Record<string, number[]>): string | undefined {
  if (!inv) return undefined
  const words: string[] = []
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions) words[p] = word
  }
  const text = words.filter(Boolean).join(' ').trim()
  return text || undefined
}
