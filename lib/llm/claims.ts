import Anthropic from '@anthropic-ai/sdk'
import { runTool } from './client'
import type { UsageRecord } from './pricing'

// 청구항 세트 초안 생성 — "변리사 검토 워크벤치"의 AI 보조. 발명자용 문서 출력에서는
// 청구항을 자동 생성하지 않는다는 원칙(CLAIMS_NOT_GENERATED_NOTE)은 유지하되, 검토 탭에서
// 변리사가 명시적으로 요청하면 초안을 만들어 에디터에 채워 준다(저장은 사람이 결정).
//
// grounding 축이 본문 생성과 다르다: 여기서 인용할 근거는 선행기술이 아니라 **명세서 본문**이다.
// 청구항 용어는 발명의 설명에 뒷받침되어야 하므로(§42④1), 명세서 본문에 등장하는 용어만
// 사용하도록 강제하고, 호출부는 생성 직후 결정론 린터(checkSupport)로 재검증한다.

export interface DraftClaimsInput {
  debrief: { title: string; tech_summary: string; problem: string; differentiators: string }
  claimStrategy: { independent_scope: string | null; dependent_ladder: string[] } | null
  /** 명세서 본문 핵심 섹션 (과제의 해결 수단 · 구체적인 내용 · 발명의 효과 등) — 용어 allow-list */
  specSections: { key: string; text: string }[]
  differentiation: string[]
}

export interface DraftedClaim {
  number: number
  text: string
}

const SYSTEM = `당신은 대한민국 특허(KIPO) 청구범위를 작성하는 변리사 보조 AI입니다. 발명 디브리프, 청구 전략, 그리고 **명세서 본문**을 바탕으로 청구항 세트 초안을 한국어로 작성합니다. 이 초안은 변리사가 검토·수정하는 작업본이며 최종본이 아닙니다.

[형식 규칙 — 특허법 시행령 제5조]
- 청구항 1은 독립항. 발명의 필수 구성요소를 빠짐없이, 가장 넓되 선행기술과 구별되는 범위로.
- 종속항은 "제N항에 있어서, …" 형식으로 선행 청구항만 인용(뒤 번호 인용 금지).
- 2 이상의 항을 인용할 때는 반드시 택일적으로("제1항 또는 제2항에 있어서" / "제1항 내지 제3항 중 어느 한 항에 있어서").
- 2 이상의 항을 인용한 청구항(다중종속항)은 다른 다중종속항을 인용하지 않습니다.
- 각 청구항은 단일 문장으로, 말미는 카테고리 명사(…장치/…방법/…조성물 등)로 끝납니다.

[명확성 — §42④2]
- "약", "대략", "등", "바람직하게는", "필요에 따라" 같은 불명확 표현 금지.
- 구성요소를 처음 언급할 때는 그대로, 다시 언급할 때는 "상기 ○○"로 — 선행사 없는 "상기" 금지.

[뒷받침 — §42④1, 가장 중요]
- 청구항의 모든 기술 용어는 제공된 **명세서 본문에 실제로 등장하는 용어**만 사용하세요. 본문에 없는 새 용어·수치·재료를 지어내지 마세요.
- 수치 한정이 필요한데 본문에 수치가 없으면 수치 없이 구조·기능으로 한정하세요.

[전략 반영]
- 청구 전략의 독립항 범위를 청구항 1로 구체화하고, 종속항 사다리(dependent_ladder)를 종속항으로 전개하세요.
- 종속항은 5~9개 내외: 구체화(재료·배치·파라미터), 부가 구성, 가능하면 다른 카테고리(방법/시스템) 독립항 1개 추가.
- 다른 카테고리 독립항은 "제N항에 있어서" 형식이 아니라 독립 형식 또는 인용형식("제1항의 ○○를 이용하여 …하는 방법")으로.

출력: claims 배열 [{number(1부터 연속), text(헤더 없이 본문만)}]. 법률 자문이 아니며 변리사 검토·확정이 필요합니다.`

const INPUT_SCHEMA: Anthropic.Tool['input_schema'] = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      description: '청구항 초안 배열 (번호 1부터 연속)',
      items: {
        type: 'object',
        properties: {
          number: { type: 'integer' },
          text: { type: 'string', description: '청구항 본문 (【청구항 N】 헤더 제외, 단일 문장)' },
        },
        required: ['number', 'text'],
      },
    },
  },
  required: ['claims'],
}

export async function draftClaims(
  input: DraftClaimsInput,
  onUsage?: (u: UsageRecord) => void | Promise<void>,
): Promise<DraftedClaim[]> {
  const specBlock = input.specSections
    .filter((s) => s.text.trim())
    .map((s) => `【${s.key}】\n${s.text.trim()}`)
    .join('\n\n')

  const user = `[발명 디브리프]
명칭: ${input.debrief.title}
기술 요지: ${input.debrief.tech_summary}
해결 과제: ${input.debrief.problem}
차별 요소: ${input.debrief.differentiators}

[청구 전략]
독립항 범위: ${input.claimStrategy?.independent_scope ?? '(미수립 — 디브리프와 본문으로 직접 도출)'}
종속항 사다리:
${input.claimStrategy?.dependent_ladder?.length ? input.claimStrategy.dependent_ladder.map((d, i) => `${i + 1}. ${d}`).join('\n') : '(없음)'}

[차별점]
${input.differentiation.length ? input.differentiation.map((d) => `- ${d}`).join('\n') : '(없음)'}

[명세서 본문 — 청구항 용어는 반드시 여기 등장하는 용어만 사용]
${specBlock || '(본문 미생성 — 디브리프 용어만 사용하되, 본문 생성 후 재작성 권고를 전제로 보수적으로 작성)'}`

  const out = await runTool<{ claims: DraftedClaim[] }>({
    system: SYSTEM,
    user,
    toolName: 'submit_claims',
    toolDescription: '청구항 세트 초안을 제출합니다.',
    inputSchema: INPUT_SCHEMA,
    // 독립항 1~2 + 종속항 ~9개의 단일 문장 세트 기준 여유분. runTool은 max_tokens 절단을
    // 하드 에러로 바꾸므로 부족하면 늘릴 것.
    maxTokens: 3200,
    onUsage,
  })

  // 방어: 번호 누락/문자열 숫자 등 모델 변형을 정규화하고 번호순 정렬.
  return (out.claims ?? [])
    .filter((c) => c && typeof c.text === 'string' && c.text.trim())
    .map((c, i) => ({ number: Number.isFinite(Number(c.number)) ? Number(c.number) : i + 1, text: c.text.trim() }))
    .sort((a, b) => a.number - b.number)
}
