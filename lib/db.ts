import type { PostgrestError } from '@supabase/supabase-js'

// Centralized guard for Supabase writes. PostgREST returns `{ error }` instead of
// throwing, so an unchecked write silently no-ops — and a failed insert can be
// reported to the user as success (a real trust hazard for a legal-document tool).
// `must()` turns a write failure into a thrown PersistError that route handlers map
// to a stable 500 code. The raw DB message is logged server-side only (never echoed
// to the client, which would leak table/column/constraint names).
export class PersistError extends Error {
  constructor(
    public label: string,
    public detail?: string,
  ) {
    super(`persist failed: ${label}`)
    this.name = 'PersistError'
  }
}

// Throw if a Supabase write returned an error. Pass the awaited result directly:
//   must(await supabase.from('x').insert(row), 'x insert')
export function must(res: { error: PostgrestError | null }, label: string): void {
  if (res.error) {
    console.error(`db write failed [${label}]:`, res.error.message)
    throw new PersistError(label, res.error.message)
  }
}
