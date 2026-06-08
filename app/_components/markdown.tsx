import type { ReactNode } from 'react'

// Minimal, dependency-free, XSS-safe markdown renderer for our own LLM output.
// Handles headings, bullet/ordered lists, **bold**, and paragraphs. No raw HTML.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? (
      <strong key={i}>{p.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}

const SPECIAL = /^(#{1,4})\s|^\s*[-*]\s|^\s*\d+\.\s/

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      const cls = h[1].length <= 2 ? 'mt-3 text-sm font-semibold' : 'mt-2 text-sm font-medium'
      blocks.push(
        <p key={key++} className={cls}>
          {inline(h[2])}
        </p>,
      )
      i++
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      blocks.push(
        <ul key={key++} className="my-1.5 list-disc space-y-1 pl-5">
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ul>,
      )
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      blocks.push(
        <ol key={key++} className="my-1.5 list-decimal space-y-1 pl-5">
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ol>,
      )
      continue
    }

    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !SPECIAL.test(lines[i])) {
      para.push(lines[i])
      i++
    }
    blocks.push(
      <p key={key++} className="my-1.5 leading-relaxed">
        {inline(para.join(' '))}
      </p>,
    )
  }

  return <div className="text-sm">{blocks}</div>
}
