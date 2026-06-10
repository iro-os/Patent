import Anthropic from '@anthropic-ai/sdk'
import { runTool } from './client'
import type { UsageRecord } from './pricing'
import type { SearchConcepts } from '@/lib/types'

export interface ChatUnderstanding {
  title_guess: string
  tech_summary: string
  problem: string
  differentiators: string
  ipc_candidates: string[]
  missing_items: string[]
  search_query_en: string
  search_concepts: SearchConcepts
}

export interface ChatTurnResult {
  reply_ko: string // markdown shown in the chat timeline
  understanding: ChatUnderstanding
  ready_for_research: boolean
  // Set when the user asks (in chat) to edit a specific generated 명세서 section — the
  // chat route then regenerates just that section. Null for ordinary conversation.
  section_edit: { schema_key: string; instruction: string } | null
}

export type ChatRole = 'user' | 'assistant'

// The persisted project state, injected each turn so the assistant is aware of work
// that actually happened (otherwise it falsely claims "no research was done").
export interface ChatContext {
  debrief: {
    title_guess: string | null
    tech_summary: string | null
    problem: string | null
    differentiators: string | null
    missing_items: string[]
  } | null
  research: {
    count: number
    sources: string[]
    refs: { title: string | null; year: string | null; source: string; ko_summary: string | null }[]
    blind_spots: string[]
  } | null
  analysis: {
    independent_scope: string | null
    differentiators: string[]
  } | null
  // KIPO section keys that already have generated body text — the only sections the
  // assistant may target for a chat-driven edit (section_edit).
  generated_sections?: string[]
}

const SYSTEM = `당신은 대한민국 특허 실무(KIPO)에 정통한 변리사 보조 AI입니다. 발명자와 자연스럽게 "대화하며" 발명을 명세서 수준으로 구체화하고, 선행기술을 반영해 출원 전략을 함께 다듬습니다 (Claude Code의 plan 모드처럼).

[대화 원칙 — 매끄러운 핑퐁]
- 협업자처럼 굴고, 문지기처럼 굴지 마세요. 사용자의 요청을 먼저 충실히 들어준 뒤, 필요한 것을 제안하세요.
- 확인 질문은 "강제"가 아니라 "선택적 제안"입니다. 사용자가 일부만 답하거나, 건너뛰거나, "그냥 진행해/요약해줘"라고 하면 그 의사를 존중하고 가진 정보로 진행하세요. 답하지 않은 항목을 이유로 작업을 거부하지 마세요.
- 정보가 부족하면 합리적 '가정'을 명시(가정은 '추정'으로)하고 전진하세요. 멈추기보다 도움 되는 다음 결과물을 내놓으세요.
- reply_ko 구성: (1) 사용자의 말/요청에 직접 응답하되 **충실하게** — 발명자가 곧바로 다음 행동(초안 보강)을 할 수 있도록 실질적 내용을 담으세요. 너무 짧게 끝내지 마세요. (2) 도움이 되면 짧은 확인 질문을 '- ' 리스트로(최대 3개, 선택 사항임을 분명히), (3) 자연스러운 다음 단계 제안. 카드/버튼이 아니라 대화체이되, 표·리스트로 가독성을 높이세요.

[현재 프로젝트 상태 — 매우 중요]
- 시스템이 별도 블록으로 "현재 프로젝트 상태"(발명 이해/선행기술 리서치 결과/차별점 분석)를 제공합니다. 이는 이미 실제로 저장된 사실입니다.
- 선행기술 리서치가 "수행됨"으로 표시되면, 절대 "리서치를 하지 않았다"거나 "지어낸 결과"라고 말하지 마세요. 제공된 실제 결과를 근거로 요약·분석하고, 명세서(배경기술/해결 과제/효과)·청구범위에 어떻게 반영할지 구체적으로 제시하세요.
- 상태에 없는 기술 내용을 새로 지어내지는 마세요(가설은 '추정'으로 표시).

[ready_for_research]
- 문제와 대략적 해결수단이 파악되면 true로 두세요. 모든 확인 질문에 답하지 않아도 됩니다. 이는 "검색을 시작할 수 있다"는 신호일 뿐, 다른 작업을 막는 게이트가 아닙니다.

매 턴 산출:
1) reply_ko (위 원칙대로, 한국어 마크다운)
2) understanding — 전체 대화 + 현재 상태를 토대로 매 턴 갱신: title_guess(추정 명칭), tech_summary, problem, differentiators(차별 요소 가설), ipc_candidates(IPC 후보 배열), missing_items(아직 불명확/선택 확인 항목 배열), search_query_en(선행기술 검색용 영어 자연어 질의, boolean 금지), search_concepts{ko[],en[]}
   ⚠️ '현재 프로젝트 상태' 블록은 이 대화의 **누적 기억**입니다. 거기 담긴 확정 사실을 **보존하며** 갱신하세요(오래된 대화 원문이 첨부에서 빠져도 그 내용을 잃지 말 것). 새 정보는 덮어쓰되, 근거 없이 기존 사실을 삭제하지 마세요.
3) ready_for_research (위 기준)

이것은 법률 자문이 아니며 최종본은 변리사 검토가 필요합니다(필요 시 한 번만 간단히 고지하고 반복하지 마세요). 모든 출력은 한국어.`

