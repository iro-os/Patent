// 청구항 파서·린터·컴플라이언스 엔진 단위 테스트 (node:test, tsx 러너).
// 실행: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseClaims, formatClaims } from '../lib/claims/parse'
import { lintClaims, checkSupport, stripJosa } from '../lib/claims/lint'
import { runCompliance } from '../lib/kipo/compliance'

// ── 파서 ─────────────────────────────────────────────────────────────────────

test('parse: 【청구항 N】 헤더 + 여러 줄 본문', () => {
  const { claims, empty } = parseClaims(
    '【청구항 1】\n본체; 및\n상기 본체에 결합된 온도 센서를 포함하는 측정 장치.\n\n【청구항 2】\n제1항에 있어서, 상기 온도 센서는 서미스터인 측정 장치.',
  )
  assert.equal(empty, false)
  assert.equal(claims.length, 2)
  assert.equal(claims[0].number, 1)
  assert.match(claims[0].text, /본체; 및\n상기 본체에 결합된/)
  assert.deepEqual(claims[0].cites, [])
  assert.deepEqual(claims[1].cites, [1])
  assert.equal(claims[1].category, 'product')
})

test('parse: [청구항 N] / 청구항 N. 형식 + 인라인 본문', () => {
  const { claims } = parseClaims('[청구항 1]\n어떤 장치.\n청구항 2. 제1항에 있어서, 추가 구성을 포함하는 장치.')
  assert.equal(claims.length, 2)
  assert.equal(claims[1].number, 2)
  assert.deepEqual(claims[1].cites, [1])
})

test('parse: 본문 속 "청구항 1에 따른"은 헤더로 오인하지 않음', () => {
  const { claims } = parseClaims('【청구항 1】\n장치.\n【청구항 2】\n청구항 1에 따른 장치를 이용하는 방법.')
  assert.equal(claims.length, 2)
  assert.equal(claims[1].text.includes('청구항 1에 따른'), true)
})

test('parse: "제1항 내지 제4항 중 어느 한 항" 범위 전개 + 택일적', () => {
  const { claims } = parseClaims('【청구항 5】\n제1항 내지 제4항 중 어느 한 항에 있어서, 추가 요소를 포함하는 장치.')
  assert.deepEqual(claims[0].cites, [1, 2, 3, 4])
  assert.equal(claims[0].alternative, true)
  assert.equal(claims[0].conjunctive, false)
})

test('parse: "제1항 및 제2항" 병합적 기재 감지', () => {
  const { claims } = parseClaims('【청구항 3】\n제1항 및 제2항에 있어서, 추가 요소를 포함하는 장치.')
  assert.deepEqual(claims[0].cites, [1, 2])
  assert.equal(claims[0].conjunctive, true)
})

test('parse: 방법 카테고리 분류', () => {
  const { claims } = parseClaims('【청구항 1】\n시료를 가열하는 단계를 포함하는 측정 방법.')
  assert.equal(claims[0].category, 'method')
})

test('formatClaims: 번호순 정렬 + 표준 헤더', () => {
  const out = formatClaims([
    { number: 2, text: '둘째.' },
    { number: 1, text: '첫째.' },
  ])
  assert.equal(out, '【청구항 1】\n첫째.\n\n【청구항 2】\n둘째.')
})

// ── 린터 ─────────────────────────────────────────────────────────────────────

const rules = (issues: { rule: string }[]) => issues.map((i) => i.rule)

test('lint: 깨끗한 세트 → 이슈 없음', () => {
  const { claims } = parseClaims(
    '【청구항 1】\n본체와, 상기 본체에 결합된 센서를 포함하는 장치.\n\n【청구항 2】\n제1항에 있어서, 상기 센서는 압력 센서인 장치.',
  )
  assert.deepEqual(lintClaims(claims), [])
})

test('lint: 청구항 1이 종속 형식이면 error', () => {
  const { claims } = parseClaims('【청구항 1】\n제2항에 있어서, 추가 요소를 포함하는 장치.\n【청구항 2】\n장치.')
  const issues = lintClaims(claims)
  assert.ok(rules(issues).includes('claim1_dependent'))
  assert.ok(rules(issues).includes('forward_reference'))
})

test('lint: 존재하지 않는 항 인용 → missing_reference', () => {
  const { claims } = parseClaims('【청구항 1】\n장치.\n【청구항 2】\n제1항에 있어서 요소를 포함하는 장치.\n【청구항 3】\n제1항에 있어서… 장치.')
  // 결번 인용 케이스: 4번이 9항 인용 — 9항 없음 + forward
  const { claims: c2 } = parseClaims('【청구항 1】\n장치.\n【청구항 2】\n제9항에 있어서, 요소를 포함하는 장치.')
  const issues = lintClaims(c2)
  assert.ok(rules(issues).includes('forward_reference'))
  assert.deepEqual(lintClaims(claims).filter((i) => i.severity === 'error'), [])
})

