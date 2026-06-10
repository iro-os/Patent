// 단일 문서 모델 — 앱 본문 뷰(draft-pane)와 DOCX 내보내기(docx.ts)가 **동일하게** 그리는
// 명세서 구조의 단일 소스. 별지15호 계층(발명의 설명 ▸ 발명의 내용)·연속 문단번호 【000N】·
// 요약서를 여기서 한 번 계산하므로 두 출력이 형식상 어긋날 수 없다.
//
// 청구항 실제 텍스트 생성은 P1(non-goal)이라, 청구범위는 지금은 claim_strategy 전략 블록으로 둔다.

export interface DocParagraph {
  num: number | null // 발명의 설명 본문 문단은 연속 번호(【000N】), 요약 등은 null
  text: string
}

export interface DocSection {
  sectionKey: string // data-sec / 되돌리기 조회용 (예: '기술분야', '요약')
  label: string // 표제 텍스트 (예: '기술분야')
  depth: 1 | 2 // 1 = 발명의 설명 직속, 2 = 발명의 내용 하위
  subContainerStart?: string // 이 섹션 앞에 하위 컨테이너 표제를 emit (예: '발명의 내용')
  kind: 'prose' | 'claimStrategy' | 'note'
  paragraphs: DocParagraph[] // kind=prose
  refNs: number[] // 근거 칩(앱 전용; DOCX는 무시)
  canRevert: boolean // 되돌리기 스트립(앱 전용)
  claim?: { independentScope: string | null; ladder: string[] } // kind=claimStrategy
  note?: string // kind=note
}

export interface DocContainer {
  label: string // 최상위 표제: '발명의 설명' / '청구범위' / '요약서'
  sections: DocSection[]
}

export interface BuildInput {
  // 생성된 섹션: schema_key -> { 본문, 되돌리기 가능 여부 }
  sections: Record<string, { text: string; canRevert: boolean }>
  claimStrategy?: { independent_scope: string | null; dependent_ladder?: string[] } | null
  abstract?: string | null // 요약서 본문(spec_sections['요약'])
  repFigure?: string | null // 대표도 (예: '도 1')
  refsCount?: number // in-range [N] 칩 필터용
  priorArtLines?: string[] // 선행기술문헌 인용 리스트(미생성 시 사용; formatKipoCitation로 사전 포맷)
}

// 발명의 설명 내부 흐름(별지15호). sub='발명의 내용'인 항목은 그 하위 컨테이너로 묶인다.
const SPEC_FLOW: { key: string; sub?: string; required?: boolean; noNumber?: boolean }[] = [
  // KIPO 규칙: 발명의 명칭에는 식별번호를 부여하지 않는다 — 【기술분야】가 【0001】로 시작.
  // (모범명세서 3건 모두 동일.) noNumber로 처리해 명칭은 무번호 한 줄로 렌더.
  { key: '발명의 명칭', required: true, noNumber: true },
  { key: '기술분야', required: true },
  { key: '배경기술', required: true },
  { key: '선행기술문헌' }, // 상황적(선행기술 목록 있으면 채움)
  { key: '해결하려는 과제', sub: '발명의 내용', required: true },
  { key: '과제의 해결 수단', sub: '발명의 내용', required: true },
  { key: '발명의 효과', sub: '발명의 내용', required: true },
  { key: '도면의 간단한 설명' }, // 도면 없으면 생략
  { key: '발명을 실시하기 위한 구체적인 내용', required: true },
  { key: '부호의 설명' }, // 도면부호 없으면 생략
]

// 텍스트 내 in-range [N] 마커 → 인용 번호(중복 제거·정렬).
function citedNs(text: string, max: number): number[] {
  if (max <= 0) return []
  const set = new Set<number>()
  for (const m of text.matchAll(/\[(\d{1,3})\]/g)) {
    const n = parseInt(m[1], 10)
    if (n >= 1 && n <= max) set.add(n)
  }
  return [...set].sort((a, b) => a - b)
}