// Injected only on the very first turn — the user has just dropped their idea/materials
// and needs a substantive draft-readiness diagnosis, not a one-liner.
const FIRST_TURN_DIRECTIVE = `[첫 턴 특별 지침] 이번이 이 발명의 첫 메시지입니다. 질문지가 아니라 "AI가 이미 절반을 채워 놓은 진단 리포트"를 작성하세요. 핵심 원칙: **보여주는 건 최대한 완전하게(명세서 전 항목을 펼침), 답을 강요하는 건 최소로(능동 질문 3~5개)**. 다음 순서로 구성하세요:

1) 한 줄 요지 재진술 — "제가 이해한 발명은 …"으로 시작해 이해도를 즉시 증명.

2) ✅ **지금 채울 수 있는 항목** — 제공된 설명/자료만으로 작성 가능한 명세서 부분(발명의 명칭·기술분야·배경기술·해결 과제·과제의 해결 수단·발명의 효과·주요 구성요소 표·독립항 뼈대)을 구체적으로 짚고, 핵심 문장/청구항 1 뼈대를 미리 제안하세요. (해결수단↔청구항↔효과↔실시예가 서로 맞물리게)

3) ⚠️ **아직 못 채우는 항목(기술)** — 실시가능요건을 채우려면 필요한 것: 핵심 파라미터의 **수치 범위**(임계값·주기·치수 등), **재료/부품 사양**, **best mode/프로토타입 유무**, 청구항 **일반화 수준**(어디까지 넓혀도 성립하는지). 각 항목이 왜 필요한지 한 줄로.

4) 💪 **더 강하게 만들 부분(진보성)** — 권리를 강하게 만드는 전략 항목. 특히 **비교/실험 데이터**(종래 대비 정량 개선 — 진보성의 핵심 카드)를 반드시 포함하고, 청구항 확장(방법·시스템·용도) 여지도 짚으세요.

5) 📋 **행정·법률 빠른 체크** — 권리·시한을 좌우하지만 발명자가 놓치기 쉬운 항목을 "체크박스 미리보기"로 제시(질문이 아니라 부담 낮은 미리보기). 해당될 만한 것만:
   • 이미 공개(전시·크라우드펀딩·논문·발표·판매·시연)했는지 → 있으면 **공개일로부터 12개월 내 출원**해야 신규성 유지(§30 공지예외). 제품 성격상 공개 가능성이 높으면 특히 강조.
   • 직무발명(회사 업무 관련 → 권리 귀속)·공동발명자 여부
   • 해외 출원/우선권 계획 여부(→ 우선권 12개월)
   • 출원 전략: 국내 vs PCT, 우선심사 활용 여부
   ※ 모르는 법률 수치를 지어내지 말고, §30 12개월·우선권 12개월·심사청구 3년처럼 확립된 기한만 안내하세요.

6) 다음 단계 — 두 갈림길을 명시: (a) "**리서치 진행해줘**" → 선행기술·IPC·배경기술을 자동으로 채워옴(아무 답 안 해도 됨), 또는 (b) 위에서 **먼저 채우고 싶은 항목 하나**만 골라 답하기.

표·리스트로 스캔하기 쉽게 구성하세요. 능동적으로 답을 요구하는 질문은 3~5개로 제한하고(✅로 이미 채운 것과 📋 체크박스는 답 강요가 아님), 사용자가 무엇부터 답할지 스스로 고르게 하세요. 모든 확인은 선택이며 건너뛰어도 진행 가능함을 알리세요.`

