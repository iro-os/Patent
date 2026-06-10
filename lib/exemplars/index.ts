// Layer 2 reference set — KIPO 모범명세서를 "문체 교본"으로 명세서 생성에 주입한다.
// 데이터는 scripts/ingest-exemplars.mjs 가 생성한 lib/exemplars/data/*.json.
//
// 새 예시 추가: 아래에 import 한 줄 + EXEMPLARS 배열에 추가. (정적 import → 서버 번들에
// 포함되어 배포 안전. fs.readdir 런타임 스캔은 Vercel 트레이싱 누락 위험이 있어 피한다.)
//
// 중요(grounding): 예시는 "문체"만 가르친다. 사실·수치·도면부호·인용은 절대 새 문서로
// 새지 않도록 generateSection SYSTEM이 막고, [N] 인용은 sanitizeRefMarkers가 한 번 더 거른다.
import e0412 from './data/04_0412.json'
import e0413 from './data/04_0413.json'
import e0414 from './data/04_0414.json'

export interface Exemplar {
  doc_id: string
  field: string
  field_name: string
  source_url: string
  title_ko: string
  title_en: string
  spec: Record<string, string> // 섹션 표제 → 원문(verbatim)
  claims: string[]
  abstract: string
  rep_figure: string
}

const EXEMPLARS: Exemplar[] = [e0412, e0413, e0414] as unknown as Exemplar[]

// 발명의 명칭은 한 줄이라 참고 가치가 낮고 그대로 복제될 위험이 커서 few-shot 대상에서 제외.
const SKIP_SECTIONS = new Set(['발명의 명칭'])
// 긴 섹션(발명을 실시하기 위한 구체적인 내용 등)은 앞부분만 — 문체 전달엔 충분, 토큰 절약.
const MAX_EXEMPLAR_CHARS = 1800
// 분야가 동떨어진 발명에 의료기기 예시를 강제 주입하지 않기 위한 휴리스틱 게이트.
// 지금은 04 의료 예시뿐이라, 의료 발명은 토큰이 겹쳐 통과하고 무관 발명은 걸러진다.
// (정교한 분야 매칭은 v2 pgvector 검색으로 대체 예정.)
const MIN_OVERLAP = 0.06

function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[가-힣a-z0-9]{2,}/g) ?? [])
}

// 발명 텍스트 토큰 중 예시(제목+기술분야+배경기술 앞부분)와 겹치는 비율.
function overlapScore(invTokens: Set<string>, ex: Exemplar): number {
  if (invTokens.size === 0) return 0
  const exTokens = tokenize(
    `${ex.title_ko} ${ex.spec['기술분야'] ?? ''} ${(ex.spec['배경기술'] ?? '').slice(0, 300)}`,
  )
  let shared = 0
  for (const t of invTokens) if (exTokens.has(t)) shared++
  return shared / invTokens.size
}

// 발명에 가장 가까운 예시 1개 선택(게이트 통과 시). 결정론적 — 같은 발명이면 항상 같은 예시라
// 한 문서의 모든 섹션이 동일 예시를 참조해 문체 일관성이 유지된다.
export function selectExemplar(inventionText: string): Exemplar | null {
  const inv = tokenize(inventionText)
  let best: Exemplar | null = null
  let bestScore = 0
  for (const ex of EXEMPLARS) {
    const sc = overlapScore(inv, ex)
    if (sc > bestScore) {
      bestScore = sc
      best = ex
    }
  }
  return bestScore >= MIN_OVERLAP ? best : null
}

// few-shot 주입 전 안전장치: 예시는 "문체"만 가르쳐야 하므로, 그대로 복제되면 기재불비를
// 유발할 식별번호(【000N】)와 도면부호(예: 압력센서(110))를 주입 직전에 제거한다. SYSTEM
// 프롬프트도 복제를 금지하지만 LLM은 강한 패턴 모방기라 런타임에서 한 번 더 차단한다.
function stripExemplarArtifacts(t: string): string {
  return t
    .replace(/【\s*\d{2,4}\s*】/g, '') // 문단 식별번호
    .replace(/([가-힣A-Za-z])\s*\(\s*\d{1,4}[a-z]?\s*\)/g, '$1') // 단어에 붙은 도면부호
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// 선택된 예시에서 해당 섹션의 "문체 참고용" 텍스트(아티팩트 제거 후 길면 절단). 없으면 null.
export function exemplarSectionText(ex: Exemplar, sectionKey: string): string | null {
  if (SKIP_SECTIONS.has(sectionKey)) return null
  // 요약은 예시의 spec에 없고 별도 abstract 필드에 있으므로 그걸 문체 참고로 쓴다.
  const raw = sectionKey === '요약' ? ex.abstract : ex.spec[sectionKey]
  if (!raw) return null
  const t = stripExemplarArtifacts(raw)
  if (!t) return null
  return t.length > MAX_EXEMPLAR_CHARS ? t.slice(0, MAX_EXEMPLAR_CHARS) + '\n…(이하 생략)' : t
}

// 한 번에: 발명 텍스트 + 섹션키 → 주입할 {title, sectionText}. 매칭/섹션 없으면 null.
export function pickExemplarSection(
  inventionText: string,
  sectionKey: string,
): { title: string; sectionText: string } | null {
  const ex = selectExemplar(inventionText)
  if (!ex) return null
  const sectionText = exemplarSectionText(ex, sectionKey)
  if (!sectionText) return null
  return { title: ex.title_ko, sectionText }
}
