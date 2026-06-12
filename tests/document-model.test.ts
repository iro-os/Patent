// 단일 문서 모델 — placeholders(앱 본문 전용 빈 헤딩) 동작 검증.
// 실행: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDocumentModel } from '../lib/spec/document-model'

const BODY = {
  '발명의 명칭': '스마트 장치',
  기술분야: '본 발명은 측정에 관한 것이다.',
  배경기술: '종래기술의 문제가 있다.',
  '해결하려는 과제': '정확도 향상.',
  '과제의 해결 수단': '본체와 센서를 포함한다.',
  '발명의 효과': '정확도가 향상된다.',
  '발명을 실시하기 위한 구체적인 내용': '실시예: 본체(100).',
}

function build(placeholders: boolean) {
  return buildDocumentModel({
    sections: Object.fromEntries(Object.entries(BODY).map(([k, v]) => [k, { text: v, canRevert: false }])),
    claimStrategy: null,
    abstract: placeholders ? null : '요약 본문.',
    refsCount: 0,
    placeholders,
  })
}

const allKeys = (containers: ReturnType<typeof build>) =>
  containers.flatMap((c) => c.sections.map((s) => s.sectionKey))

test('placeholders=true: 목차의 모든 점프 대상 헤딩이 존재 (대표도·도면·선택 섹션 포함)', () => {
  const keys = allKeys(build(true))
  for (const k of [
    '선행기술문헌',
    '도면의 간단한 설명',
    '실시예',
    '산업상 이용가능성',
    '부호의 설명',
    '수탁번호',
    '서열목록 자유텍스트',
    '청구범위',
    '요약',
    '대표도',
    '도면',
  ]) {
    assert.ok(keys.includes(k), `${k} 헤딩이 없음`)
  }
})

test('placeholders=true: 빈 선택 섹션은 note 한 줄(과한 본문 없음)', () => {
  const containers = build(true)
  const sec = containers.flatMap((c) => c.sections).find((s) => s.sectionKey === '실시예')!
  assert.equal(sec.kind, 'note')
  assert.match(sec.note ?? '', /비어 있음/)
  assert.equal(sec.paragraphs.length, 0)
})

test('placeholders=false (DOCX 경로): 빈 선택 섹션·도면 컨테이너는 생략', () => {
  const containers = build(false)
  const keys = allKeys(containers)
  for (const k of ['실시예', '산업상 이용가능성', '수탁번호', '서열목록 자유텍스트', '도면', '선행기술문헌']) {
    assert.ok(!keys.includes(k), `${k}가 DOCX 경로에 포함됨`)
  }
  assert.ok(!containers.some((c) => c.label === '도면'))
})

test('수동 작성된 실시예는 placeholders와 무관하게 prose로 렌더 (DOCX 포함)', () => {
  const containers = buildDocumentModel({
    sections: {
      ...Object.fromEntries(Object.entries(BODY).map(([k, v]) => [k, { text: v, canRevert: false }])),
      실시예: { text: '실시예 1: 온도 25도에서 측정하였다.', canRevert: false },
    },
    claimStrategy: null,
    abstract: null,
    refsCount: 0,
    placeholders: false,
  })
  const sec = containers.flatMap((c) => c.sections).find((s) => s.sectionKey === '실시예')
  assert.ok(sec, '실시예 미렌더')
  assert.equal(sec!.kind, 'prose')
})

test('placeholders=true: 요약 미작성이어도 요약서 컨테이너 + 미작성 노트', () => {
  const containers = build(true)
  const abstractSec = containers.flatMap((c) => c.sections).find((s) => s.sectionKey === '요약')!
  assert.equal(abstractSec.kind, 'note')
  assert.match(abstractSec.note ?? '', /미작성/)
})
