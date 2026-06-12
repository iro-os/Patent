// 컴플라이언스 엔진 — sections.ts의 COMPLIANCE_CHECKS 7종 상수를 실제 검증으로 배선한다.
// 입력은 전부 일반 데이터(섹션 텍스트·청구항 텍스트·refs 메타)라 클라이언트(검토 탭)에서
// 즉시 실행 가능하고 서버 의존이 없다. 결과는 "근거(조문)와 함께 제시 + 확정 판단은 변리사"
// 철학을 따른다 — 휴리스틱 검사는 fail 대신 warn까지만 낸다.

import { COMPLIANCE_CHECKS, type ComplianceCheck, type CitationRef } from './sections'
import { parseClaims } from '@/lib/claims/parse'
import { lintClaims, checkSupport, type LintIssue } from '@/lib/claims/lint'

export type ComplianceStatus = 'pass' | 'warn' | 'fail' | 'na'

export interface ComplianceResult {
  check: ComplianceCheck
  label: string // UI 표시명
  status: ComplianceStatus
  summary: string
  details: string[] // 개별 발견 사항 (빈 배열 = 상세 없음)
  /** 해당되면 문서 탭에서 점프할 섹션 키 */
  targetKey?: string
}

export interface ComplianceInput {
  /** schema_key -> 본문 텍스트 (생성/수동 무관, 현재 유효 텍스트) */
  sections: Record<string, string>
  abstract: string | null
  /** 저장된(또는 에디터의) 청구항 원문 — 없으면 청구항 검사는 na */
  claimsText: string | null
  refs: CitationRef[]
}

const CHECK_LABEL: Record<ComplianceCheck, string> = {
  all_sections_present: '필수 섹션 작성',
  claim_1_is_independent: '청구항 1 = 독립항',
  every_dependent_references_prior_claim: '종속항 인용 무결성',
  antecedent_basis_ok: '선행사·뒷받침 (§42④)',
  no_fabricated_citations: '인용 무결성 (grounding)',
  prior_art_documents_formatted: '선행기술문헌 서지 형식',
  abstract_within_length: '요약서 분량',
}

// 문서모델 SPEC_FLOW의 required와 동일한 집합 — 별지15호 필수 흐름.
const REQUIRED_SECTIONS = [
  '발명의 명칭',
  '기술분야',
  '배경기술',
  '해결하려는 과제',
  '과제의 해결 수단',
  '발명의 효과',
  '발명을 실시하기 위한 구체적인 내용',
]

const CLAIM_RULES_REFERENCE = new Set([
  'forward_reference', 'missing_reference', 'self_reference', 'multi_multi_dependent',
  'non_alternative_citation', 'duplicate_number', 'numbering',
])
const CLAIM_RULES_BASIS = new Set(['antecedent_basis', 'unsupported_terms'])

function worst(issues: LintIssue[]): ComplianceStatus {
  if (issues.some((i) => i.severity === 'error')) return 'fail'
  if (issues.length) return 'warn'
  return 'pass'
}

