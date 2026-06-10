// KIPO 모범명세서 → 섹션 주소화 예시(reference set) 적재 파이프라인.
//
// 왜 LLM 전사인가: 이 PDF들은 임베디드 subset 폰트 + 깨진 ToUnicode라서 pdftotext가
// 쓰레기를 뱉는다(한글 글리프가 사설영역으로 매핑됨). 모델은 "렌더된 페이지"를 읽으므로
// 폰트 인코딩을 우회해 정확히 전사한다. 그래서 네이티브 PDF document 블록 + 강제 tool_use로
// 구조화 JSON을 받는다. (런타임 generateSection의 runTool과 동일한 패턴.)
//
// 실행:
//   cd patent-app && node --env-file=.env.local scripts/ingest-exemplars.mjs 04/0414 04/0412 04/0413
//   (인자 없으면 의료기기 예시 3개 기본 적재)
//
// 산출물:
//   resource/exemplars/pdf/FF_IIII.pdf   원본 캐시(.gitignore 권장)
//   lib/exemplars/data/FF_IIII.json      구조화 예시(앱이 Layer 2 참조로 import)
//   docs/exemplars/FF_IIII.md            사람이 눈으로 확인하는 프리뷰
//
// 비용: 분야당 PDF 20~35p. Sonnet 기준 대략 in 50~100k / out 5~20k 토큰 ≈ 문서당 $0.5~0.7.
// 본 도구는 1회성 적재용이라 PATENT_AI_MODEL(기본 sonnet)을 그대로 사용한다.

import Anthropic from '@anthropic-ai/sdk'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const MODEL = process.env.PATENT_AI_MODEL || 'claude-sonnet-4-6'
const KEY = process.env.ANTHROPIC_API_KEY // ingest 시에만 필요(main에서 검사). --render 모드는 LLM 미사용.

// KIPO 기술분야 코드(페이지 분류) — 메타데이터 표기용.
const FIELD_NAMES = {
  '01': '주거·생활',
  '02': '디지털 융합',
  '03': '전기·통신',
  '04': '화학·생명·식품',
  '05': '기계·금속',
  '06': '반도체',
}

// ASCII 슬롯 → 공식 섹션 표제(=lib/kipo/sections.ts KIPO_SECTIONS key, Layer 2 주소).
// 왜 ASCII 평면 슬롯인가: sections:[{key,text}] 같은 중첩 배열은 모델이 큰 내용을 JSON
// '문자열'로 직렬화해 흘리고(실측됨), 한글 key는 NFC/NFD·괄호 변형으로 매칭이 깨진다.
// 각 섹션을 ASCII 키의 평면 string 슬롯으로 받고(설명에 한글 표제 명시) 여기서 되매핑한다.
// 【발명의 설명】·【발명의 내용】은 상위 묶음이라 제외(자식 섹션만).
const SPEC_FIELD_MAP = [
  ['s_title', '발명의 명칭'],
  ['s_field', '기술분야'],
  ['s_background', '배경기술'],
  ['s_prior_art', '선행기술문헌'],
  ['s_problem', '해결하려는 과제'],
  ['s_solution', '과제의 해결 수단'],
  ['s_effect', '발명의 효과'],
  ['s_drawings_desc', '도면의 간단한 설명'],
  ['s_detailed', '발명을 실시하기 위한 구체적인 내용'],
  ['s_examples', '실시예'],
  ['s_industrial', '산업상 이용가능성'],
  ['s_numerals', '부호의 설명'],
  ['s_accession', '수탁번호'],
  ['s_sequence', '서열목록 자유텍스트'],
]
// 프리뷰(별지15호 공식 계층) 출력 순서. 【발명의 내용】은 해결하려는 과제·과제의 해결 수단·
// 발명의 효과를 감싸는 상위 표제이므로 별도로 묶어 렌더한다(데이터는 평면 유지).
const SPEC_BEFORE = ['발명의 명칭', '기술분야', '배경기술', '선행기술문헌']
const SPEC_CONTENT = ['해결하려는 과제', '과제의 해결 수단', '발명의 효과'] // 【발명의 내용】 하위
const SPEC_AFTER = [
  '도면의 간단한 설명',
  '발명을 실시하기 위한 구체적인 내용',
  '실시예',
  '산업상 이용가능성',
  '부호의 설명',
  '수탁번호',
  '서열목록 자유텍스트',
]

