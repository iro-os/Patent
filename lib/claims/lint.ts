// 청구항 결정론 린터 — LLM 없이 순수 규칙으로 검사한다(재현 가능·즉시·무비용).
// 확정 룰(시행령 §5 인용 규칙)은 error, 휴리스틱(선행사·불명확 표현·뒷받침)은 warn으로만
// 표시한다 — 확정 판단은 변리사 몫이라는 제품 철학(면책·정직성)과 동일선상.
//
// 법적 근거 요약:
//  · 특허법 §42④1 — 청구항은 발명의 설명에 의해 뒷받침될 것
//  · 특허법 §42④2 — 청구항은 명확하고 간결하게 기재될 것
//  · 특허법 시행령 §5④ — 2 이상의 항을 인용할 때는 택일적으로 기재
//  · 시행령 §5⑤ — 2 이상의 항을 인용한 청구항은 같은 형식의 청구항을 다시 인용 금지(다중종속 중첩)
//  · 시행령 §5⑥ — 인용되는 청구항은 인용하는 청구항보다 먼저 기재

import type { ParsedClaim } from './parse'

export type LintSeverity = 'error' | 'warn'

export interface LintIssue {
  rule: string
  severity: LintSeverity
  claimNumber: number | null // null = 세트 전체 이슈
  message: string
  basis?: string // 법조문/실무 근거 라벨
}

// ── 한국어 조사 스트리핑(휴리스틱) — 긴 것부터 시도 ─────────────────────────
const JOSA = [
  '으로서', '으로써', '에서의', '에게서', '이라는', '라는', '에서는', '에는',
  '으로', '로서', '로써', '에서', '에게', '부터', '까지', '보다', '처럼', '마다', '조차', '만큼',
  '이며', '이고', '이가', '와의', '과의',
  '이', '가', '은', '는', '을', '를', '과', '와', '의', '에', '로', '도', '만', '나', '며', '고',
]

export function stripJosa(word: string): string {
  const w = word.replace(/[.,;:!?'"”’)\]】]+$/g, '')
  for (const j of JOSA) {
    if (w.length > j.length + 1 && w.endsWith(j)) return w.slice(0, w.length - j.length)
  }
  return w
}

// ── 불명확 표현(§42④2 심사기준에서 명확성 흠결로 자주 지적되는 표현) ────────
const UNCLEAR_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /약\s*\d/, label: '약 + 수치' },
  { re: /대략/, label: '대략' },
  { re: /거의/, label: '거의' },
  { re: /실질적으로/, label: '실질적으로' },
  { re: /바람직하게는|바람직하기로는/, label: '바람직하게는' },
  { re: /필요에\s*따라/, label: '필요에 따라' },
  { re: /적절한|적절히/, label: '적절한' },
  { re: /충분한|충분히/, label: '충분한' },
  { re: /임의의/, label: '임의의' },
  { re: /예를\s*들어|예컨대/, label: '예를 들어' },
  { re: /(^|[\s,])등(?:으로|의|을|이|에|과|와)?([\s,.]|$)/, label: '… 등' },
  { re: /약간|다소/, label: '약간/다소' },
]

// ── "상기 X" 선행사 후보 추출 (최대 3어절, 긴 후보부터 매칭 시도) ────────────
const SANGGI_RE = /상기\s+((?:[가-힣A-Za-z0-9·-]+)(?:\s+(?!상기)[가-힣A-Za-z0-9·-]+){0,2})/g

function antecedentCandidates(phrase: string): string[] {
  const words = phrase.split(/\s+/)
  const out: string[] = []
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const cand = words.slice(0, n).join(' ')
    const stripped = [...words.slice(0, n - 1), stripJosa(words[n - 1])].join(' ')
    out.push(stripped)
    if (stripped !== cand) out.push(cand)
  }
  return [...new Set(out)].filter((c) => c.replace(/\s/g, '').length >= 2)
}

/** 청구항의 (전이적) 인용 조상 텍스트 — 선행사 기재의 탐색 범위. */
function ancestorText(claim: ParsedClaim, byNum: Map<number, ParsedClaim>): string {
  const seen = new Set<number>()
  const stack = [...claim.cites]
  const parts: string[] = []
  while (stack.length) {
    const n = stack.pop()!
    if (seen.has(n)) continue
    seen.add(n)
    const c = byNum.get(n)
    if (!c) continue
    parts.push(c.text)
    stack.push(...c.cites)
  }
  return parts.join('\n')
}

