// KIPO 명세서/출원서 구조 — 특허청 공식 서식(별지 제14~17호) 기준.
// 출처: 특허청 공식 서식 견본. 전체 원문/예시는 docs/kipo-application-template.md 참조.
// 이 파일이 "특허 형식 자동 매핑"(기능 1)과 문서 생성(Phase 2)의 타깃 구조다.

export interface KipoSection {
  key: string // 공식 서식의 【 】 라벨 그대로
  en: string
  group?: string // 상위 묶음 (예: 발명의 내용)
  optional?: boolean // 서식에서 ( 【 】 )로 표기된 조건부 항목
  guidance?: string // 생성 시 작성 지침
}

// ── 명세서 (별지 제15호 서식) — 순서가 곧 문서 레이아웃 ──────────────────────
export const KIPO_SECTIONS: KipoSection[] = [
  {
    key: '발명의 명칭',
    en: 'Title of the invention',
    guidance: '국문 명칭 {영문 명칭} 형식. 간결하고 기술 중심으로.',
  },
  {
    key: '기술분야',
    en: 'Technical field',
    guidance: '발명이 속하는 기술분야를 1~2문장으로.',
  },
  {
    key: '배경기술',
    en: 'Background art',
    guidance: '종래기술과 그 문제점. 도면(도 1 등) 참조 가능.',
  },
  {
    key: '선행기술문헌',
    en: 'Prior-art documents',
    optional: true,
    guidance:
      '특허문헌/비특허문헌으로 구분. 선행기술 리서치 결과가 여기에 매핑됨. 형식은 groupKipoCitations() 참조.',
  },
  {
    key: '해결하려는 과제',
    en: 'Problem to be solved',
    group: '발명의 내용',
    guidance: '배경기술의 문제점에서 도출된 목적.',
  },
  {
    key: '과제의 해결 수단',
    en: 'Means of solution',
    group: '발명의 내용',
    guidance: '독립항(청구항 1)을 풀어쓴 해결수단.',
  },
  {
    key: '발명의 효과',
    en: 'Effects of the invention',
    group: '발명의 내용',
    guidance: '종래기술 대비 유리한 효과.',
  },
  {
    key: '도면의 간단한 설명',
    en: 'Brief description of drawings',
    guidance: '도 1, 도 2 … 각 도면을 한 줄로 설명.',
  },
  {
    key: '발명을 실시하기 위한 구체적인 내용',
    en: 'Detailed description (embodiments)',
    guidance: '실시예 중심 상세 설명. 도면 부호를 사용해 설명.',
  },
  { key: '실시예', en: 'Examples', optional: true },
  { key: '산업상 이용가능성', en: 'Industrial applicability', optional: true },
  {
    key: '부호의 설명',
    en: 'Reference numerals',
    optional: true,
    guidance: '도면 주요 부호 설명 (예: 1: 금속판, 3: 에칭부).',
  },
  // 별지 제15호의 조건부 항목 — 의료기기엔 보통 비해당이지만 공식 구조 완전성을 위해 포함.
  {
    key: '수탁번호',
    en: 'Accession number',
    optional: true,
    guidance: '미생물 기탁이 있는 경우 기탁기관·수탁번호·기탁일.',
  },
  {
    key: '서열목록 자유텍스트',
    en: 'Sequence listing free text',
    optional: true,
    guidance: '뉴클레오타이드/아미노산 서열목록이 있는 경우.',
  },
  {
    key: '청구범위',
    en: 'Claims',
    guidance: '청구항 1은 독립항. 종속항은 선행 청구항을 인용(예: 제1항에 있어서).',
  },
]

export type KipoSectionKey = string
export const KIPO_SECTION_KEYS = KIPO_SECTIONS.map((s) => s.key)

