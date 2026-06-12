'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { parseClaims, formatClaims } from '@/lib/claims/parse'
import { lintClaims, checkSupport, type LintIssue } from '@/lib/claims/lint'
import { runCompliance, type ComplianceResult, type ComplianceStatus } from '@/lib/kipo/compliance'
import type { CitationRef } from '@/lib/kipo/sections'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

// 검토 탭 (변리사 워크벤치) — ① 컴플라이언스 리포트(7종, 결정론) ② 청구항 에디터 + 라이브
// 린트. 파서·린터·컴플라이언스가 전부 순수 함수라 타이핑 즉시 클라이언트에서 재계산된다
// (LLM·서버 왕복 없음). 서버는 저장(PUT /api/claims) 시 같은 린터로 한 번 더 검증해 저장본의
// 진실을 만든다. 휴리스틱 룰은 "주의"까지만 — 확정 판단은 변리사라는 제품 철학을 UI에 명시.

const JSON_HEADERS = { 'Content-Type': 'application/json' }

const STATUS_META: Record<ComplianceStatus, { mark: string; cls: string; label: string }> = {
  pass: { mark: '✓', cls: 'text-emerald-600 dark:text-emerald-400', label: '통과' },
  warn: { mark: '⚠', cls: 'text-amber-600 dark:text-amber-400', label: '주의' },
  fail: { mark: '✕', cls: 'text-red-600 dark:text-red-400', label: '미충족' },
  na: { mark: '–', cls: 'text-neutral-400', label: '해당 없음' },
}