const PDF_DIR = resolve('resource/exemplars/pdf')
const DATA_DIR = resolve('lib/exemplars/data')
const PREVIEW_DIR = resolve('docs/exemplars')

const SYSTEM = `당신은 KIPO 특허 명세서 PDF를 섹션별로 **그대로 전사(verbatim)**하는 도구입니다. 요약·의역·교정·재작성을 하지 않고 원문 문장을 글자 그대로 옮깁니다.

규칙:
- 명세서 본문을 공식 【 】 표제 기준으로 섹션 분해합니다. 대상 표제: 발명의 명칭, 기술분야, 배경기술, 선행기술문헌, 해결하려는 과제, 과제의 해결 수단, 발명의 효과, 도면의 간단한 설명, 발명을 실시하기 위한 구체적인 내용, 부호의 설명, 실시예, 산업상 이용가능성, 수탁번호, 서열목록 자유텍스트.
- 【발명의 설명】과 【발명의 내용】은 상위 묶음일 뿐이며 별도 섹션이 아닙니다(자식 표제만 추출).
- 각 문단 앞의 번호 【0001】【0002】… 를 **그대로 보존**합니다.
- 도면부호(예: 본체(110)), 수치, 인용문헌 번호를 변경하지 않습니다.
- 특허청구범위는 각 청구항(청구항 1, 2, …)을 표제 없이 **본문만** 개별 문자열로 분리합니다.
- 요약서는 【요약】 본문을 abstract로, 【대표도】 값(예: "도 3")을 rep_figure로 넣습니다.
- 도면(그림) 자체는 전사하지 않습니다. 단 "도면의 간단한 설명"은 명세서 텍스트 섹션이므로 포함합니다.
- 페이지 머리말/꼬리말('Korean Intellectual Property Office', 'KIPO', 페이지 번호 등)은 제외합니다.
- 존재하지 않는 섹션은 생략합니다(빈 문자열을 만들지 마세요).
- "발명을 실시하기 위한 구체적인 내용"이 매우 길면 앞부분을 충분히(최소 1500자) 전사한 뒤 끝에 "…(이하 생략)"을 붙여도 됩니다. 그 외 섹션은 전부 전사합니다.
- title_ko = 발명의 명칭 국문, title_en = 영문 명칭(있으면, 원문 표기 그대로 — 오탈자도 보존).`

const TOOL = {
  name: 'submit_exemplar',
  description: 'KIPO 모범명세서를 섹션별로 전사해 구조화 결과로 제출합니다.',
  input_schema: {
    type: 'object',
    properties: {
      title_ko: { type: 'string', description: '발명의 명칭 (국문)' },
      title_en: { type: 'string', description: '영문 명칭 (있으면, 원문 그대로)' },
      // 섹션별 평면 string 슬롯 (존재하는 것만 채움). description에 한글 표제 명시.
      ...Object.fromEntries(
        SPEC_FIELD_MAP.map(([slot, ko]) => [
          slot,
          { type: 'string', description: `명세서 섹션 「${ko}」 원문 — 문단번호 【000N】 보존. 해당 섹션이 없으면 생략.` },
        ]),
      ),
      claims: {
        type: 'array',
        description: '청구범위 — 각 청구항 본문(표제 제외)을 개별 문자열로',
        items: { type: 'string' },
      },
      abstract: { type: 'string', description: '요약서 【요약】 본문' },
      rep_figure: { type: 'string', description: '대표도 (예: "도 3")' },
    },
    required: ['title_ko'],
  },
}

