import type { RetrievedRef } from '@/lib/types'
import { fetchWithRetry } from './http'

// PubMed E-utilities (free; biomedical — critical for the serum/안약 device).
// No key required; PUBMED_API_KEY raises the rate limit if set.
const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const TOOL = 'patent-ai'
const EMAIL = process.env.NCBI_EMAIL || 'patent-ai@example.com'

function politeParams(url: URL) {
  url.searchParams.set('tool', TOOL)
  url.searchParams.set('email', EMAIL)
  const key = process.env.PUBMED_API_KEY
  if (key) url.searchParams.set('api_key', key)
}

export async function searchPubmed(query: string, retmax = 15): Promise<RetrievedRef[]> {
  if (!query.trim()) return []

  // 1) esearch → relevant PMIDs
  const esearch = new URL(`${EUTILS}/esearch.fcgi`)
  esearch.searchParams.set('db', 'pubmed')
  esearch.searchParams.set('term', query)
  esearch.searchParams.set('retmax', String(retmax))
  esearch.searchParams.set('retmode', 'json')
  esearch.searchParams.set('sort', 'relevance')
  politeParams(esearch)

  const sRes = await fetchWithRetry(esearch, { headers: { 'User-Agent': TOOL } })
  if (!sRes.ok) return []
  const sJson = await sRes.json()
  const ids: string[] = sJson?.esearchresult?.idlist ?? []
  if (ids.length === 0) return []

  // 2) efetch → titles + abstracts (XML)
  const efetch = new URL(`${EUTILS}/efetch.fcgi`)
  efetch.searchParams.set('db', 'pubmed')
  efetch.searchParams.set('id', ids.join(','))
  efetch.searchParams.set('retmode', 'xml')
  politeParams(efetch)

  const fRes = await fetchWithRetry(efetch, { headers: { 'User-Agent': TOOL } })
  if (!fRes.ok) return []
  return parsePubmedXml(await fRes.text())
}

// Minimal, dependency-free XML extraction. Robust enough for MVP; swap for a real
// XML parser if PubMed markup edge-cases surface.
function parsePubmedXml(xml: string): RetrievedRef[] {
  const refs: RetrievedRef[] = []
  const articles = xml.split('<PubmedArticle>').slice(1)
  for (const block of articles) {
    const pmid = first(block, /<PMID[^>]*>(\d+)<\/PMID>/)
    if (!pmid) continue
    // Tolerate attributes (book/part records) and fall back to a vernacular (non-English)
    // title so those refs keep their title (and its 2× ranking weight) instead of dropping it.
    const title = clean(
      first(block, /<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/) ||
        first(block, /<VernacularTitle[^>]*>([\s\S]*?)<\/VernacularTitle>/),
    )
    const abstract = clean(
      [...block.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)]
        .map((m) => m[1])
        .join(' '),
    )
    const year = first(block, /<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/) ||
      first(block, /<MedlineDate>(\d{4})/)
    const langRaw = first(block, /<Language>([a-z]{2,3})<\/Language>/)
    // DOI(있으면) — OpenAlex 결과와 교차 dedup용. ArticleId 우선, 없으면 ELocationID.
    const doi = (
      first(block, /<ArticleId IdType="doi">([^<]+)<\/ArticleId>/i) ||
      first(block, /<ELocationID EIdType="doi"[^>]*>([^<]+)<\/ELocationID>/i)
    )
      ?.trim()
      .toLowerCase()
    refs.push({
      source: 'pubmed',
      ext_id: pmid,
      doi,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      pub_date: year ? `${year}-01-01` : undefined,
      lang: langRaw === 'eng' ? 'en' : langRaw || 'en',
      title: title || undefined,
      abstract: abstract || undefined,
    })
  }
  return refs
}

function first(s: string, re: RegExp): string | undefined {
  return s.match(re)?.[1]
}

function clean(s?: string): string {
  if (!s) return ''
  return s
    .replace(/<[^>]+>/g, ' ') // strip inline tags (<i>, <sup>, ...)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}
