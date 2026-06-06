// KIPO 명세서 (specification) section schema — the target structure for 특허 형식 자동 매핑.
// Order matters: this is the document layout exported to the 변리사.
export const KIPO_SECTIONS = [
  { key: '발명의 명칭', en: 'Title of the invention' },
  { key: '기술분야', en: 'Technical field' },
  { key: '발명의 배경이 되는 기술', en: 'Background art' },
  { key: '해결하고자 하는 과제', en: 'Problem to be solved' },
  { key: '과제의 해결 수단', en: 'Means of solution' }, // should paraphrase the 독립항
  { key: '발명의 효과', en: 'Effects of the invention' },
  { key: '도면의 간단한 설명', en: 'Brief description of drawings' },
  { key: '발명을 실시하기 위한 구체적인 내용', en: 'Detailed description (embodiments)' },
  { key: '부호의 설명', en: 'Reference numerals' },
  { key: '청구범위', en: 'Claims (독립항 + 종속항)' },
  { key: '요약서', en: 'Abstract (요약 + 대표도)' },
] as const

export type KipoSectionKey = (typeof KIPO_SECTIONS)[number]['key']

// MVP compliance checklist (programmatic gate; replaces the subjective "변리사에 넘길 만하다").
export const COMPLIANCE_CHECKS = [
  'all_sections_present',
  'claim_1_is_independent', // 청구항 1 == 독립항
  'every_dependent_references_prior_claim', // 종속항 → 선행 청구항
  'antecedent_basis_ok', // 모든 청구항 용어가 명세서에 존재 (기재불비 방지)
  'no_fabricated_citations', // grounding validator passed
  'abstract_within_length',
] as const
export type ComplianceCheck = (typeof COMPLIANCE_CHECKS)[number]
