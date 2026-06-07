import type { GraceInfo } from '@/lib/types'

const MS_PER_DAY = 86_400_000

// KIPO §30 grace period: if an invention was publicly disclosed by the applicant,
// a patent application within 12 months may still be saved from losing novelty.
// Pure function (no I/O) so it runs identically on the client (live banner) and
// the server (persisted check). NOTE: this is a deadline aid, not legal advice —
// §30 has formal requirements a 변리사 must confirm.
export function computeGrace(disclosed: boolean, disclosureDate?: string | null): GraceInfo {
  if (!disclosed || !disclosureDate) return { disclosed: !!disclosed }

  // Parse the date-only value at UTC midnight (note the trailing Z). This runs in
  // the Korean client's browser (UTC+9); without UTC the local-parse/UTC-format
  // mismatch shifted the deadline one calendar day and could flag a still-valid
  // §30 window as expired. All §30 math below is UTC so it is timezone-stable.
  const d = new Date(`${disclosureDate}T00:00:00Z`)
  if (isNaN(d.getTime())) return { disclosed: true }

  // §30: disclosure + 12 months (UTC month arithmetic handles year rollover).
  const deadline = new Date(d)
  deadline.setUTCMonth(deadline.getUTCMonth() + 12)

  // Whole-day remaining count with both endpoints floored to UTC midnight, so the
  // banner cannot be off by a partial day.
  const now = new Date()
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const deadlineUTC = Date.UTC(
    deadline.getUTCFullYear(),
    deadline.getUTCMonth(),
    deadline.getUTCDate(),
  )
  const daysRemaining = Math.round((deadlineUTC - todayUTC) / MS_PER_DAY)

  return {
    disclosed: true,
    disclosure_date: disclosureDate,
    grace_deadline: deadline.toISOString().slice(0, 10),
    days_remaining: daysRemaining,
    expired: daysRemaining < 0,
  }
}
