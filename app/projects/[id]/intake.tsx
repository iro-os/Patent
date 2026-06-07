'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { computeGrace } from '@/lib/kipo/disclosure'

interface DebriefRow {
  title_guess: string | null
  tech_summary: string | null
  problem: string | null
  differentiators: string | null
  ipc_candidates: string[] | null
  missing_items: string[] | null
}

interface ClarifyingRow {
  id: string
  question: string
  options: string[]
  answer: string | null
}

interface DisclosureRow {
  disclosed: boolean
  disclosure_date: string | null
}

export function IntakeView({
  projectId,
  initialDebrief,
  initialClarifying,
  initialDisclosure,
}: {
  projectId: string
  initialDebrief: DebriefRow | null
  initialClarifying: ClarifyingRow[]
  initialDisclosure: DisclosureRow | null
}) {
  const router = useRouter()
  const [ideaText, setIdeaText] = useState('')
  const [debrief, setDebrief] = useState<DebriefRow | null>(initialDebrief)
  const [clarifying, setClarifying] = useState<ClarifyingRow[]>(initialClarifying)
  const [answers, setAnswers] = useState<Record<string, string>>(
    Object.fromEntries(initialClarifying.filter((q) => q.answer).map((q) => [q.id, q.answer as string])),
  )
  const [disclosed, setDisclosed] = useState<boolean | null>(
    initialDisclosure ? initialDisclosure.disclosed : null,
  )
  const [disclosureDate, setDisclosureDate] = useState(initialDisclosure?.disclosure_date ?? '')
  const [debriefLoading, setDebriefLoading] = useState(false)
  const [researchLoading, setResearchLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const grace = disclosed ? computeGrace(true, disclosureDate || null) : null

  const runDebrief = async () => {
    if (!ideaText.trim()) return
    setDebriefLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ideaText }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.message ?? json.error ?? '디브리프 생성 실패')
        return
      }
      setDebrief(json.debrief)
      setClarifying(json.clarifying ?? [])
    } catch (e) {
      setError(String(e))
    } finally {
      setDebriefLoading(false)
    }
  }

  const runResearch = async () => {
    setResearchLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/research/fast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          disclosed: disclosed ?? false,
          disclosureDate: disclosed ? disclosureDate || null : null,
          answers,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.message ?? json.error ?? '리서치 실패')
        setResearchLoading(false)
        return
      }
      router.refresh() // server now renders the report
    } catch (e) {
      setError(String(e))
      setResearchLoading(false)
    }
  }

  // ── Stage 1: raw idea input ────────────────────────────────────────────────
  if (!debrief) {
    return (
      <div>
        <label className="text-sm font-medium">발명 아이디어를 설명해 주세요</label>
        <p className="mt-1 text-xs text-neutral-400">
          핵심 기술, 해결하려는 문제, 기존 방식과의 차이를 자유롭게 적어주세요. 자세할수록 좋습니다.
        </p>
        <textarea
          value={ideaText}
          onChange={(e) => setIdeaText(e.target.value)}
          rows={12}
          placeholder="예) 혈청으로 만든 안약을 안경 형태로 착용하여 안구에 지속 전달하는 장치…"
          className="mt-3 w-full rounded-lg border border-neutral-300 bg-transparent p-4 text-sm leading-relaxed outline-none focus:border-neutral-500 dark:border-neutral-700"
        />
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        <button
          onClick={runDebrief}
          disabled={debriefLoading || !ideaText.trim()}
          className="mt-4 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {debriefLoading ? 'AI가 분석 중…' : '디브리프 생성'}
        </button>
      </div>
    )
  }

  // ── Stage 2: debrief + clarifying + disclosure + research CTA ───────────────
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm font-semibold text-neutral-500">AI가 이해한 내용</h2>
        <div className="mt-3 space-y-3 rounded-xl border border-neutral-200 p-5 text-sm dark:border-neutral-800">
          <Field label="추정 발명의 명칭" value={debrief.title_guess} />
          <Field label="핵심 기술 요지" value={debrief.tech_summary} />
          <Field label="해결하고자 하는 과제" value={debrief.problem} />
          <Field label="핵심 차별 요소(가설)" value={debrief.differentiators} />
          <Field
            label="기술분야 / IPC 후보"
            value={debrief.ipc_candidates?.length ? debrief.ipc_candidates.join(', ') : null}
          />
          {debrief.missing_items && debrief.missing_items.length > 0 && (
            <div>
              <p className="text-xs font-medium text-amber-600">누락·불명확 항목</p>
              <ul className="mt-1 list-inside list-disc text-neutral-500">
                {debrief.missing_items.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          인라인 수정·채팅 보정은 문서 생성 단계(Phase 2)에서 추가됩니다.
        </p>
      </section>

      {clarifying.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-neutral-500">확인이 필요한 항목</h2>
          <div className="mt-3 space-y-5">
            {clarifying.map((q) => (
              <div key={q.id}>
                <p className="text-sm font-medium">{q.question}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {q.options.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setAnswers((a) => ({ ...a, [q.id]: opt }))}
                      className={`rounded-full border px-3 py-1.5 text-xs transition ${
                        answers[q.id] === opt
                          ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
                          : 'border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-neutral-500">
          공개 여부 (신규성·유예기간 §30)
        </h2>
        <p className="mt-1 text-xs text-neutral-400">
          출원 전 공개(논문·발표·판매·전시 등)는 신규성을 잃게 할 수 있습니다. 한국은 공개 후 12개월
          이내 출원 시 §30 유예를 받을 수 있습니다.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setDisclosed(false)}
            className={`rounded-full border px-3 py-1.5 text-xs transition ${
              disclosed === false
                ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
                : 'border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900'
            }`}
          >
            아니오 (미공개)
          </button>
          <button
            onClick={() => setDisclosed(true)}
            className={`rounded-full border px-3 py-1.5 text-xs transition ${
              disclosed === true
                ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
                : 'border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900'
            }`}
          >
            예 (이미 공개함)
          </button>
        </div>

        {disclosed && (
          <div className="mt-3">
            <label className="text-xs text-neutral-500">최초 공개일</label>
            <input
              type="date"
              value={disclosureDate}
              onChange={(e) => setDisclosureDate(e.target.value)}
              className="ml-2 rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-xs dark:border-neutral-700"
            />
            {!disclosureDate && (
              <p className="mt-2 text-xs text-amber-600">
                최초 공개일을 입력하면 §30 유예기간(12개월)을 계산합니다. 미입력 시 유예 계산은
                생략됩니다.
              </p>
            )}
            {grace?.grace_deadline && (
              <div
                className={`mt-3 rounded-lg border p-3 text-xs ${
                  grace.expired
                    ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
                    : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
                }`}
              >
                §30 유예기간 마감: <strong>{grace.grace_deadline}</strong>{' '}
                {grace.expired
                  ? `— 이미 ${Math.abs(grace.days_remaining ?? 0)}일 경과 (유예기간 도과 가능성)`
                  : `— ${grace.days_remaining}일 남음`}
              </div>
            )}
          </div>
        )}
      </section>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="border-t border-neutral-200 pt-6 dark:border-neutral-800">
        <button
          onClick={runResearch}
          disabled={researchLoading}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60 dark:bg-white dark:text-neutral-900"
        >
          {researchLoading ? '선행기술 검색 중… (PubMed · OpenAlex)' : '심층 리서치 시작 (무료)'}
        </button>
        <p className="mt-2 text-xs text-neutral-400">
          무료 학술 DB(PubMed·OpenAlex)에서 전 세계 선행기술을 1차 검색합니다. 특허 DB·심층 루프는 예산
          확정 후 추가됩니다.
        </p>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium text-neutral-400">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-neutral-800 dark:text-neutral-200">
        {value || '—'}
      </p>
    </div>
  )
}
