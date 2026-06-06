import Anthropic from '@anthropic-ai/sdk'
import { runTool, MissingKeyError } from './client'

export interface KoSummary {
  title_ko: string
  summary_ko: string
  relevance_ko: string
}

const INPUT_SCHEMA: Anthropic.Tool['input_schema'] = {
  type: 'object',
  properties: {
    title_ko: { type: 'string', description: '원문 제목의 한국어 번역' },
    summary_ko: { type: 'string', description: '초록의 한국어 요약 (2~3문장)' },
    relevance_ko: { type: 'string', description: '본 발명과의 관련성 / 중복 가능성' },
  },
  required: ['title_ko', 'summary_ko', 'relevance_ko'],
}

// Korean summary for a foreign-language prior-art ref (§14.3). Returns null when the
// Anthropic key is absent so the free retrieval path still completes (refs just lack
// a Korean summary). Grounded: summarizes only the supplied original text.
export async function summarizeForeignRef(opts: {
  inventionSummary: string
  refTitle: string
  refAbstract: string
}): Promise<KoSummary | null> {
  if (!opts.refTitle && !opts.refAbstract) return null
  try {
    return await runTool<KoSummary>({
      system:
        '당신은 특허 선행기술을 한국어로 요약하는 변리사 보조 AI입니다. 제공된 원문에 근거해서만 요약하고 내용을 지어내지 않습니다.',
      user: `[본 발명 요지]\n${opts.inventionSummary}\n\n[선행기술 원문 제목]\n${opts.refTitle}\n\n[초록]\n${opts.refAbstract || '(초록 없음)'}`,
      toolName: 'submit_summary',
      toolDescription: '선행기술의 한국어 제목·요약·관련성을 제출합니다.',
      inputSchema: INPUT_SCHEMA,
      maxTokens: 700,
    })
  } catch (e) {
    if (e instanceof MissingKeyError) return null
    throw e
  }
}