export function runCompliance(input: ComplianceInput): ComplianceResult[] {
  const results = new Map<ComplianceCheck, ComplianceResult>()
  const put = (r: ComplianceResult) => results.set(r.check, r)

  // 1) all_sections_present
  {
    const missing = REQUIRED_SECTIONS.filter((k) => !input.sections[k]?.trim())
    if (!input.abstract?.trim()) missing.push('요약')
    put({
      check: 'all_sections_present',
      label: CHECK_LABEL.all_sections_present,
      status: missing.length ? 'fail' : 'pass',
      summary: missing.length ? `${missing.length}개 필수 항목이 비어 있습니다.` : '필수 섹션이 모두 작성되었습니다.',
      details: missing.map((k) => `【${k}】 미작성`),
      targetKey: missing[0],
    })
  }

  // 2~4) 청구항 검사 — 청구항 텍스트가 있어야 의미 있음
  const claimsRaw = input.claimsText?.trim()
  if (!claimsRaw) {
    const na = (check: ComplianceCheck, summary: string) =>
      put({ check, label: CHECK_LABEL[check], status: 'na', summary, details: [], targetKey: '청구범위' })
    na('claim_1_is_independent', '청구항이 아직 작성되지 않았습니다 (검토 탭에서 작성).')
    na('every_dependent_references_prior_claim', '청구항이 아직 작성되지 않았습니다.')
    na('antecedent_basis_ok', '청구항이 아직 작성되지 않았습니다.')
  } else {
    const { claims } = parseClaims(claimsRaw)
    const issues = lintClaims(claims)
    const specText = [...Object.values(input.sections), input.abstract ?? ''].join('\n')
    const support = checkSupport(claims, specText)

    const claim1Issues = issues.filter((i) => i.rule === 'claim1_dependent')
    put({
      check: 'claim_1_is_independent',
      label: CHECK_LABEL.claim_1_is_independent,
      status: claims.length ? worst(claim1Issues) : 'fail',
      summary: !claims.length
        ? '청구항 형식(【청구항 N】)을 인식하지 못했습니다.'
        : claim1Issues.length
          ? '청구항 1이 종속 형식입니다.'
          : '청구항 1이 독립항입니다.',
      details: claim1Issues.map((i) => i.message),
      targetKey: '청구범위',
    })

    const refIssues = issues.filter((i) => CLAIM_RULES_REFERENCE.has(i.rule))
    put({
      check: 'every_dependent_references_prior_claim',
      label: CHECK_LABEL.every_dependent_references_prior_claim,
      status: claims.length ? worst(refIssues) : 'na',
      summary: refIssues.length
        ? `인용 관련 지적 ${refIssues.length}건 (시행령 §5).`
        : '인용 방향·다중종속·택일적 기재에 문제가 없습니다.',
      details: refIssues.map((i) => i.message),
      targetKey: '청구범위',
    })

    const basisIssues = [...issues.filter((i) => CLAIM_RULES_BASIS.has(i.rule)), ...support]
    put({
      check: 'antecedent_basis_ok',
      label: CHECK_LABEL.antecedent_basis_ok,
      status: claims.length ? (basisIssues.length ? 'warn' : 'pass') : 'na',
      summary: basisIssues.length
        ? `선행사/뒷받침 의심 ${basisIssues.length}건 — 변리사 확인 필요 (휴리스틱).`
        : '선행사 기재·명세서 뒷받침에서 의심 항목이 발견되지 않았습니다.',
      details: basisIssues.map((i) => i.message),
      targetKey: '청구범위',
    })
  }

  // 5) no_fabricated_citations — 본문 [N] 마커가 refs 범위를 벗어나는지 (read-side 이중 검증;
  //    write-side는 sanitizeRefMarkers가 이미 막는다)
  {
    const max = input.refs.length
    const offenders: string[] = []
    for (const [key, text] of Object.entries(input.sections)) {
      if (!text) continue
      const bad = new Set<number>()
      for (const m of text.matchAll(/\[(\d{1,3})\]/g)) {
        const n = parseInt(m[1], 10)
        if (n < 1 || n > max) bad.add(n)
      }
      if (bad.size) offenders.push(`【${key}】 범위 밖 인용 [${[...bad].join('], [')}]`)
    }
    put({
      check: 'no_fabricated_citations',
      label: CHECK_LABEL.no_fabricated_citations,
      status: offenders.length ? 'fail' : 'pass',
      summary: offenders.length
        ? '검색된 선행기술 목록 밖의 인용 번호가 본문에 있습니다.'
        : `본문 인용이 모두 검색된 선행기술 [1..${max}] 범위 안에 있습니다.`,
      details: offenders,
    })
  }

  // 6) prior_art_documents_formatted — 서지정보(제목·일자/식별자) 누락 점검
  {
    if (!input.refs.length) {
      put({
        check: 'prior_art_documents_formatted',
        label: CHECK_LABEL.prior_art_documents_formatted,
        status: 'na',
        summary: '선행기술 검색 결과가 없습니다 (심층 리서치 실행 전).',
        details: [],
      })
    } else {
      const incomplete = input.refs
        .map((r, i) => {
          const lacks: string[] = []
          if (!r.title?.trim()) lacks.push('제목')
          if (!r.pub_date && !r.url && !r.ext_id) lacks.push('일자/식별자')
          return lacks.length ? `[${i + 1}] ${lacks.join('·')} 누락` : null
        })
        .filter((x): x is string => !!x)
      put({
        check: 'prior_art_documents_formatted',
        label: CHECK_LABEL.prior_art_documents_formatted,
        status: incomplete.length ? 'warn' : 'pass',
        summary: incomplete.length
          ? `${incomplete.length}건의 선행기술문헌에 서지정보가 부족합니다.`
          : '선행기술문헌 서지정보가 형식 요건을 갖췄습니다.',
        details: incomplete,
        targetKey: '선행기술문헌',
      })
    }
  }

  // 7) abstract_within_length — 법정 자수 제한이 아닌 실무 권고 분량 점검(라벨에 명시)
  {
    const len = (input.abstract ?? '').replace(/\s+/g, '').length
    let status: ComplianceStatus = 'pass'
    let summary = `요약서 분량 ${len}자(공백 제외) — 적정 범위입니다.`
    if (!len) {
      status = 'na'
      summary = '요약서가 아직 작성되지 않았습니다.'
    } else if (len < 80) {
      status = 'warn'
      summary = `요약서가 ${len}자로 짧습니다 — 핵심 구성과 효과가 담겼는지 확인하세요 (권고 기준).`
    } else if (len > 1200) {
      status = 'warn'
      summary = `요약서가 ${len}자로 깁니다 — 요지 압축을 권장합니다 (권고 기준).`
    }
    put({
      check: 'abstract_within_length',
      label: CHECK_LABEL.abstract_within_length,
      status,
      summary,
      details: [],
      targetKey: '요약',
    })
  }

  // 상수 정의 순서대로 반환 (UI 안정성)
  return COMPLIANCE_CHECKS.map((c) => results.get(c)!).filter(Boolean)
}