function srcUrl(field, id) {
  return `https://www.patent.go.kr/smart/jsp/kiponet/common/AllRouteDown.do?fn=example/${field}/${id}&fh=pdf`
}

async function downloadPdf(field, id) {
  const path = `${PDF_DIR}/${field}_${id}.pdf`
  if (existsSync(path)) return path
  const res = await fetch(srcUrl(field, id), {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  })
  if (!res.ok) throw new Error(`다운로드 실패 ${field}/${id}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.subarray(0, 4).toString('latin1') !== '%PDF') {
    throw new Error(`PDF 아님 ${field}/${id} (HTML 오류 페이지 가능성)`)
  }
  mkdirSync(PDF_DIR, { recursive: true })
  writeFileSync(path, buf)
  return path
}

function renderPreview(r) {
  const L = []
  const body = (text) => {
    L.push('')
    L.push(text)
    L.push('')
  }
  L.push(`# ${r.title_ko}${r.title_en ? ` (${r.title_en})` : ''}`)
  L.push('')
  L.push(`- 분야: ${r.field} ${r.field_name}`)
  L.push(`- 출처: KIPO 모범명세서 ${r.field}/${r.doc_id.split('_')[1]} · [원본 PDF](${r.source_url})`)
  L.push(
    `- 추출: 명세서 섹션 ${Object.keys(r.spec).length}개 · 청구항 ${r.claims.length}개 · 토큰 in ${r.usage.input_tokens} / out ${r.usage.output_tokens}`,
  )
  L.push('')

  // ── 발명의 설명 (별지15호 최상위) ──
  L.push('## 발명의 설명')
  for (const k of SPEC_BEFORE) {
    if (!r.spec[k]) continue
    L.push('')
    L.push(`### ${k}`)
    body(r.spec[k])
  }
  // ── 발명의 내용 (상위 표제) — 과제/수단/효과를 감쌈 (해결하려는 과제 직전에 노출) ──
  if (SPEC_CONTENT.some((k) => r.spec[k])) {
    L.push('')
    L.push('### 발명의 내용')
    for (const k of SPEC_CONTENT) {
      if (!r.spec[k]) continue
      L.push('')
      L.push(`#### ${k}`)
      body(r.spec[k])
    }
  }
  for (const k of SPEC_AFTER) {
    if (!r.spec[k]) continue
    L.push('')
    L.push(`### ${k}`)
    body(r.spec[k])
  }

  // ── 청구범위 (별지15호 표제는 '청구범위') ──
  L.push('## 청구범위')
  r.claims.forEach((c, i) => {
    L.push('')
    L.push(`**청구항 ${i + 1}**`)
    body(c)
  })

  // ── 요약서 ──
  L.push('## 요약서')
  body(r.abstract || '(없음)')
  if (r.rep_figure) L.push(`**대표도:** ${r.rep_figure}`)
  return L.join('\n') + '\n'
}

async function ingest(field, id, anthropic) {
  process.stdout.write(`• ${field}/${id} … `)
  const pdfPath = await downloadPdf(field, id)
  const b64 = readFileSync(pdfPath).toString('base64')

  // 긴 전사는 비스트리밍 타임아웃(~10분) 위험 → 스트리밍 후 finalMessage 수집.
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 40000,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'submit_exemplar' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
          {
            type: 'text',
            text: `이 PDF는 KIPO 모범명세서입니다(기술분야 코드 ${field}). 위 지침대로 섹션별로 전사해 submit_exemplar로 제출하세요.`,
          },
        ],
      },
    ],
  })
  const msg = await stream.finalMessage()
  if (msg.stop_reason === 'max_tokens') {
    throw new Error(`전사가 max_tokens(40000)에서 잘림 ${field}/${id} — max_tokens 상향 필요`)
  }
  const block = msg.content.find((b) => b.type === 'tool_use')
  if (!block) throw new Error(`tool_use 블록 없음 ${field}/${id}`)
  const out = block.input

  const spec = {}
  for (const [slot, ko] of SPEC_FIELD_MAP) {
    const v = out[slot]
    if (typeof v === 'string' && v.trim()) spec[ko] = v
  }

  // claims 는 보통 string[]. 단, 큰 배열을 JSON 문자열로 직렬화해 보내는 경우가 있어 방어.
  let claims = out.claims
  if (typeof claims === 'string') {
    try {
      claims = JSON.parse(claims)
    } catch {
      claims = [claims]
    }
  }
  claims = Array.isArray(claims) ? claims.filter((c) => typeof c === 'string' && c.trim()) : []

  const record = {
    doc_id: `${field}_${id}`,
    field,
    field_name: FIELD_NAMES[field] ?? field,
    source_url: srcUrl(field, id),
    title_ko: out.title_ko ?? '',
    title_en: out.title_en ?? '',
    spec,
    claims,
    abstract: out.abstract ?? '',
    rep_figure: out.rep_figure ?? '',
    usage: {
      model: msg.model,
      input_tokens: msg.usage?.input_tokens ?? 0,
      output_tokens: msg.usage?.output_tokens ?? 0,
    },
  }

  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(`${DATA_DIR}/${field}_${id}.json`, JSON.stringify(record, null, 2) + '\n')
  mkdirSync(PREVIEW_DIR, { recursive: true })
  writeFileSync(`${PREVIEW_DIR}/${field}_${id}.md`, renderPreview(record))

  console.log(
    `✓ "${record.title_ko}" — 섹션 ${Object.keys(spec).length}, 청구항 ${record.claims.length}, out ${record.usage.output_tokens}tok`,
  )
  return record
}

