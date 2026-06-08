/* eslint-disable @typescript-eslint/no-unused-vars -- `node` is intentionally
   destructured out of each react-markdown component so it is not spread onto the DOM. */
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Clean, Claude-Code-style markdown rendering for our own LLM output.
// react-markdown does NOT render raw HTML (no rehype-raw plugin), so this is XSS-safe.
// remark-gfm adds tables, strikethrough, task lists, and autolinks.
const COMPONENTS: Components = {
  h1: ({ node, ...p }) => <h1 className="mb-2 mt-5 text-[15px] font-bold first:mt-0" {...p} />,
  h2: ({ node, ...p }) => <h2 className="mb-2 mt-4 text-sm font-bold first:mt-0" {...p} />,
  h3: ({ node, ...p }) => <h3 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0" {...p} />,
  h4: ({ node, ...p }) => <h4 className="mb-1 mt-3 text-[13px] font-semibold first:mt-0" {...p} />,
  p: ({ node, ...p }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0" {...p} />,
  ul: ({ node, ...p }) => <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0" {...p} />,
  ol: ({ node, ...p }) => <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0" {...p} />,
  li: ({ node, ...p }) => <li className="leading-relaxed marker:text-neutral-400" {...p} />,
  a: ({ node, ...p }) => (
    <a
      className="font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400"
      target="_blank"
      rel="noopener noreferrer"
      {...p}
    />
  ),
  strong: ({ node, ...p }) => <strong className="font-semibold text-neutral-900 dark:text-white" {...p} />,
  em: ({ node, ...p }) => <em className="italic" {...p} />,
  hr: ({ node, ...p }) => <hr className="my-4 border-neutral-200 dark:border-neutral-800" {...p} />,
  blockquote: ({ node, ...p }) => (
    <blockquote
      className="my-2 border-l-2 border-neutral-300 pl-3 text-neutral-600 dark:border-neutral-600 dark:text-neutral-400"
      {...p}
    />
  ),
  code: ({ node, className, children, ...p }) => {
    const isBlock = /language-/.test(className ?? '')
    if (isBlock) {
      return (
        <code className={`font-mono text-[12px] ${className ?? ''}`} {...p}>
          {children}
        </code>
      )
    }
    return (
      <code
        className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px] text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
        {...p}
      >
        {children}
      </code>
    )
  },
  pre: ({ node, ...p }) => (
    <pre
      className="my-2 overflow-x-auto rounded-lg bg-neutral-100 p-3 text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
      {...p}
    />
  ),
  // Tables: a horizontal-scroll wrapper so wide tables never break the layout.
  table: ({ node, ...p }) => (
    <div className="my-3 overflow-x-auto first:mt-0 last:mb-0">
      <table className="w-full border-collapse text-[13px]" {...p} />
    </div>
  ),
  th: ({ node, ...p }) => (
    <th
      className="border border-neutral-300 bg-neutral-100 px-2.5 py-1.5 text-left font-semibold dark:border-neutral-700 dark:bg-neutral-800"
      {...p}
    />
  ),
  td: ({ node, ...p }) => (
    <td className="border border-neutral-200 px-2.5 py-1.5 align-top dark:border-neutral-800" {...p} />
  ),
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="text-sm text-neutral-800 dark:text-neutral-200">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
