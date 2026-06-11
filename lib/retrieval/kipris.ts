import type { RetrievedRef } from '@/lib/types'
import { fetchWithRetry } from './http'

// KIPRIS Plus — 한국 특허·실용신안 1차 선행조사 (env-gated).
// 키(KIPRIS_PLUS_KEY)가 없으면 호출하지 않고 [] 반환 → 기존 PubMed/OpenAlex 동작과 100% 동일.
//
// 엔드포인트/파라미터/응답필드는 KIPRIS Plus 공개 레퍼런스 구현(github.com/nuri428/
// langchain_kipris_tools, mcp_kipris)의 실제 호출 코드 + 라이브 응답 샘플로 검증했다.
//   · 자유검색(키워드) REST: http://plus.kipris.or.kr/openapi/rest/patUtiModInfoSearchSevice/freeSearchInfo
//     ('Sevice' 오타는 KIPRIS 측 실제 경로 표기다.) 키 파라미터명: accessKey.
//   · 요청 파라미터(camelCase): word, patent, utility, pageNo, numOfRows, lastvalue, descSort, sortSpec, accessKey.
//   · 응답 XML 경로: response>body>items>PatentUtilityInfo (결과 1건이면 단일 객체).
//   · item 태그(verbatim): ApplicationNumber, InventionName, Abstract, ApplicationDate(YYYYMMDD),
//     InternationalpatentclassificationNumber('|' 구분), RegistrationStatus, Applicant, OpeningNumber 등.
// 가입/키발급: https://plus.kipris.or.kr (회원가입 → API 활용신청). 무료 구간 ~1,000콜/월.
// 검증된 레퍼런스 구현이 사용하는 실제 호스트는 평문 http다(plus.kipris.or.kr REST). 추측성
// https 폴백을 두지 않고 문서화된 엔드포인트를 그대로 호출한다 — 최소 변경 원칙. (배포 환경이
// 평문 아웃바운드를 막으면 그건 별도로 드러내야 할 실제 제약이지, 여기서 가릴 문제가 아니다.)
const FREE_SEARCH_URL =
  'http://plus.kipris.or.kr/openapi/rest/patUtiModInfoSearchSevice/freeSearchInfo'

// KIPRIS는 출원번호 기반 공개 딥링크를 문서화하지 않는다(상세보기는 세션/토큰 필요). 사용자가
// 출원번호로 바로 재검색할 수 있도록 공개 검색 서비스로 연결한다.
// TODO: 안정적 딥링크 패턴 확인 시 교체 — https://plus.kipris.or.kr (자유검색 freeSearchInfo 명세 페이지).
function detailUrl(applicationNumber: string): string {
  return `https://www.kipris.or.kr/khome/search/searchResult.do?query=${encodeURIComponent(
    applicationNumber,
  )}`
}

export interface KiprisSearchOpts {
  // 외부 전송 전 이미 clampQuery로 단어수가 제한된 '일반' 키워드여야 한다(미공개 발명 페이로드 금지).
  word: string
  numOfRows?: number
}

// 키가 있을 때만 KIPRIS를 조회하고 RetrievedRef[]로 매핑한다. 키가 없거나 어떤 오류든
// (네트워크/파싱/HTTP) → [] + console.error. KIPRIS가 기존 PubMed/OpenAlex 실행을 절대 깨뜨리지 않는다.
export async function searchKipris(opts: KiprisSearchOpts): Promise<RetrievedRef[]> {
  const key = process.env.KIPRIS_PLUS_KEY
  if (!key) return []

  const word = opts.word.trim()
  if (!word) return []
  const numOfRows = opts.numOfRows ?? 20

  try {
    const url = new URL(FREE_SEARCH_URL)
    url.searchParams.set('word', word) // URL이 자동 인코딩 (PubMed 어댑터와 동일 방식)
    url.searchParams.set('patent', 'true')
    url.searchParams.set('utility', 'true')
    url.searchParams.set('pageNo', '1')
    url.searchParams.set('numOfRows', String(numOfRows))
    url.searchParams.set('sortSpec', 'AD') // 출원일 기준
    url.searchParams.set('descSort', 'true') // 최신 출원 우선
    url.searchParams.set('accessKey', key)

    const res = await fetchWithRetry(url, { headers: { 'User-Agent': 'patent-ai' } })
    if (!res.ok) {
      console.error('kipris search non-ok status:', res.status)
      return []
    }
    return parseKiprisXml(await res.text())
  } catch (e) {
    console.error('kipris search failed:', e instanceof Error ? e.message : e)
    return []
  }
}

// 의존성 없는 최소 XML 추출 — pubmed.ts와 동일 전략(정규식). KIPRIS 마크업 엣지케이스가 보이면
// 실 XML 파서로 교체. <PatentUtilityInfo> 블록 단위로 분할 후 태그별 first()로 뽑는다.
function parseKiprisXml(xml: string): RetrievedRef[] {
  const refs: RetrievedRef[] = []
  // <PatentUtilityInfo> ... </PatentUtilityInfo> 블록만 대상으로(자기닫힘 <.../>는 빈 결과이므로 무시).
  const blocks = [...xml.matchAll(/<PatentUtilityInfo>([\s\S]*?)<\/PatentUtilityInfo>/g)]
  for (const m of blocks) {
    const block = m[1]
    const appNo = clean(first(block, /<ApplicationNumber>([\s\S]*?)<\/ApplicationNumber>/))
    if (!appNo) continue // 출원번호 = ext_id (필수). 없으면 스킵.
    const title = clean(first(block, /<InventionName>([\s\S]*?)<\/InventionName>/))
    const abstract = clean(first(block, /<Abstract>([\s\S]*?)<\/Abstract>/))
    const appDate = clean(first(block, /<ApplicationDate>([\s\S]*?)<\/ApplicationDate>/))
    refs.push({
      source: 'kipris',
      ext_id: appNo,
      url: detailUrl(appNo),
      pub_date: toIsoDate(appDate), // YYYYMMDD → YYYY-MM-DD (또는 undefined)
      lang: 'ko',
      title: title || undefined,
      abstract: abstract || undefined,
    })
  }
  return refs
}

// KIPRIS 날짜는 YYYYMMDD 8자리. 그 외(빈값/형식이상)는 undefined로 — Postgres date 컬럼 안전.
function toIsoDate(s?: string): string | undefined {
  if (!s) return undefined
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined
}

function first(s: string, re: RegExp): string | undefined {
  return s.match(re)?.[1]
}

function clean(s?: string): string {
  if (!s) return ''
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') // KIPRIS는 일부 텍스트를 CDATA로 감싼다
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}