async function main() {
  const args = process.argv.slice(2)

  // 프리뷰만 재생성(LLM 호출 없음) — 기존 lib/exemplars/data/*.json 에서 .md 만 다시 그린다.
  // 렌더링 규칙(섹션 계층·표제)을 바꿨을 때 비용 없이 프리뷰를 갱신하는 용도.
  if (args.includes('--render')) {
    const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'))
    mkdirSync(PREVIEW_DIR, { recursive: true })
    for (const f of files) {
      const r = JSON.parse(readFileSync(`${DATA_DIR}/${f}`, 'utf8'))
      writeFileSync(`${PREVIEW_DIR}/${r.doc_id}.md`, renderPreview(r))
      console.log('↻ 프리뷰 갱신:', r.doc_id)
    }
    console.log(`\n완료 ${files.length}건 — 프리뷰만 재생성(LLM 호출 없음).`)
    return
  }

  if (!KEY) {
    console.error('✗ ANTHROPIC_API_KEY 없음 — `node --env-file=.env.local scripts/ingest-exemplars.mjs ...` 로 실행하세요.')
    process.exit(1)
  }

  // 인자: "FF/IIII" 형식. 없으면 의료기기 예시 3개.
  const ids = (args.length ? args : ['04/0414', '04/0412', '04/0413']).map((a) => {
    const m = a.match(/^(\d{2})[/_](\d{4})$/)
    if (!m) throw new Error(`잘못된 ID 형식: "${a}" (예: 04/0414)`)
    return { field: m[1], id: m[2] }
  })

  const anthropic = new Anthropic({ apiKey: KEY })
  console.log(`모델 ${MODEL} · 적재 대상 ${ids.length}건\n`)

  const done = []
  for (const { field, id } of ids) {
    try {
      done.push(await ingest(field, id, anthropic))
    } catch (e) {
      console.log(`✗ ${field}/${id}: ${e instanceof Error ? e.message : e}`)
    }
  }
  console.log(`\n완료 ${done.length}/${ids.length}. JSON → lib/exemplars/data/ , 프리뷰 → docs/exemplars/`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