/** 종속 "형식"(…에 있어서)인지 — 인용형식 독립항(제N항의 장치를 이용한 방법 등)과 구분. */
function isDependentForm(c: ParsedClaim): boolean {
  return c.cites.length > 0 && /에\s*있어서/.test(c.text)
}

// ── 메인 린트 ────────────────────────────────────────────────────────────────
export function lintClaims(claims: ParsedClaim[]): LintIssue[] {
  const issues: LintIssue[] = []
  if (!claims.length) return issues

  const byNum = new Map(claims.map((c) => [c.number, c]))

  // 번호 체계: 1부터 연속·중복 없음 (실무 형식 요건)
  const numbers = claims.map((c) => c.number)
  if (new Set(numbers).size !== numbers.length) {
    issues.push({ rule: 'duplicate_number', severity: 'error', claimNumber: null, message: '중복된 청구항 번호가 있습니다.' })
  }
  const sorted = [...new Set(numbers)].sort((a, b) => a - b)
  if (sorted[0] !== 1) {
    issues.push({ rule: 'numbering', severity: 'warn', claimNumber: sorted[0], message: `청구항 번호가 1이 아닌 ${sorted[0]}부터 시작합니다.` })
  }
  // 결번은 시작 번호와 무관하게 검사 (1이 아닌 시작 + 내부 결번이 동시에 있을 수 있다)
  if (sorted[sorted.length - 1] - sorted[0] + 1 !== sorted.length) {
    issues.push({ rule: 'numbering', severity: 'warn', claimNumber: null, message: '청구항 번호에 빠진 번호(결번)가 있습니다.' })
  }

  // 청구항 1은 독립항이어야 (종속 형식 금지)
  const first = byNum.get(1)
  if (first && isDependentForm(first)) {
    issues.push({
      rule: 'claim1_dependent', severity: 'error', claimNumber: 1,
      message: '청구항 1이 다른 항을 인용하는 종속 형식입니다 — 첫 항은 독립항이어야 합니다.',
      basis: '실무 원칙',
    })
  }

  for (const c of claims) {
    // 인용 무결성: 자기/뒷번호/결번 인용
    for (const n of c.cites) {
      if (n === c.number) {
        issues.push({ rule: 'self_reference', severity: 'error', claimNumber: c.number, message: `청구항 ${c.number}이(가) 자기 자신을 인용합니다.` })
      } else if (n > c.number) {
        issues.push({
          rule: 'forward_reference', severity: 'error', claimNumber: c.number,
          message: `청구항 ${c.number}이(가) 뒤에 오는 제${n}항을 인용합니다 — 인용되는 항이 먼저 기재되어야 합니다.`,
          basis: '시행령 §5⑥',
        })
      } else if (!byNum.has(n)) {
        issues.push({ rule: 'missing_reference', severity: 'error', claimNumber: c.number, message: `청구항 ${c.number}이(가) 존재하지 않는 제${n}항을 인용합니다.` })
      }
    }

    // 다중종속항(2 이상 인용)이 다른 다중종속항을 인용 — 금지
    if (c.cites.length >= 2) {
      for (const n of c.cites) {
        const parent = byNum.get(n)
        if (parent && parent.cites.length >= 2) {
          issues.push({
            rule: 'multi_multi_dependent', severity: 'error', claimNumber: c.number,
            message: `청구항 ${c.number}(다중 인용)이 역시 2 이상의 항을 인용하는 제${n}항을 인용합니다 — 다중종속항의 다중종속항 인용은 허용되지 않습니다.`,
            basis: '시행령 §5⑤',
          })
        }
      }
      // 2 이상 인용은 택일적("또는"/"중 어느 한 항") 기재
      if (c.conjunctive || !c.alternative) {
        issues.push({
          rule: 'non_alternative_citation', severity: 'warn', claimNumber: c.number,
          message: `청구항 ${c.number}이(가) 2 이상의 항을 인용하면서 택일적("또는", "중 어느 한 항")으로 기재되지 않은 것으로 보입니다.`,
          basis: '시행령 §5④',
        })
      }
    }

    // 종속 형식인데 카테고리가 부모와 다르면 주의 (인용형식 독립항은 제외)
    if (isDependentForm(c) && c.category !== 'unknown') {
      for (const n of c.cites) {
        const parent = byNum.get(n)
        if (parent && parent.category !== 'unknown' && parent.category !== c.category) {
          issues.push({
            rule: 'category_mismatch', severity: 'warn', claimNumber: c.number,
            message: `청구항 ${c.number}(${c.category === 'method' ? '방법' : '물건'})이 카테고리가 다른 제${n}항(${parent.category === 'method' ? '방법' : '물건'})을 종속 형식으로 인용합니다 — 의도한 카테고리 전환(인용형식)이라면 독립 형식 기재를 검토하세요.`,
            basis: '§42④2',
          })
          break
        }
      }
    }

    // "상기 X" 선행사 기재 검사 (휴리스틱 → warn)
    const ancestors = ancestorText(c, byNum)
    const flagged = new Set<string>()
    for (const m of c.text.matchAll(SANGGI_RE)) {
      const before = ancestors + '\n' + c.text.slice(0, m.index)
      const cands = antecedentCandidates(m[1])
      const found = cands.some((cand) => before.includes(cand))
      if (!found) {
        const base = cands[cands.length - 1] ?? m[1]
        if (!flagged.has(base)) {
          flagged.add(base)
          issues.push({
            rule: 'antecedent_basis', severity: 'warn', claimNumber: c.number,
            message: `청구항 ${c.number}의 "상기 ${m[1]}" — 앞서 도입되지 않은 구성요소일 수 있습니다(선행사 미기재 의심).`,
            basis: '§42④2',
          })
        }
      }
    }

    // 불명확 표현 (§42④2)
    for (const { re, label } of UNCLEAR_PATTERNS) {
      if (re.test(c.text)) {
        issues.push({
          rule: 'unclear_term', severity: 'warn', claimNumber: c.number,
          message: `청구항 ${c.number}에 불명확 표현 가능성: “${label}” — 권리범위를 불명확하게 할 수 있습니다.`,
          basis: '§42④2',
        })
      }
    }
  }

  return issues
}