function splitParas(text: string): string[] {
  return text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// 4자리 0패딩 문단번호 라벨(예: 1 → '0001').
export function paraLabel(n: number): string {
  return `【${String(n).padStart(4, '0')}】`
}

export function buildDocumentModel(input: BuildInput): DocContainer[] {
  const refsCount = input.refsCount ?? 0
  const containers: DocContainer[] = []
  let counter = 0 // 발명의 설명 전체에 걸친 연속 문단번호

  // ── 1) 발명의 설명 ──────────────────────────────────────────────
  const specSections: DocSection[] = []
  let prevPushedSub: string | undefined
  for (const { key, sub, required, noNumber } of SPEC_FLOW) {
    const text = input.sections[key]?.text?.trim()
    // 선행기술문헌은 본문 생성 대상이 아니므로(미생성), 선행기술 목록이 있으면 인용 리스트로 채운다.
    const lines = text
      ? splitParas(text)
      : key === '선행기술문헌' && input.priorArtLines?.length
        ? input.priorArtLines
        : null

    let sec: DocSection
    if (lines?.length) {
      sec = {
        sectionKey: key,
        label: key,
        depth: sub ? 2 : 1,
        kind: 'prose',
        paragraphs: lines.map((t) => ({ num: noNumber ? null : ++counter, text: t })),
        refNs: text ? citedNs(text, refsCount) : [],
        canRevert: input.sections[key]?.canRevert ?? false,
      }
    } else if (required) {
      // 필수 섹션이 미생성이면 조용히 빼지 않고 '(미작성)' 자리표시로 노출한다(완결성 — 부분
      // 생성 시 누락된 필수 섹션이 보이지 않는 채로 완성된 문서처럼 나가는 것을 방지).
      sec = {
        sectionKey: key,
        label: key,
        depth: sub ? 2 : 1,
        kind: 'note',
        paragraphs: [],
        refNs: [],
        canRevert: false,
        note: '(미작성 — 본문 생성 필요)',
      }
    } else {
      continue // 선택 섹션이 미생성이면 생략
    }
    // 하위 컨테이너(발명의 내용)의 첫 등장 섹션에만 표제를 emit.
    if (sub && sub !== prevPushedSub) sec.subContainerStart = sub
    prevPushedSub = sub
    specSections.push(sec)
  }
  if (specSections.length) containers.push({ label: '발명의 설명', sections: specSections })

  // ── 2) 청구범위 (P1 전까지 전략 블록) ───────────────────────────
  if (input.claimStrategy?.independent_scope) {
    containers.push({
      label: '청구범위',
      sections: [
        {
          sectionKey: '청구범위',
          label: '청구범위',
          depth: 1,
          kind: 'claimStrategy',
          paragraphs: [],
          refNs: [],
          canRevert: false,
          claim: {
            independentScope: input.claimStrategy.independent_scope,
            ladder: input.claimStrategy.dependent_ladder ?? [],
          },
        },
      ],
    })
  }

  // ── 3) 요약서 (요약 + 대표도) ───────────────────────────────────
  const abstract = input.abstract?.trim()
  if (abstract) {
    const sections: DocSection[] = [
      {
        sectionKey: '요약',
        label: '요약',
        depth: 1,
        kind: 'prose',
        paragraphs: splitParas(abstract).map((t) => ({ num: null, text: t })), // 요약은 번호 없음
        refNs: citedNs(abstract, refsCount),
        canRevert: input.sections['요약']?.canRevert ?? false,
      },
      {
        sectionKey: '대표도',
        label: '대표도',
        depth: 1,
        kind: 'note',
        paragraphs: [],
        refNs: [],
        canRevert: false,
        note: input.repFigure?.trim() || '(도면 첨부 시 지정)',
      },
    ]
    containers.push({ label: '요약서', sections })
  }

  return containers
}