test('lint: 다중종속항의 다중종속항 인용 → multi_multi_dependent error', () => {
  const { claims } = parseClaims(
    '【청구항 1】\n장치.\n【청구항 2】\n요소를 더 포함하는 장치.\n【청구항 3】\n제1항 또는 제2항에 있어서, A를 포함하는 장치.\n【청구항 4】\n제2항 또는 제3항에 있어서, B를 포함하는 장치.',
  )
  const issues = lintClaims(claims)
  assert.ok(rules(issues).includes('multi_multi_dependent'))
})

test('lint: 2 이상 인용이 택일적이 아니면 warn', () => {
  const { claims } = parseClaims('【청구항 1】\n장치.\n【청구항 2】\n요소가 있는 장치.\n【청구항 3】\n제1항 및 제2항에 있어서, A를 포함하는 장치.')
  const issues = lintClaims(claims)
  const hit = issues.find((i) => i.rule === 'non_alternative_citation')
  assert.ok(hit)
  assert.equal(hit!.severity, 'warn')
})

test('lint: "상기 X" 선행사 미기재 → warn / 조상 청구항에 있으면 통과', () => {
  // 미기재: 상기 가열부 — 어디에도 도입 안 됨
  const bad = parseClaims('【청구항 1】\n본체를 포함하고, 상기 가열부가 동작하는 장치.')
  assert.ok(rules(lintClaims(bad.claims)).includes('antecedent_basis'))

  // 조상에서 도입: 1항의 "온도 센서" → 2항의 "상기 온도 센서" OK
  const ok = parseClaims(
    '【청구항 1】\n온도 센서를 포함하는 장치.\n【청구항 2】\n제1항에 있어서, 상기 온도 센서는 서미스터인 장치.',
  )
  assert.ok(!rules(lintClaims(ok.claims)).includes('antecedent_basis'))
})

test('lint: 같은 청구항 안에서 먼저 도입된 뒤 "상기"는 통과', () => {
  const { claims } = parseClaims('【청구항 1】\n제어부; 및 상기 제어부에 연결된 센서를 포함하는 장치.')
  assert.ok(!rules(lintClaims(claims)).includes('antecedent_basis'))
})

test('lint: 불명확 표현(약+수치, 바람직하게는, 등) → warn', () => {
  const { claims } = parseClaims('【청구항 1】\n약 10mm의 두께를 갖고, 바람직하게는 금속, 세라믹 등으로 형성되는 장치.')
  const found = lintClaims(claims).filter((i) => i.rule === 'unclear_term')
  assert.ok(found.length >= 3)
})

test('lint: 번호 결번/중복 감지', () => {
  const gap = parseClaims('【청구항 1】\n장치.\n【청구항 3】\n제1항에 있어서, A를 포함하는 장치.')
  assert.ok(rules(lintClaims(gap.claims)).includes('numbering'))
  const dup = parseClaims('【청구항 1】\n장치.\n【청구항 1】\n다른 장치.')
  assert.ok(rules(lintClaims(dup.claims)).includes('duplicate_number'))
})

test('lint: 시작 번호 ≠ 1 이면서 내부 결번 — 둘 다 보고 (리뷰 반영)', () => {
  const { claims } = parseClaims('【청구항 2】\n장치.\n【청구항 5】\n제2항에 있어서, A를 포함하는 장치.')
  const numbering = lintClaims(claims).filter((i) => i.rule === 'numbering')
  assert.equal(numbering.length, 2) // 시작 번호 경고 + 결번 경고
})

test('parse: 4자리 청구항 번호·인용도 인식 (리뷰 반영 — 침묵 누락 방지)', () => {
  const { claims } = parseClaims('【청구항 1000】\n장치.\n【청구항 1001】\n제1000항에 있어서, A를 포함하는 장치.')
  assert.equal(claims.length, 2)
  assert.equal(claims[0].number, 1000)
  assert.deepEqual(claims[1].cites, [1000])
})

test('lint: 종속 형식 카테고리 불일치 → warn, 인용형식 독립항은 제외', () => {
  const dep = parseClaims('【청구항 1】\n측정 장치.\n【청구항 2】\n제1항에 있어서, 가열하는 단계를 포함하는 측정 방법.')
  assert.ok(rules(lintClaims(dep.claims)).includes('category_mismatch'))
  // 인용형식 독립항 ("…에 있어서" 없음) — 카테고리 전환 허용
  const indep = parseClaims('【청구항 1】\n측정 장치.\n【청구항 2】\n제1항의 측정 장치를 이용하여 시료를 측정하는 방법.')
  assert.ok(!rules(lintClaims(indep.claims)).includes('category_mismatch'))
})