// ── UI 아웃라인 (출원서 초안 '목차' 탭) ──────────────────────────────────────
// 문서 export 순서는 위 KIPO_SECTIONS(공식 별지15호)를 따르되, 화면 목차는 발명자에게
// 친화적인 그룹으로 보여준다. (UI 그룹핑 ≠ 출력 문서 순서)
//  - 도면의 간단한 설명·부호의 설명·발명을 실시하기 위한 구체적인 내용을 '발명의 내용'에 묶음
//  - 청구범위를 독립 그룹으로 (법적 핵심이라 항상 노출)
//  - 요약서 / 대표도면 / 도면을 분리
//  - 선택 항목은 접이식 '추가 항목 (선택)' 그룹으로 보관
export interface OutlineGroup {
  group: string
  // key = canonical schema_key (matches KIPO_SECTIONS / spec_sections.schema_key so
  // status dots + 근거 chips align); label = optional display override.
  items: { key: string; label?: string }[]
  optional?: boolean // 기본 접힘 ('추가 항목 (선택)')
}
export const SPEC_OUTLINE: OutlineGroup[] = [
  { group: '발명의 설명', items: [{ key: '발명의 명칭' }, { key: '기술분야' }, { key: '배경기술' }] },
  {
    group: '발명의 내용',
    items: [
      { key: '해결하려는 과제', label: '해결하고자 하는 과제' },
      { key: '과제의 해결 수단' },
      { key: '발명의 효과' },
      { key: '도면의 간단한 설명' },
      { key: '부호의 설명' },
      { key: '발명을 실시하기 위한 구체적인 내용' },
    ],
  },
  { group: '청구범위', items: [{ key: '청구범위' }] },
  { group: '요약서', items: [{ key: '요약' }] },
  { group: '대표도면', items: [{ key: '대표도면' }] },
  { group: '도면', items: [{ key: '도면' }] },
  {
    group: '추가 항목 (선택)',
    optional: true,
    items: [
      { key: '선행기술문헌' },
      { key: '실시예' },
      { key: '산업상 이용가능성' },
      { key: '수탁번호' },
      { key: '서열목록 자유텍스트' },
    ],
  },
]

// Sections we generate body prose for in P0-A (narrative spec sections, in document
// order). Claims(청구범위) are intentionally excluded — actual claim-text generation
// is a P1 non-goal; the document uses the claim_strategy dossier for that section.
export const SPEC_BODY_KEYS: string[] = [
  '발명의 명칭',
  '기술분야',
  '배경기술',
  '해결하려는 과제',
  '과제의 해결 수단',
  '발명의 효과',
  '도면의 간단한 설명',
  '발명을 실시하기 위한 구체적인 내용',
]

// schema_key -> 작성 지침 (generateSection에 주입). KIPO_SECTIONS의 guidance를 빠르게 조회.
export const SECTION_GUIDANCE: Record<string, string | undefined> = Object.fromEntries(
  KIPO_SECTIONS.map((s) => [s.key, s.guidance]),
)

// ── 요약서 (별지 제16호 서식) — 명세서와 별도 서식 ──────────────────────────
export const KIPO_ABSTRACT = {
  key: '요약서',
  sub: ['요약', '대표도'] as const,
  guidance: '발명의 요지를 간결히. 대표도(예: 도 1) 지정.',
}

// 요약 생성 지침 (generateSection에 주입). KIPO_SECTIONS엔 없는 별지16호 요약서용.
export const ABSTRACT_GUIDANCE =
  '발명의 요지를 한 문단(4~6문장)으로 압축. 청구항 1의 핵심 구성 + 주요 효과를 담되, 새로운 사실·수치를 추가하지 말 것. 도면부호·번호 인용 없이 서술.'

