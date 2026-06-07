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
