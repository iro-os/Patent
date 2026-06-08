import Anthropic from '@anthropic-ai/sdk'
import { runTool } from './client'
import type { UsageRecord } from './pricing'

// Numbered prior-art item handed to the model (closed allow-list for grounding).
export interface RefItem {
  n: number
  title: string
  year?: string
  snippet: string
}

export type OverlapRelation = 'discloses' | 'partial'
export type ElementOverall = 'novel' | 'partial' | 'known'
export type SuggestionKind = 'experiment' | 'data' | 'design'

export interface DifferentiationAnalysis {
  elements: {
    element: string
    overall: ElementOverall
    refs: { ref_n: number; relation: OverlapRelation; note: string }[]
  }[]
  differentiation_points: { point: string; supporting_ref_ns: number[] }[]
  develop_suggestions: { suggestion: string; kind: SuggestionKind; rationale: string }[]
  claim_strategy: { independent_scope: string; dependent_ladder: string[] }
}

const SYSTEM = `당신은 대한민국 특허 실무(KIPO)에 정통한 변리사 보조 AI입니다.
발명 디브리프와 **실제 검색된 선행기술 목록(번호 [1]~[N])** 을 받아 신규성·진보성 관점의 차별성 분석을 수행합니다.

엄격한 규칙(grounding):
- 선행기술은 반드시 제공된 번호로만 인용합니다. 목록에 없는 문헌이나 번호를 절대 지어내지 않습니다.
- 근거가 없으면 인용하지 말고 'novel'로 둡니다.

분석 내용:
- elements: 발명의 핵심 구성요소들을 도출하고, 각 요소가 선행기술 대비 어떤지 평가합니다.
  - overall: 'known'(선행기술이 그대로 개시) / 'partial'(일부만 개시) / 'novel'(선행기술에 없음=차별점).
  - refs: 관련된 선행기술만 {ref_n, relation('discloses'|'partial'), note} 로. novel 요소는 refs를 비웁니다.
- differentiation_points: 권리화에 유리한 차별점(white-space). 각 차별점의 근거가 되는 선행기술 번호(supporting_ref_ns)를 답니다(없으면 빈 배열).
- develop_suggestions: 진보성을 강화하기 위해 발명자가 보강할 것 — kind는 'experiment'(실험) / 'data'(데이터) / 'design'(설계). 각 rationale 포함.
- claim_strategy: independent_scope(독립항을 얼마나 넓게 쓸 수 있는지, 선행기술 중복으로 인한 제약 포함) + dependent_ladder(살아남은 차별점들로 구성한 종속항 사다리, 넓은→좁은 순서).

분량(간결성): 핵심에 집중해 과도하게 길게 쓰지 마세요 — elements는 핵심 구성요소 위주, differentiation_points 최대 8개, develop_suggestions 최대 6개, 각 note/rationale은 1~2문장.

주의: 본 분석은 신규성/진보성(특허성)만 다루며, 침해(FTO)는 다루지 않습니다. 법률 자문이 아닙니다. 모든 출력은 한국어로 작성합니다.`

const INPUT_SCHEMA: Anthropic.Tool['input_schema'] = {
  type: 'object',
  properties: {
    elements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          element: { type: 'string', description: '발명의 구성요소' },
          overall: { type: 'string', enum: ['novel', 'partial', 'known'] },
          refs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                ref_n: { type: 'integer', description: '선행기술 번호 (목록 내)' },
                relation: { type: 'string', enum: ['discloses', 'partial'] },
                note: { type: 'string' },
              },
              required: ['ref_n', 'relation', 'note'],
            },
          },
        },
        required: ['element', 'overall', 'refs'],
      },
    },
    differentiation_points: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          point: { type: 'string' },
          supporting_ref_ns: { type: 'array', items: { type: 'integer' } },
        },
        required: ['point', 'supporting_ref_ns'],
      },
    },
    develop_suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          suggestion: { type: 'string' },
          kind: { type: 'string', enum: ['experiment', 'data', 'design'] },
          rationale: { type: 'string' },
        },
        required: ['suggestion', 'kind', 'rationale'],
      },
    },
    claim_strategy: {
      type: 'object',
      properties: {
        independent_scope: { type: 'string' },
        dependent_ladder: { type: 'array', items: { type: 'string' } },
      },
      required: ['independent_scope', 'dependent_ladder'],
    },
  },
  required: ['elements', 'differentiation_points', 'develop_suggestions', 'claim_strategy'],
}

export async function generateDifferentiation(
  opts: {
    debrief: { title: string; tech_summary: string; problem: string; differentiators: string }
    items: RefItem[]
  },
  onUsage?: (u: UsageRecord) => void | Promise<void>,
): Promise<DifferentiationAnalysis> {
  const refList = opts.items
    .map((it) => `[${it.n}] ${it.title}${it.year ? ` (${it.year})` : ''}\n    ${it.snippet}`)
    .join('\n')

  const user = `[발명 디브리프]
명칭: ${opts.debrief.title}
기술 요지: ${opts.debrief.tech_summary}
해결 과제: ${opts.debrief.problem}
차별 요소(가설): ${opts.debrief.differentiators}

[검색된 선행기술 (이 번호로만 인용)]
${refList}`

  return runTool<DifferentiationAnalysis>({
    system: SYSTEM,
    user,
    toolName: 'submit_differentiation',
    toolDescription: '발명 구성요소별 차별성 분석, 차별점, 디벨롭 제안, 청구 전략을 제출합니다.',
    inputSchema: INPUT_SCHEMA,
    // Large structured output (elements + 차별점 + 보강제안 + 청구전략); give ample
    // headroom so it never trips the max_tokens truncation guard (which fails the turn).
    maxTokens: 8000,
    onUsage,
  })
}
