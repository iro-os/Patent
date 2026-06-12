// 청구항 텍스트 파서 — 변리사 검토 워크벤치의 토대. 자유 텍스트로 입력된 청구항 세트를
// 구조화(번호·인용관계·택일적/병합적 기재·카테고리)해서 린터(lint.ts)와 저장(claims 테이블),
// 문서 렌더(문서모델 【청구항 N】)가 같은 구조를 쓰게 한다. 순수 함수 — LLM·DB 의존 없음.

export interface ParsedClaim {
  number: number // 청구항 번호 (헤더에서 추출)
  text: string // 본문 (헤더 제외, trim)
  cites: number[] // 인용한 청구항 번호들 (제N항; 내지 범위는 전개됨)
  /** 인용부가 택일적으로 기재됨 ("또는" / "중 어느 한 항") — 시행령 §5④ */
  alternative: boolean
  /** 인용부가 병합적으로 기재됨 ("및"/"와"/"과") — §5④ 위반 소지 */
  conjunctive: boolean
  category: 'product' | 'method' | 'unknown' // 말미 명사 기반 휴리스틱
  headerLine: number // 0-based 라인 인덱스 (에디터 점프용)
}

export interface ParseResult {
  claims: ParsedClaim[]
  /** 헤더를 하나도 못 찾았을 때 true — UI가 형식 안내를 띄울 수 있게 */
  empty: boolean
}

// 헤더 형식: 【청구항 1】 / [청구항 1] / 청구항 1. / 청구항 1 — 모두 라인 시작에서만.
// "청구항 1에 따른…" 같은 본문 속 언급은 숫자 뒤에 구분자(공백·마침표·괄호닫힘·EOL)가
// 없으므로 매치되지 않는다.
const HEADER_RE = /^\s*(?:【\s*청구항\s*(\d{1,4})\s*】|\[\s*청구항\s*(\d{1,4})\s*\]|청구항\s*(\d{1,4})\s*(?:[.:]|(?=\s)|$))\s*(.*)$/

// 제N항 인용 + "제N항 내지 제M항" 범위. 전개해서 cites에 담는다.
// (\d{1,4}: 세 자리 초과 번호가 조용히 누락되지 않게 — 누락은 인용 검사 우회가 된다)
const RANGE_RE = /제\s*(\d{1,4})\s*항\s*(?:내지|부터|에서)\s*제\s*(\d{1,4})\s*항/g
const SINGLE_RE = /제\s*(\d{1,4})\s*항/g

// 물건/방법 분류용 말미 명사. KIPO 실무에서 청구항은 말미 명사로 카테고리가 정해진다.
const METHOD_TAIL = /(방법|단계를\s*포함하는\s*공정|공정)\s*[.。]?\s*$/
const PRODUCT_TAIL =
  /(장치|시스템|기기|기구|디바이스|조성물|화합물|조립체|구조체|구조물|모듈|유닛|단말|서버|키트|용기|부재|부품|재료|물질|약학\s*조성물|프로그램|기록\s*매체|기록매체|매체)\s*[.。]?\s*$/

/** 인용 절(보통 "…에 있어서" 앞부분). 없으면 본문 전체에서 인용을 찾는다(인용형식 독립항 포함). */
function citationClause(text: string): string {
  const idx = text.indexOf('에 있어서')
  return idx >= 0 ? text.slice(0, idx + 5) : text
}

function extractCites(text: string): { cites: number[]; alternative: boolean; conjunctive: boolean } {
  const clause = citationClause(text)
  const nums = new Set<number>()

  // 범위 먼저 전개하고, 전개된 구간은 단일 매치 중복을 Set이 흡수한다.
  for (const m of clause.matchAll(RANGE_RE)) {
    const a = parseInt(m[1], 10)
    const b = parseInt(m[2], 10)
    if (b >= a && b - a <= 200) for (let n = a; n <= b; n++) nums.add(n)
  }
  for (const m of clause.matchAll(SINGLE_RE)) nums.add(parseInt(m[1], 10))

  const cites = [...nums].sort((x, y) => x - y)
  if (cites.length < 2) return { cites, alternative: cites.length > 0, conjunctive: false }

  // 택일적: "또는" 또는 "중 어느 한(하나의) 항". 병합적: 항 인용 사이를 "및/와/과"로 연결.
  const alternative = /또는|중\s*어느\s*한|중\s*어느\s*하나/.test(clause)
  const conjunctive = /항\s*(?:및|와|과)\s*(?:제|상기)/.test(clause)
  return { cites, alternative, conjunctive }
}

function categoryOf(text: string): ParsedClaim['category'] {
  const t = text.trim()
  if (METHOD_TAIL.test(t)) return 'method'
  if (PRODUCT_TAIL.test(t)) return 'product'
  return 'unknown'
}

/** 자유 텍스트 → 구조화된 청구항 배열. 헤더가 전혀 없으면 empty=true (claims는 빈 배열). */
export function parseClaims(raw: string): ParseResult {
  const lines = raw.split('\n')
  const blocks: { number: number; headerLine: number; bodyLines: string[] }[] = []

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADER_RE)
    if (m) {
      const num = parseInt(m[1] ?? m[2] ?? m[3], 10)
      const rest = (m[4] ?? '').trim()
      blocks.push({ number: num, headerLine: i, bodyLines: rest ? [rest] : [] })
    } else if (blocks.length && lines[i].trim()) {
      blocks[blocks.length - 1].bodyLines.push(lines[i].trim())
    }
  }

  const claims: ParsedClaim[] = blocks.map((b) => {
    const text = b.bodyLines.join('\n').trim()
    const { cites, alternative, conjunctive } = extractCites(text)
    return {
      number: b.number,
      text,
      cites,
      alternative,
      conjunctive,
      category: categoryOf(text),
      headerLine: b.headerLine,
    }
  })

  return { claims, empty: claims.length === 0 }
}

/** 구조화된 청구항 → 표준 표기 텍스트 (저장본 재구성·AI 초안 렌더 공용). */
export function formatClaims(claims: { number: number; text: string }[]): string {
  return claims
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((c) => `【청구항 ${c.number}】\n${c.text.trim()}`)
    .join('\n\n')
}