// ── 출원서 (별지 제14호 서식) — 서지/행정 정보 (대부분 출원인·변리사가 기입) ──
// 우리 도구가 자동 채울 수 있는 필드만 추림. 특히 공지예외적용 = §30 (disclosure_check).
export const KIPO_APPLICATION_FIELDS = [
  { key: '발명의 국문명칭', autofill: true },
  { key: '발명의 영문명칭', autofill: true },
  { key: '공지예외적용', autofill: true, note: '§30 — disclosure_check에서 채움' },
  { key: '공개형태', autofill: true, note: '§30 공개 채널 (논문/발표/판매 등)' },
  { key: '공개일자', autofill: true, note: '§30 최초 공개일' },
  { key: '출원인', autofill: false },
  { key: '대리인', autofill: false },
  { key: '수수료', autofill: false },
] as const

// ── 선행기술문헌 인용 형식 (모범명세서: 【특허문헌】/【비특허문헌】 + (특허문헌 0001) …) ──
// 모범명세서(별지15)는 특허문헌/비특허문헌을 하위표제로 나누고, 항목을 (특허문헌 0001) 형식으로,
// 묶음 전체에 식별번호 1개를 부여한다. 여기서는 "본문(body)"만 만들고, (특허문헌 NNNN) 접두사와
// 식별번호는 단일 문서 모델(buildDocumentModel)이 부여한다. ※ 현재 검색은 학술(PubMed/OpenAlex)
// = 비특허문헌이며, 특허 DB(KIPRIS/EPO) 연동 시 특허문헌으로 분류된다.
export interface CitationRef {
  source: string
  title?: string | null
  pub_date?: string | null
  url?: string | null
  ext_id?: string | null
}

function citationBody(ref: CitationRef): { kind: '특허문헌' | '비특허문헌'; body: string } {
  // pub_date holds YYYY-MM-DD; 공식 견본은 YYYY.MM.DD 표기.
  const dateStr = ref.pub_date ? ref.pub_date.slice(0, 10).replace(/-/g, '.') : ''
  const isPatent = ref.source === 'google_patents' || ref.source === 'kipris' || ref.source === 'epo'
  if (isPatent) {
    // 특허문헌: {등록/공개번호} {명칭} {YYYY.MM.DD}. (종류·출원인은 특허 DB 연동 후 보강)
    const body = [ref.ext_id, ref.title, dateStr].filter(Boolean).join(' ')
    return { kind: '특허문헌', body: body ? `${body}.` : '(서지정보 없음)' }
  }
  // 비특허문헌(논문): {제목}. {연월일}. {URL}.
  const body = [ref.title, dateStr || null, ref.url].filter(Boolean).join('. ')
  return { kind: '비특허문헌', body: body ? `${body}.` : '(서지정보 없음)' }
}

// refs를 특허문헌/비특허문헌 본문 배열로 분류(순서 보존). buildDocumentModel이 이를 받아
// 【특허문헌】/【비특허문헌】 하위표제 + (특허문헌 0001) 넘버링 + 식별번호 1개로 렌더한다.
export function groupKipoCitations(refs: CitationRef[]): { patent: string[]; nonPatent: string[] } {
  const patent: string[] = []
  const nonPatent: string[] = []
  for (const ref of refs) {
    const { kind, body } = citationBody(ref)
    if (kind === '특허문헌') patent.push(body)
    else nonPatent.push(body)
  }
  return { patent, nonPatent }
}

// ── MVP 준수 체크리스트 (프로그램적 게이트; 주관적 "변리사에 넘길 만하다" 대체) ──
export const COMPLIANCE_CHECKS = [
  'all_sections_present', // 필수 섹션 모두 존재
  'claim_1_is_independent', // 청구항 1 == 독립항
  'every_dependent_references_prior_claim', // 종속항 → 선행 청구항 인용
  'antecedent_basis_ok', // 모든 청구항 용어가 명세서에 존재 (기재불비 방지)
  'no_fabricated_citations', // grounding validator 통과
  'prior_art_documents_formatted', // 선행기술문헌 = 특허문헌/비특허문헌 형식 준수
  'abstract_within_length', // 요약서 길이
] as const
export type ComplianceCheck = (typeof COMPLIANCE_CHECKS)[number]