// ── 명세서 뒷받침 검사 (§42④1) — 청구항 용어가 발명의 설명에 존재하는가 ──────
const SUPPORT_STOPWORDS = new Set([
  '있어서', '상기', '해당', '것', '수', '및', '또는', '중', '어느', '한', '하나', '항', '제', '등',
  '각각', '적어도', '이상', '이하', '내지', '같은', '다른', '위한', '따른', '따라', '의해', '의한',
  '통해', '대한', '대해', '관한', '면', '때', '바', '더', '단계', '특징',
])

// 용언(동사·형용사 활용형) 꼬리 — 명사 위주로 검사하기 위해 제외
const VERBAL_TAIL = /(하는|되는|하여|하며|하고|되어|시키는|시켜|이루어진|구비한|포함한|형성된|구성된|마련된|배치된|연결된|결합된|구비하는|포함하는)$/

export function checkSupport(claims: ParsedClaim[], specText: string): LintIssue[] {
  if (!specText.trim() || !claims.length) return []
  const issues: LintIssue[] = []
  const spec = specText.replace(/\s+/g, ' ')

  for (const c of claims) {
    const missing: string[] = []
    const seen = new Set<string>()
    for (const rawWord of c.text.split(/[\s,;:()【】[\]"“”'’]+/)) {
      const w = stripJosa(rawWord)
      if (w.length < 2 || w.length > 20) continue
      if (!/^[가-힣A-Za-z0-9·-]+$/.test(w)) continue
      if (/^\d+$/.test(w)) continue
      if (SUPPORT_STOPWORDS.has(w)) continue
      if (VERBAL_TAIL.test(w)) continue
      if (seen.has(w)) continue
      seen.add(w)
      // 공백 제거본까지 시도 — "온도 센서" vs "온도센서" 표기 차이 흡수
      if (!spec.includes(w) && !spec.replace(/\s/g, '').includes(w)) missing.push(w)
    }
    if (missing.length) {
      issues.push({
        rule: 'unsupported_terms', severity: 'warn', claimNumber: c.number,
        message: `청구항 ${c.number}의 용어가 발명의 설명에서 발견되지 않습니다: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ` 외 ${missing.length - 8}건` : ''} — 뒷받침(§42④1) 확인 필요.`,
        basis: '§42④1',
      })
    }
  }
  return issues
}
