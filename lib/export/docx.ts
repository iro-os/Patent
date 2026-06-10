import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx'
import { KIPO_SECTIONS, formatKipoCitation } from '@/lib/kipo/sections'
import type { PriorArtSource } from '@/lib/types'

// DOCX assembly for the 변리사 handoff (P0-B). Walks KIPO_SECTIONS in official order
// (별지 제15호) and fills each 【section】 with the generated body prose when present,
// otherwise a dossier-derived fallback (claim strategy / effects / prior-art citations),
// otherwise a "미작성" placeholder. v1 deliberately exports whatever exists so the
// handoff artifact has value even before every section is generated.

export interface ExportRef {
  source: PriorArtSource
  title?: string | null
  pub_date?: string | null
  url?: string | null
  ext_id?: string | null
}

export interface ExportInput {
  title: string
  sections: Record<string, string> // schema_key -> generated_text (only filled ones)
  refs?: ExportRef[]
  claimStrategy?: { independent_scope: string | null; dependent_ladder: string[] } | null
  differentiation?: { point: string }[]
  grace?: { grace_deadline?: string; days_remaining?: number; expired?: boolean } | null
}

// 바탕(Batang)은 한국 특허 명세서 관행 글꼴. Word/한글에 있으면 적용되고, 없으면 뷰어가 폴백한다.
const FONT = 'Batang'

function body(text: string): Paragraph[] {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line, font: FONT, size: 22 })],
          spacing: { after: 120 },
          indent: { firstLine: 200 },
        }),
    )
}

function heading(label: string, optional?: boolean): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `【${label}】${optional ? ' (선택)' : ''}`, bold: true, font: FONT, size: 24 }),
    ],
    spacing: { before: 240, after: 120 },
  })
}

export async function buildSpecDocx(input: ExportInput): Promise<Buffer> {
  const children: Paragraph[] = []

  children.push(
    new Paragraph({
      children: [new TextRun({ text: '명 세 서', bold: true, font: FONT, size: 32 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: input.title || '제목 없는 발명', font: FONT, size: 24 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'AI 생성 초안 — 변리사 검토 필요', font: FONT, size: 18, color: '888888' }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    }),
  )

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

  for (const sec of KIPO_SECTIONS) {
    const key = sec.key
    const gen = input.sections[key]?.trim()

    // Dossier fallbacks for keys not yet generated as prose (P0-A fills these later).
    let fallback: Paragraph[] | null = null
    if (!gen) {
      if (key === '특허청구범위' && input.claimStrategy?.independent_scope) {
        const cs = input.claimStrategy
        const ps = body(`(청구 전략 — 실제 청구항 텍스트는 후속 단계) 독립항 범위: ${cs.independent_scope}`)
        ;(cs.dependent_ladder ?? []).forEach((c, i) => ps.push(...body(`종속 ${i + 1}. ${c}`)))
        fallback = ps
      } else if (key === '발명의 효과' && (input.differentiation?.length ?? 0) > 0) {
        fallback = input.differentiation!.map(
          (d) =>
            new Paragraph({
              bullet: { level: 0 },
              children: [new TextRun({ text: d.point, font: FONT, size: 22 })],
            }),
        )
      } else if (key === '선행기술문헌' && (input.refs?.length ?? 0) > 0) {
        fallback = input.refs!.map((r, i) => {
          const c = formatKipoCitation(r, i + 1)
          return new Paragraph({
            children: [new TextRun({ text: c.text, font: FONT, size: 20 })],
            spacing: { after: 80 },
          })
        })
      }
    }

    // Keep required sections always (structural completeness); drop empty optional ones.
    if (!gen && !fallback && sec.optional) continue

    children.push(heading(key, sec.optional))
    if (gen) children.push(...body(gen))
    else if (fallback) children.push(...fallback)
    else
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: '(미작성 — 본문 생성 필요)', italics: true, font: FONT, size: 20, color: '999999' }),
          ],
          spacing: { after: 120 },
        }),
      )
  }

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
