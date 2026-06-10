// Structural grounding (consensus plan P0-3, lightweight form).
// The model receives prior-art as a numbered list [1..max] and may cite ONLY those
// numbers. After generation we drop any reference number outside the allow-list, so
// a hallucinated citation can never reach the dossier.

export function isAllowedRef(n: unknown, max: number): boolean {
  const v = typeof n === 'number' ? n : parseInt(String(n), 10)
  return Number.isInteger(v) && v >= 1 && v <= max
}

// Coerce + filter a list of cited ref numbers to the unique, in-range subset.
export function allowedRefNumbers(ns: unknown, max: number): number[] {
  if (!Array.isArray(ns)) return []
  const out: number[] = []
  for (const x of ns) {
    const v = typeof x === 'number' ? x : parseInt(String(x), 10)
    if (Number.isInteger(v) && v >= 1 && v <= max && !out.includes(v)) out.push(v)
  }
  return out
}

// Body-prose grounding (P0-A): generated 명세서 sections may carry inline citation
// markers like [1][3]. Strip any marker whose number is outside the closed allow-list
// (1..max) so a hallucinated [99] can NEVER reach the persisted document. Returns the
// cleaned text plus the unique, in-range numbers that actually survived (for chips).
export function sanitizeRefMarkers(text: string, max: number): { text: string; cited: number[] } {
  const cited = new Set<number>()
  const cleaned = (text ?? '').replace(/\[(\d{1,3})\]/g, (marker, digits) => {
    const n = parseInt(digits, 10)
    if (Number.isInteger(n) && n >= 1 && n <= max) {
      cited.add(n)
      return marker // keep valid citation
    }
    return '' // drop fabricated / out-of-range marker
  })
  return { text: cleaned, cited: [...cited].sort((a, b) => a - b) }
}
