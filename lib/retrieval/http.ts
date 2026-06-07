// Shared fetch for the free retrieval adapters (PubMed/OpenAlex).
// Two guarantees the bare fetch lacked:
//  1) a hard TIMEOUT — a hung upstream that accepts the socket but never responds
//     would otherwise pend forever, consuming the whole 60s route budget and never
//     triggering the callers' `.catch(() => [])` graceful-degradation path.
//  2) one bounded RETRY on 429 / 5xx — transient rate limits no longer silently
//     collapse a legitimate query to zero results.
// On final failure this rejects, so the caller's `.catch` converts it to [].

const DEFAULT_TIMEOUT_MS = 8000
const MAX_RETRY_DELAY_MS = 2000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchWithRetry(
  url: URL | string,
  init: RequestInit = {},
  { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 1 }: { timeoutMs?: number; retries?: number } = {},
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after'))
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500
        await delay(Math.min(wait, MAX_RETRY_DELAY_MS))
        continue
      }
      return res
    } catch (e) {
      if (attempt >= retries) throw e
      await delay(500)
    }
  }
}
