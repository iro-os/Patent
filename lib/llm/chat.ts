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
const FIRST_TURN_DIRECTIVE = `[첫 턴 특별 지침] 이번이 이 발명의 첫 메시지입니다. 짧게 답하지 말고, 발명자가 출원서 초안을 채울 수 있도록 명세서 관점에서 충실히 진단하세요:
1) ✅ **지금 채울 수 있는 항목** — 제공된 설명/자료만으로 작성 가능한 명세서 부분(발명의 명칭·기술분야·해결 과제·과제의 해결 수단·발명의 효과 등)을 구체적으로 짚고, 가능하면 핵심 문장을 미리 제안.
2) ⚠️ **아직 못 채우는 항목** — 정보가 부족해 비는 부분과, 그게 왜 필요한지.
3) 💪 **더 강하게 만들 부분** — 진보성·차별성을 높이려면 보강할 지점과, 그를 위해 답하면 좋은 구체 질문(선택 사항).
표나 리스트로 스캔하기 쉽게 구성하세요. 확인 질문은 여전히 선택임을 분명히 하고, 사용자가 건너뛰어도 진행 가능함을 알리세요.`

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
  }
}
