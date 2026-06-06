import type { GraceInfo } from '@/lib/types'

const MS_PER_DAY = 86_400_000

// KIPO §30 grace period: if an invention was publicly disclosed by the applicant,
// a patent application within 12 months may still be saved from losing novelty.
// Pure function (no I/O) so it runs identically on the client (live banner) and
// the server (persisted check). NOTE: this is a deadline aid, not legal advice —
// §30 has formal requirements a 변리사 must confirm.
export function computeGrace(disclosed: boolean, disclosureDate?: string | null): GraceInfo {
  if (!disclosed || !disclosureDate) return { disclosed: !!disclosed }

  const d = new Date(`${disclosureDate}T00:00:00`)
  if (isNaN(d.getTime())) return { disclosed: true }

  const deadline = new Date(d)
  deadline.setMonth(deadline.getMonth() + 12)

  const today = new Date()
  const daysRemaining = Math.floor((deadline.getTime() - today.getTime()) / MS_PER_DAY)

  return {
    disclosed: true,
    disclosure_date: disclosureDate,
    grace_deadline: deadline.toISOString().slice(0, 10),
    days_remaining: daysRemaining,
    expired: daysRemaining < 0,
  }
}