// ── 뒷받침 검사 ──────────────────────────────────────────────────────────────

test('stripJosa: 대표 조사 제거', () => {
  assert.equal(stripJosa('센서를'), '센서')
  assert.equal(stripJosa('본체에'), '본체')
  assert.equal(stripJosa('서미스터인'), '서미스터인') // 조사 아님 — 보존
})

test('support: 명세서에 없는 용어만 지적, 공백 차이는 흡수', () => {
  const { claims } = parseClaims('【청구항 1】\n온도센서와 냉각팬을 포함하는 장치.')
  const spec = '본 발명의 장치는 온도 센서(110)를 포함한다.'
  const issues = checkSupport(claims, spec)
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /냉각팬/)
  assert.ok(!issues[0].message.includes('온도센서'))
})

test('support: 명세서 비어 있으면 검사 생략', () => {
  const { claims } = parseClaims('【청구항 1】\n임의 장치.')
  assert.deepEqual(checkSupport(claims, '   '), [])
})

// ── 컴플라이언스 엔진 ────────────────────────────────────────────────────────

const FULL_SECTIONS: Record<string, string> = {
  '발명의 명칭': '스마트 온도 측정 장치',
  기술분야: '본 발명은 온도 측정에 관한 것이다.',
  배경기술: '종래기술의 문제 [1] 이 있다.',
  '해결하려는 과제': '정확도 향상.',
  '과제의 해결 수단': '본체와 온도 센서를 포함한다.',
  '발명의 효과': '정확도가 향상된다.',
  '발명을 실시하기 위한 구체적인 내용': '실시예: 본체(100), 온도 센서(110).',
}

test('compliance: 전체 통과 시나리오', () => {
  const results = runCompliance({
    sections: FULL_SECTIONS,
    abstract: '본 발명은 본체와 온도 센서를 포함하는 측정 장치로서, 종래 대비 정확도를 높인다. '.repeat(3),
    claimsText: '【청구항 1】\n본체와, 상기 본체에 결합된 온도 센서를 포함하는 측정 장치.',
    refs: [{ source: 'pubmed', title: '문헌', pub_date: '2024-01-01', url: 'https://x', ext_id: 'p1' }],
  })
  assert.equal(results.length, 7)
  const by = Object.fromEntries(results.map((r) => [r.check, r.status]))
  assert.equal(by.all_sections_present, 'pass')
  assert.equal(by.claim_1_is_independent, 'pass')
  assert.equal(by.no_fabricated_citations, 'pass')
  assert.equal(by.prior_art_documents_formatted, 'pass')
  assert.equal(by.abstract_within_length, 'pass')
})

test('compliance: 필수 섹션 누락 → fail, 청구항 없음 → na', () => {
  const results = runCompliance({
    sections: { 기술분야: '있음' },
    abstract: null,
    claimsText: null,
    refs: [],
  })
  const by = Object.fromEntries(results.map((r) => [r.check, r]))
  assert.equal(by.all_sections_present.status, 'fail')
  assert.ok(by.all_sections_present.details.length >= 6)
  assert.equal(by.claim_1_is_independent.status, 'na')
  assert.equal(by.prior_art_documents_formatted.status, 'na')
  assert.equal(by.abstract_within_length.status, 'na')
})

test('compliance: 범위 밖 인용 [9] → no_fabricated_citations fail', () => {
  const results = runCompliance({
    sections: { ...FULL_SECTIONS, 배경기술: '종래기술 [1] 과 [9] 문제.' },
    abstract: '요약 텍스트입니다. '.repeat(10),
    claimsText: null,
    refs: [{ source: 'pubmed', title: 'A', pub_date: '2024-01-01' }],
  })
  const r = results.find((x) => x.check === 'no_fabricated_citations')!
  assert.equal(r.status, 'fail')
  assert.match(r.details[0], /배경기술/)
})

test('compliance: 서지정보 누락 → warn', () => {
  const results = runCompliance({
    sections: FULL_SECTIONS,
    abstract: '적절한 길이의 요약입니다. '.repeat(8),
    claimsText: null,
    refs: [{ source: 'openalex', title: null, pub_date: null }],
  })
  const r = results.find((x) => x.check === 'prior_art_documents_formatted')!
  assert.equal(r.status, 'warn')
})