export function ReviewPane({
  projectId,
  sectionsMap,
  abstract,
  refs,
  initialClaimsText,
  onJump,
}: {
  projectId: string
  /** schema_key -> 현재 유효 본문 (manual_override ?? generated_text) */
  sectionsMap: Record<string, string>
  abstract: string | null
  refs: CitationRef[]
  /** 저장된 청구항을 표준 표기로 직렬화한 초기 텍스트 (없으면 '') */
  initialClaimsText: string
  /** 컴플라이언스 카드에서 본문 섹션으로 점프 (문서 탭 전환 + 스크롤) */
  onJump: (sectionKey: string) => void
}) {
  const router = useRouter()
  const [claimsText, setClaimsText] = useState(initialClaimsText)
  const [saving, setSaving] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const dirty = claimsText.trim() !== initialClaimsText.trim()

  // 라이브 린트 — 타이핑 즉시(결정론·무비용). 뒷받침 검사는 본문 전체를 대상으로.
  const specFull = useMemo(
    () => [...Object.values(sectionsMap), abstract ?? ''].filter(Boolean).join('\n'),
    [sectionsMap, abstract],
  )
  const live = useMemo(() => {
    const trimmed = claimsText.trim()
    if (!trimmed) return { claims: [], unrecognized: false, issues: [] as LintIssue[] }
    const { claims, empty } = parseClaims(trimmed)
    if (empty) return { claims, unrecognized: true, issues: [] as LintIssue[] }
    return { claims, unrecognized: false, issues: [...lintClaims(claims), ...checkSupport(claims, specFull)] }
  }, [claimsText, specFull])

  const errors = live.issues.filter((i) => i.severity === 'error')
  const warns = live.issues.filter((i) => i.severity === 'warn')

  // 컴플라이언스 — 에디터의 현재 텍스트 기준(저장 전이라도 검토 중인 내용을 반영).
  const compliance = useMemo(
    () =>
      runCompliance({
        sections: sectionsMap,
        abstract,
        claimsText: claimsText.trim() || null,
        refs,
      }),
    [sectionsMap, abstract, claimsText, refs],
  )

  const draftWithAI = async () => {
    if (claimsText.trim()) {
      const ok = window.confirm('에디터의 현재 청구항을 AI 초안으로 교체합니다. 계속할까요? (교체 직후 "이전으로"로 복원할 수 있습니다)')
      if (!ok) return
    }
    setDrafting(true)
    try {
      const r = await fetch('/api/claims/draft', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ projectId }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error('AI 초안 생성에 실패했습니다.', { description: j.message ?? '' })
        return
      }
      // 교체 전 텍스트를 잡아 두고 토스트 액션으로 1-step 복원 제공 — confirm 문구의
      // "되돌릴 수 있다"를 실제 동작으로 보증한다(프로그램적 setValue는 네이티브 undo를 지움).
      const prevText = claimsText
      setClaimsText(j.claimsText)
      toast.success(`청구항 초안 ${j.count}개 항을 제안했습니다.`, {
        description: j.basedOnBody
          ? '명세서 본문 용어에 ground된 초안입니다. 검토·수정 후 저장하세요.'
          : '⚠ 본문 미생성 상태의 보수적 초안입니다 — 본문 생성 후 재작성을 권장합니다.',
        action: prevText.trim()
          ? { label: '이전으로', onClick: () => setClaimsText(prevText) }
          : undefined,
        duration: 8000,
      })
    } catch {
      toast.error('AI 초안 생성 중 오류가 발생했습니다.')
    } finally {
      setDrafting(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      const r = await fetch('/api/claims', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ projectId, claimsText }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error('청구항 저장에 실패했습니다.', { description: j.message ?? '' })
        return
      }
      toast.success(j.count ? `청구항 ${j.count}개 항을 저장했습니다.` : '청구항을 비웠습니다.', {
        description: j.count ? '문서 탭과 DOCX의 【청구범위】에 반영됩니다.' : undefined,
      })
      // 저장본은 표준 표기(【청구항 N】)로 정규화되므로 에디터도 맞춰 둔다 — 안 그러면
      // "청구항 1." 식 입력이 refresh 후의 initialClaimsText와 어긋나 dirty가 남는다.
      const normalized = parseClaims(claimsText.trim())
      setClaimsText(normalized.claims.length ? formatClaims(normalized.claims) : '')
      router.refresh()
    } catch {
      toast.error('저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 p-4">
      <p className="rounded-lg bg-neutral-100 px-3 py-2 text-[11px] leading-relaxed text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
        자동 검사는 <strong>보조 도구</strong>입니다 — 확정 룰(시행령 §5)은 오류로, 휴리스틱(선행사·뒷받침·표현)은
        주의로만 표시하며, 최종 판단은 변리사의 몫입니다.
      </p>

      {/* ── 컴플라이언스 리포트 ─────────────────────────────────────── */}
      <section className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950/50">
        <header className="border-b border-neutral-200 px-3.5 py-2.5 dark:border-neutral-800">
          <h2 className="text-[13px] font-bold">컴플라이언스 검사</h2>
          <p className="mt-0.5 text-[11px] text-neutral-400">별지15호 형식 · §42 기재요건 · grounding — 7종 자동 점검</p>
        </header>
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-900">
          {compliance.map((r) => (
            <ComplianceRow key={r.check} result={r} onJump={onJump} />
          ))}
        </ul>
      </section>

      {/* ── 청구항 워크벤치 ────────────────────────────────────────── */}
      <section className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950/50">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-3.5 py-2.5 dark:border-neutral-800">
          <div>
            <h2 className="text-[13px] font-bold">청구항 워크벤치</h2>
            <p className="mt-0.5 text-[11px] text-neutral-400">
              {live.claims.length
                ? `${live.claims.length}개 항 · 오류 ${errors.length} · 주의 ${warns.length}`
                : '청구항을 작성하거나 AI 초안으로 시작하세요'}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={draftWithAI} disabled={drafting || saving}>
              {drafting ? '초안 생성 중…' : 'AI 초안 제안'}
            </Button>
            <Button size="sm" onClick={save} disabled={saving || drafting || !dirty || live.unrecognized}>
              {saving ? '저장 중…' : '저장'}
            </Button>
          </div>
        </header>

        <div className="p-3.5">
          <textarea
            value={claimsText}
            onChange={(e) => setClaimsText(e.target.value)}
            spellCheck={false}
            placeholder={'【청구항 1】\n본체와, 상기 본체에 결합된 센서를 포함하는 측정 장치.\n\n【청구항 2】\n제1항에 있어서, …'}
            className="min-h-[260px] w-full resize-y rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-[13px] leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-300 focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-600 dark:focus:border-neutral-600"
            aria-label="청구항 편집기"
          />
          {dirty && (
            <p className="mt-1.5 text-[11px] text-amber-600">저장되지 않은 변경이 있습니다 — 저장해야 문서·DOCX에 반영됩니다.</p>
          )}
          {live.unrecognized && (
            <p className="mt-1.5 text-[11px] text-red-600">
              청구항 형식을 인식하지 못했습니다 — 각 항을 <code>【청구항 1】</code> 또는 <code>청구항 1.</code> 헤더로 시작하세요.
            </p>
          )}

          {/* 라이브 린트 결과 */}
          {live.issues.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {[...errors, ...warns].map((i, idx) => (
                <li
                  key={idx}
                  className={`flex gap-2 rounded-md px-2.5 py-1.5 text-[11.5px] leading-relaxed ${
                    i.severity === 'error'
                      ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
                      : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
                  }`}
                >
                  <span className="shrink-0 font-semibold">{i.severity === 'error' ? '오류' : '주의'}</span>
                  <span>
                    {i.message}
                    {i.basis && <span className="ml-1 whitespace-nowrap text-[10px] opacity-70">[{i.basis}]</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!live.unrecognized && live.claims.length > 0 && live.issues.length === 0 && (
            <p className="mt-3 rounded-md bg-emerald-50 px-2.5 py-1.5 text-[11.5px] text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              ✓ 자동 검사에서 지적 사항이 없습니다. (휴리스틱 한계 — 변리사 최종 확인 필요)
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

function ComplianceRow({ result, onJump }: { result: ComplianceResult; onJump: (key: string) => void }) {
  const meta = STATUS_META[result.status]
  const hasDetails = result.details.length > 0
  // 청구범위는 같은 검토 탭의 워크벤치가 대상이라 점프 불필요 — 본문 섹션만 점프 노출.
  const jumpable = result.targetKey && result.targetKey !== '청구범위'

  const head = (
    <div className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left">
      <span className={`mt-px w-4 shrink-0 text-center text-[13px] font-bold ${meta.cls}`} aria-label={meta.label}>
        {meta.mark}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] font-medium text-neutral-800 dark:text-neutral-200">{result.label}</span>
          {jumpable && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onJump(result.targetKey!)
              }}
              className="rounded border border-neutral-200 px-1.5 py-px text-[10px] text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              본문 보기
            </button>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">{result.summary}</p>
      </div>
      {hasDetails && (
        <ChevronDown className="mt-1 h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform group-data-[state=open]:rotate-180" />
      )}
    </div>
  )

  if (!hasDetails) return <li>{head}</li>

  return (
    <li>
      <Collapsible>
        <CollapsibleTrigger className="group w-full hover:bg-neutral-50 dark:hover:bg-neutral-900/50">{head}</CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="space-y-1 px-3.5 pb-2.5 pl-10">
            {result.details.map((d, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                · {d}
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}