const INPUT_SCHEMA: Anthropic.Tool['input_schema'] = {
  type: 'object',
  properties: {
    reply_ko: { type: 'string', description: '대화형 응답(마크다운). 요청에 직접 답한 뒤, 필요시 선택적 확인 질문 리스트.' },
    title_guess: { type: 'string' },
    tech_summary: { type: 'string' },
    problem: { type: 'string' },
    differentiators: { type: 'string' },
    ipc_candidates: { type: 'array', items: { type: 'string' } },
    missing_items: { type: 'array', items: { type: 'string' } },
    search_query_en: { type: 'string', description: '선행기술 검색용 영어 자연어 질의 (boolean 연산자 없이).' },
    search_concepts: {
      type: 'object',
      properties: {
        ko: { type: 'array', items: { type: 'string' } },
        en: { type: 'array', items: { type: 'string' } },
      },
      required: ['ko', 'en'],
    },
    ready_for_research: { type: 'boolean' },
    section_edit: {
      type: 'object',
      description: '특정 명세서 섹션 편집 요청. 편집 요청이 아니면 schema_key를 빈 문자열("")로 둡니다.',
      properties: {
        schema_key: {
          type: 'string',
          description: '편집 대상 KIPO 섹션 키 (상태 블록의 "생성됨" 목록에 있는 키 그대로). 편집이 아니면 "".',
        },
        instruction: { type: 'string', description: '해당 섹션을 어떻게 고칠지 요지 (없으면 "")' },
      },
      required: ['schema_key', 'instruction'],
    },
  },
  required: [
    'reply_ko',
    'title_guess',
    'tech_summary',
    'problem',
    'differentiators',
    'ipc_candidates',
    'missing_items',
    'search_query_en',
    'search_concepts',
    'ready_for_research',
    'section_edit',
  ],
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

// Render the persisted project state as a compact system-context block. This is what
// makes the assistant aware of prior research/analysis instead of denying it happened.
function buildStateContext(ctx?: ChatContext): string {
  if (!ctx) return ''
  const lines: string[] = ['=== 현재 프로젝트 상태 (시스템에 실제 저장된 사실) ===']

  const d = ctx.debrief
  if (d && (d.title_guess || d.tech_summary || d.problem || d.differentiators)) {
    lines.push('[발명 이해]')
    if (d.title_guess) lines.push(`- 제목(추정): ${d.title_guess}`)
    if (d.tech_summary) lines.push(`- 기술 요약: ${d.tech_summary}`)
    if (d.problem) lines.push(`- 해결 문제: ${d.problem}`)
    if (d.differentiators) lines.push(`- 차별점(가설): ${d.differentiators}`)
    const mi = (d.missing_items ?? []).filter(Boolean)
    if (mi.length) lines.push(`- 아직 불명확/선택 확인 항목(사용자가 답하지 않아도 됨): ${mi.join(' · ')}`)
  }

  if (ctx.research) {
    const r = ctx.research
    lines.push(
      '',
      `[선행기술 리서치] ✅ 수행됨 — 총 ${r.count}건${r.sources.length ? ` (소스: ${r.sources.join(', ')})` : ''}`,
    )
    if (r.refs.length) {
      lines.push('주요 결과:')
      r.refs.forEach((x, i) => {
        const meta = [x.year, x.source].filter(Boolean).join('·')
        lines.push(`${i + 1}) ${meta ? `[${meta}] ` : ''}${x.title ?? '(제목 없음)'}`)
        if (x.ko_summary) lines.push(`   요약: ${truncate(x.ko_summary, 240)}`)
      })
    }
    if (r.blind_spots.length) lines.push(`알려진 한계: ${r.blind_spots.join(' · ')}`)
  } else {
    lines.push('', '[선행기술 리서치] 아직 수행 안 됨 — 검색하려면 사용자가 컴포저의 "심층 리서치"를 실행해야 합니다.')
  }

  if (ctx.analysis) {
    lines.push('', '[차별점/청구범위 분석] ✅ 수행됨')
    if (ctx.analysis.independent_scope) lines.push(`- 독립항 범위(추정): ${ctx.analysis.independent_scope}`)
    if (ctx.analysis.differentiators.length) lines.push(`- 차별점: ${ctx.analysis.differentiators.join(' · ')}`)
  }

  const gs = (ctx.generated_sections ?? []).filter(Boolean)
  if (gs.length) {
    lines.push('', `[명세서 본문] ✅ 생성됨 — 섹션: ${gs.join(' · ')}`)
    lines.push(
      '사용자가 위 섹션 중 하나를 수정/구체화/다시 써 달라고 하면 section_edit에 {schema_key(위 키 그대로), instruction(요청 요지)}를 채우세요 — 시스템이 그 섹션만 재생성하고 직전 텍스트를 저장합니다. reply_ko에는 "해당 섹션을 다시 작성했고 우측 패널에서 확인·되돌리기 가능"이라고 안내하세요. 일반 대화에서는 section_edit의 schema_key를 빈 문자열로 두세요.',
    )
  }

  lines.push('=== 상태 끝 ===')
  lines.push(
    '위는 실제 저장된 데이터입니다. 리서치가 "수행됨"이면 절대 "안 했다/지어냈다"고 말하지 말고, 위 결과를 근거로 답하세요.',
  )
  return lines.join('\n')
}

// Recent raw turns kept verbatim (~8 exchanges). Older turns are carried by the
// structured state snapshot (the cumulative "memory"), so per-turn context stays
// bounded regardless of session length. Short sessions (the common case today) are
// under this and unaffected — nothing is dropped.
const MAX_RAW_TURNS = 16

// One conversational turn. `history` is the prior thread (user/assistant text turns);
// `userMessage` is the new message; `context` is the persisted project state (so the
// assistant knows about prior research/analysis). Returns the assistant reply +
// refreshed understanding.
export async function chatTurn(
  opts: { history: { role: ChatRole; content: string }[]; userMessage: string; context?: ChatContext },
  onUsage?: (u: UsageRecord) => void | Promise<void>,
): Promise<ChatTurnResult> {
  // Bounded context (다 architecture): keep the most recent turns verbatim; the rest
  // live in the structured state snapshot below. Caps cost AND mitigates long-context
  // quality degradation, while leaving short sessions byte-for-byte unchanged.
  const full = opts.history.filter((m) => m.content.trim())
  const trimmed = full.length > MAX_RAW_TURNS
  let kept = trimmed ? full.slice(-MAX_RAW_TURNS) : full
  // The message list must start with a user turn (API requirement); if the trim window
  // begins on an assistant reply, drop it.
  if (kept.length && kept[0].role === 'assistant') kept = kept.slice(1)
  // Defensive: if the thread ends on an orphaned user turn (e.g. a prior turn whose
  // assistant reply failed to persist), drop it so we never send two user turns in a
  // row (which the API rejects) once the new message is appended.
  if (kept.length && kept[kept.length - 1].role === 'user') kept = kept.slice(0, -1)

  const messages: Anthropic.MessageParam[] = [
    ...kept.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: opts.userMessage },
  ]

  let systemContext = buildStateContext(opts.context)
  if (trimmed && systemContext) {
    systemContext += `\n\n(이전 ${full.length - kept.length}개 대화 메시지는 위 '현재 프로젝트 상태'에 누적 반영됨 — 최근 ${kept.length}개만 원문으로 첨부.)`
  }
  // First message of a session → ask for a full draft-readiness diagnosis, not a one-liner.
  if (full.length === 0) {
    systemContext = systemContext ? `${systemContext}\n\n${FIRST_TURN_DIRECTIVE}` : FIRST_TURN_DIRECTIVE
  }

  const out = await runTool<{
    reply_ko: string
    title_guess: string
    tech_summary: string
    problem: string
    differentiators: string
    ipc_candidates: string[]
    missing_items: string[]
    search_query_en: string
    search_concepts: SearchConcepts
    ready_for_research: boolean
    section_edit: { schema_key: string; instruction: string }
  }>({
    system: SYSTEM,
    systemContext,
    messages,
    toolName: 'submit_turn',
    toolDescription: '대화 응답과 갱신된 발명 이해를 제출합니다.',
    inputSchema: INPUT_SCHEMA,
    // Headroom for richer replies (summarizing prior art + mapping it to the spec)
    // so a long answer never trips the max_tokens truncation guard.
    maxTokens: 3500,
    onUsage,
  })

  return {
    reply_ko: out.reply_ko,
    understanding: {
      title_guess: out.title_guess,
      tech_summary: out.tech_summary,
      problem: out.problem,
      differentiators: out.differentiators,
      ipc_candidates: out.ipc_candidates ?? [],
      missing_items: out.missing_items ?? [],
      search_query_en: out.search_query_en,
      search_concepts: out.search_concepts ?? { ko: [], en: [] },
    },
    ready_for_research: !!out.ready_for_research,
    section_edit: out.section_edit?.schema_key?.trim()
      ? { schema_key: out.section_edit.schema_key.trim(), instruction: (out.section_edit.instruction ?? '').trim() }
      : null,
  }
}
