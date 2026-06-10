import Anthropic from '@anthropic-ai/sdk'
import { runTool } from './client'
import type { UsageRecord } from './pricing'

// One KIPO 명세서 section's body prose, generated from the dossier + grounded prior art.
// Used by BOTH the right-pane "본문 생성" button (per-section) and chat-driven edits
// (instruction set). Citations are restricted to the supplied [1..N] allow-list; the
// route sanitizes the returned text before persisting (lib/llm/grounding.sanitizeRefMarkers).

export interface SectionRefItem {
  n: number
  title: string
  year?: string
  snippet: string
}

export interface GenSectionInput {
  sectionKey: string
  guidance?: string
  debrief: { title: string; tech_summary: string; problem: string; differentiators: string }
  refs: SectionRefItem[]
  claimScope?: string | null
  differentiation?: string[]
  currentText?: string | null // present when regenerating/editing an existing section
  instruction?: string | null // natural-language edit command (from chat)
  exemplar?: { title: string; sectionText: string } | null // Layer 2: 모범 명세서 같은 섹션(문체 참고용)
}

const SYSTEM = `당신은 대한민국 특허(KIPO) 명세서를 작성하는 변리사 보조 AI입니다. 발명 디브리프와 **실제 검색된 선행기술 목록[1]~[N]**, 차별성 분석을 바탕으로 명세서의 "지정된 한 섹션"의 본문을 한국어로 작성합니다.

엄격한 grounding(환각 방지):
- 선행기술 인용은 반드시 제공된 번호 [1]~[N]로만, 한 번호씩 대괄호로 표기합니다(예: [1][3]). 목록에 없는 번호나 문헌을 절대 지어내지 마세요.
- 근거가 없으면 인용 없이 사실에 기반해 작성합니다. 확인되지 않은 수치·실험결과를 단정하지 말고 예시적임을 밝히세요.

참고 예시 활용([참고 예시]가 주어진 경우):
- 그 예시는 다른 발명의 모범 명세서에서 가져온 "같은 섹션"입니다. **문체·문장 구성·서술 깊이·KIPO 특유의 표현**만 본받으세요.
- 예시의 **사실·수치·실험값·도면부호·인용문헌 번호·특허/제품 고유번호·고유명칭**을 절대 그대로 가져오지 마세요. 내용은 오직 이 발명의 디브리프와 선행기술[1]~[N]에서만 옵니다.
- 도면부호가 필요하면 예시의 번호(예: 110, 200)를 베끼지 말고 이 발명의 구성에 맞는 번호를 새로 부여합니다.
- 문단번호 【0001】 형식은 붙이지 말고 순수 산문 문단으로 작성합니다.

섹션별 작성 톤:
- 발명의 명칭: 간결한 명사구 한 줄.
- 기술분야: 1~2문장.
- 배경기술: 종래기술과 그 문제점(여기서 선행기술 [N] 인용이 자연스러움).
- 해결하려는 과제: 배경기술 문제점에서 도출한 목적.
- 과제의 해결 수단: 독립항과 정합하는 핵심 구성요소와 결합관계.
- 발명의 효과: 종래기술 대비 이점(가능하면 정량적).
- 도면의 간단한 설명: "도 1은 …을 도시한 것이다." 형식.
- 발명을 실시하기 위한 구체적인 내용: 실시예 중심 상세 설명, 도면부호(예: 압력센서(110)) 사용.
- 청구범위: "청구항 1. …를 포함하는 …." 독립항 + "청구항 2. 제1항에 있어서…" 종속항.

출력: text(해당 섹션 본문만, 순수 문단 텍스트 — 마크다운 헤더/불릿 금지), cited_ref_ns(이 섹션이 실제 근거로 삼은 번호만). 본 작업은 법률 자문이 아니며 변리사 검토가 필요합니다.`

const INPUT_SCHEMA: Anthropic.Tool['input_schema'] = {
  type: 'object',
  properties: {
    text: { type: 'string', description: '해당 섹션의 본문 (한국어, 순수 문단 텍스트)' },
    cited_ref_ns: {
      type: 'array',
      items: { type: 'integer' },
      description: '이 섹션이 실제로 근거로 인용한 선행기술 번호 (목록 [1..N] 내에서만)',
    },
  },
  required: ['text', 'cited_ref_ns'],
}

export async function generateSection(
  input: GenSectionInput,
  onUsage?: (u: UsageRecord) => void | Promise<void>,
): Promise<{ text: string; cited_ref_ns: number[] }> {
  const refList = input.refs
    .map((r) => `[${r.n}] ${r.title}${r.year ? ` (${r.year})` : ''}\n    ${r.snippet}`)
    .join('\n')

  const editBlock = input.currentText
    ? `\n\n[현재 본문]\n${input.currentText}\n\n[수정 지시]\n${input.instruction || '명세서 관점에서 더 구체적이고 정확하게 개선'}`
    : ''

  const exemplarBlock = input.exemplar
    ? `\n\n[참고 예시 — 다른 발명 「${input.exemplar.title}」 모범 명세서의 같은 섹션 · 문체 참고 전용]\n(사실·수치·도면부호·인용번호·고유명칭 복제 금지. 문단번호 【000N】도 붙이지 말 것.)\n${input.exemplar.sectionText}`
    : ''

  const user = `[작성 대상 섹션] 【${input.sectionKey}】
작성 지침: ${input.guidance ?? '(없음)'}

[발명 디브리프]
명칭: ${input.debrief.title}
기술 요지: ${input.debrief.tech_summary}
해결 과제: ${input.debrief.problem}
차별 요소(가설): ${input.debrief.differentiators}

[검색된 선행기술 (이 번호로만 인용)]
${refList || '(검색된 선행기술 없음 — 인용 없이 작성)'}

[분석 컨텍스트]
독립항 범위(가설): ${input.claimScope || '미정'}
차별점: ${input.differentiation?.length ? input.differentiation.join(' / ') : '없음'}${editBlock}${exemplarBlock}`

  return runTool<{ text: string; cited_ref_ns: number[] }>({
    system: SYSTEM,
    user,
    toolName: 'submit_section',
    toolDescription: '명세서 한 섹션의 본문과 근거 선행기술 번호를 제출합니다.',
    inputSchema: INPUT_SCHEMA,
    maxTokens: 2500,
    onUsage,
  })
}
