import Anthropic from '@anthropic-ai/sdk'
import { runTool } from './client'
import type { DebriefResult } from '@/lib/types'

const SYSTEM = `당신은 대한민국 특허 실무(KIPO)에 정통한 변리사 보조 AI입니다.
발명자가 제출한 거친 아이디어 설명을 읽고, 특허 명세서 작성을 위한 구조화된 디브리프를 작성합니다.

규칙:
- 모든 한국어 필드는 한국어로 작성합니다.
- 제공된 내용에 근거해서만 작성하고, 사실을 지어내지 않습니다. 불명확하면 missing_items 와 clarifying_questions 로 남깁니다.
- 선행기술 검색은 법적으로 전 세계 대상입니다(특허법 §29). PubMed·OpenAlex 등 영어 학술 DB 검색을 위해 핵심 개념의 **영어** 검색어를 반드시 제공합니다:
  - search_query_en: 불리언 연산자 없이 핵심 키워드를 자연스럽게 나열한 영어 질의 (예: "serum eye drop wearable eyewear sustained ocular delivery").
  - search_concepts.en: 개별 영어 핵심어 4~8개. search_concepts.ko: 대응 한국어 핵심어.
- clarifying_questions 는 정말로 빠졌거나 모호한 항목만 1~3개, 각 3~4개의 보기로 묻습니다. 공개 여부(신규성 상실/유예기간) 질문은 별도 폼에서 처리되므로 여기서 묻지 않습니다.
- readiness 는 다음이 입력에서 파악되는지 각각 boolean 으로 평가합니다: 핵심 과제(core_problem) / 기술적 해결수단(technical_solution) / 구체적 실시예(embodiment) / 차별점(differentiator) / 공개 여부 언급(disclosure_status).`

const INPUT_SCHEMA: Anthropic.Tool['input_schema'] = {
  type: 'object',
  properties: {
    title_guess: { type: 'string', description: '추정 발명의 명칭' },
    tech_summary: { type: 'string', description: '핵심 기술 요지 (2~4문장)' },
    problem: { type: 'string', description: '해결하고자 하는 과제' },
    differentiators: { type: 'string', description: '핵심 차별 요소(가설)' },
    ipc_candidates: {
      type: 'array',
      items: { type: 'string' },
      description: '추정 기술분야 / IPC·CPC 후보 (예: A61F 9/00)',
    },
    missing_items: {
      type: 'array',
      items: { type: 'string' },
      description: '명세서 작성에 필요하지만 누락·불명확한 항목',
    },
    search_query_en: {
      type: 'string',
      description: 'PubMed/OpenAlex용 영어 자연어 검색 질의 (불리언 연산자 없이)',
    },
    search_concepts: {
      type: 'object',
      properties: {
        ko: { type: 'array', items: { type: 'string' } },
        en: { type: 'array', items: { type: 'string' } },
      },
      required: ['ko', 'en'],
    },
    clarifying_questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' }, description: '3~4개 보기' },
        },
        required: ['question', 'options'],
      },
    },
    readiness: {
      type: 'object',
      properties: {
        core_problem: { type: 'boolean' },
        technical_solution: { type: 'boolean' },
        embodiment: { type: 'boolean' },
        differentiator: { type: 'boolean' },
        disclosure_status: { type: 'boolean' },
      },
      required: [
        'core_problem',
        'technical_solution',
        'embodiment',
        'differentiator',
        'disclosure_status',
      ],
    },
  },
  required: [
    'title_guess',
    'tech_summary',
    'problem',
    'differentiators',
    'ipc_candidates',
    'missing_items',
    'search_query_en',
    'search_concepts',
    'clarifying_questions',
    'readiness',
  ],
}

export async function generateDebrief(ideaText: string): Promise<DebriefResult> {
  return runTool<DebriefResult>({
    system: SYSTEM,
    user: `다음 발명 설명을 디브리프하세요:\n\n"""\n${ideaText}\n"""`,
    toolName: 'submit_debrief',
    toolDescription: '구조화된 발명 디브리프와 전 세계 선행기술 검색어를 제출합니다.',
    inputSchema: INPUT_SCHEMA,
    maxTokens: 2048,
  })
}
