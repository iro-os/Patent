import { Document, Packer, Paragraph, TextRun, AlignmentType, LineRuleType } from 'docx'
import { formatKipoCitation } from '@/lib/kipo/sections'
import { buildDocumentModel, paraLabel, type DocSection } from '@/lib/spec/document-model'
import type { PriorArtSource } from '@/lib/types'

// DOCX assembly for the 변리사 handoff (P0-B). 단일 문서 모델(buildDocumentModel)을 walk하여
// 앱 본문 뷰와 **동일한** 별지15호 계층·연속 문단번호 【000N】·요약서를 그린다. 두 출력이
// 같은 모델을 쓰므로 형식이 어긋날 수 없다. 청구항 실제 텍스트는 P1 — 지금은 전략 블록.

export interface ExportRef {
  source: PriorArtSource
  title?: string | null
  pub_date?: string | null
  url?: string | null
  ext_id?: string | null
}

export interface ExportInput {
  title: string
  sections: Record<string, string> // schema_key -> generated_text (생성된 것만)
  refs?: ExportRef[]
  claimStrategy?: { independent_scope: string | null; dependent_ladder: string[] } | null
  abstract?: string | null // 요약서 본문 (spec_sections['요약'])
  repFigure?: string | null // 대표도
  grace?: { grace_deadline?: string; days_remaining?: number; expired?: boolean } | null
}

// 바탕(Batang)은 한국 특허 명세서 관행 글꼴. Word/한글에 있으면 적용, 없으면 뷰어가 폴백.
const FONT = 'Batang'

function para(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: 22 })],
    // 줄간격 ~1.5 (line 360 = 1.5배) — 예시처럼 여유 있게. 단락 후 간격도 약간↑.
    spacing: { after: 140, line: 360, lineRule: LineRuleType.AUTO },
    indent: { firstLine: 200 },
  })
}
function hx(label: string, size: number): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `【${label}】`, bold: true, font: FONT, size })],
    spacing: { before: 240, after: 120 },
  })
}
function muted(text: string, size = 20): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, italics: true, font: FONT, size, color: '999999' })],
    spacing: { after: 120 },
  })
}
// 최상위 구분(발명의 설명/청구범위/요약서) — 예시처럼 가운데 정렬 대제목.
function divisionHeading(label: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `【${label}】`, bold: true, font: FONT, size: 30 })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 360, after: 160 },
  })
}

// 모델 섹션 → 단락들. subContainer(발명의 내용) 표제·섹션 표제·번호 단락/전략/노트를 emit.
function renderSection(sec: DocSection): Paragraph[] {
  const out: Paragraph[] = []
  if (sec.subContainerStart) out.push(hx(sec.subContainerStart, 24))
  // 청구범위는 컨테이너 표제(【청구범위】)가 곧 그 섹션이라 중복 표제를 생략한다.
  if (sec.kind !== 'claimStrategy') out.push(hx(sec.label, sec.depth === 2 ? 23 : 24))
  if (sec.kind === 'prose') {
    for (const p of sec.paragraphs) out.push(para((p.num ? `${paraLabel(p.num)} ` : '') + p.text))
  } else if (sec.kind === 'claimStrategy' && sec.claim) {
    out.push(para(`(청구 전략 — 실제 청구항 텍스트는 후속 단계) 독립항 범위: ${sec.claim.independentScope ?? ''}`))
    sec.claim.ladder.forEach((c, i) => out.push(para(`종속 ${i + 1}. ${c}`)))
  } else if (sec.kind === 'note') {
    out.push(muted(sec.note ?? ''))
  }
  return out
}

export async function buildSpecDocx(input: ExportInput): Promise<Buffer> {
  const children: Paragraph[] = []

  // ── 표지: 예시는 별도 '명 세 서' 표지 없이 【발명의 설명】으로 시작하고 제목은 【발명의 명칭】에만
  //    둔다(제목 중복 제거). 법적 안전을 위한 AI 초안 고지만 상단에 작게. §30 배너는 그 아래.
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: '특허 명세서 (AI 초안 · 변리사 검토 필요)', font: FONT, size: 18, color: '888888' }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
  )

  // ── §30 공지예외 배너 ──
  if (input.grace?.grace_deadline) {
    const g = input.grace
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `※ §30 공지예외 마감: ${g.grace_deadline}${g.expired ? ' (도과 가능성 — 변리사 확인)' : ` (${g.days_remaining}일 남음)`}`,
            font: FONT,
            size: 18,
            color: g.expired ? 'CC0000' : 'B7791F',
          }),
        ],
        spacing: { after: 200 },
      }),
    )
  }

  // ── 본문: 단일 문서 모델 walk (앱 본문과 동일 구조) ──
  const containers = buildDocumentModel({
    sections: Object.fromEntries(
      Object.entries(input.sections).map(([k, v]) => [k, { text: v, canRevert: false }]),
    ),
    claimStrategy: input.claimStrategy,
    abstract: input.abstract,
    repFigure: input.repFigure,
    refsCount: input.refs?.length ?? 0,
    priorArtLines: (input.refs ?? []).map((r, i) => formatKipoCitation(r, i + 1).text),
  })

  if (containers.length === 0) {
    children.push(muted('(미작성 — 본문 생성 필요)'))
  } else {
    for (const c of containers) {
      children.push(divisionHeading(c.label))
      for (const sec of c.sections) children.push(...renderSection(sec))
    }
  }

  // ── 면책 ──
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: '— 본 초안은 AI가 선행기술 근거에 기반해 생성한 것으로 법적 효력이 없으며, 변리사 검토 후 출원하여야 합니다. 선행기술 검색은 완전성을 보장하지 않습니다.',
          font: FONT,
          size: 16,
          color: '888888',
        }),
      ],
      spacing: { before: 360 },
    }),
  )

  const doc = new Document({
    creator: '특허 AI',
    title: input.title,
    sections: [{ properties: {}, children }],
  })
  return Packer.toBuffer(doc)
}
