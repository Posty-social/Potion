// A tiny, dependency-free Markdown renderer.
//
// Safety: it never touches `dangerouslySetInnerHTML`. Every piece of user text
// becomes either a React text node or a known element (strong / em / code / …),
// so there is no path for raw HTML to be injected. Link hrefs are passed
// through `safeUrl`, which only allows http(s)/mailto/tel and same-origin paths.

import type { ReactNode } from 'react'

// Inline spans, in priority order. Bold (`**`/`__`) is listed before italic so
// it wins the match; code is captured raw and never re-parsed.
const INLINE =
  /(\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*\n]+?)\*|_([^_\n]+?)_|~~([^~]+?)~~|`([^`]+?)`|\[([^\]]+?)\]\(([^)\s]+?)\))/

function safeUrl(raw: string): string | null {
  const url = raw.trim()

  // Same-origin / relative links and anchors are always fine.
  if (url.startsWith('/') || url.startsWith('#')) {
    return url
  }

  if (/^(https?:|mailto:|tel:)/i.test(url)) {
    return url
  }

  // Reject javascript:, data:, vbscript:, etc.
  return null
}

/**
 * Render a single line of inline Markdown to React nodes. Recurses into the
 * contents of bold/italic/strike/link spans so nesting works (bold with an
 * italic inside, etc.); code spans are emitted verbatim.
 */
export function renderInline(text: string, keyPrefix = ''): ReactNode[] {
  const nodes: ReactNode[] = []
  let rest = text
  let counter = 0

  while (rest.length > 0) {
    const match = rest.match(INLINE)

    if (!match || match.index === undefined) {
      nodes.push(rest)
      break
    }

    if (match.index > 0) {
      nodes.push(rest.slice(0, match.index))
    }

    const token = match[0]
    const key = `${keyPrefix}i${counter++}`

    if (match[2] !== undefined || match[3] !== undefined) {
      const inner = (match[2] ?? match[3]) as string
      nodes.push(<strong key={key}>{renderInline(inner, `${key}-`)}</strong>)
    } else if (match[4] !== undefined || match[5] !== undefined) {
      const inner = (match[4] ?? match[5]) as string
      nodes.push(<em key={key}>{renderInline(inner, `${key}-`)}</em>)
    } else if (match[6] !== undefined) {
      nodes.push(<del key={key}>{renderInline(match[6], `${key}-`)}</del>)
    } else if (match[7] !== undefined) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-[var(--workspace-muted)] px-1 py-0.5 font-mono text-[0.85em] text-[var(--accent-rust)]"
        >
          {match[7]}
        </code>,
      )
    } else if (match[8] !== undefined && match[9] !== undefined) {
      const href = safeUrl(match[9])
      if (href) {
        nodes.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[var(--accent-plum)] underline underline-offset-2"
          >
            {renderInline(match[8], `${key}-`)}
          </a>,
        )
      } else {
        nodes.push(token)
      }
    }

    rest = rest.slice(match.index + token.length)
  }

  return nodes
}

// --- Block-level rendering (used for the row page body) ------------------

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'code'; lines: string[] }
  | { kind: 'hr' }
  | { kind: 'p'; lines: string[] }

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i++
      continue
    }

    // Fenced code block.
    if (line.trim().startsWith('```')) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        body.push(lines[i])
        i++
      }
      i++ // closing fence
      blocks.push({ kind: 'code', lines: body })
      continue
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2],
      })
      i++
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push({ kind: 'hr' })
      i++
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      blocks.push({ kind: 'quote', lines: quote })
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      blocks.push({ kind: 'ul', items })
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      blocks.push({ kind: 'ol', items })
      continue
    }

    // Paragraph: gather consecutive non-blank lines that don't start a block.
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,3}\s|>\s?|\s*[-*]\s+|\s*\d+\.\s+|```)/.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    blocks.push({ kind: 'p', lines: para })
  }

  return blocks
}

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: 'display-title mt-4 mb-1 text-2xl font-bold first:mt-0',
  2: 'mt-4 mb-1 text-xl font-bold first:mt-0',
  3: 'mt-3 mb-1 text-lg font-bold first:mt-0',
}

/** Render multi-line Markdown text (headings, lists, quotes, code, inline). */
export function Markdown({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const blocks = parseBlocks(text)

  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const key = `b${index}`

        switch (block.kind) {
          case 'heading': {
            const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3'
            return (
              <Tag key={key} className={HEADING_CLASS[block.level]}>
                {renderInline(block.text, `${key}-`)}
              </Tag>
            )
          }
          case 'hr':
            return (
              <hr key={key} className="my-4 border-[var(--workspace-line)]" />
            )
          case 'code':
            return (
              <pre
                key={key}
                className="my-2 overflow-x-auto rounded-lg bg-[var(--workspace-muted)] p-3 font-mono text-xs leading-5"
              >
                <code>{block.lines.join('\n')}</code>
              </pre>
            )
          case 'quote':
            return (
              <blockquote
                key={key}
                className="my-2 border-l-4 border-[var(--accent-plum)] pl-3 text-[var(--workspace-ink-soft)] italic"
              >
                {block.lines.map((line, lineIndex) => (
                  <p key={lineIndex} className="leading-7">
                    {renderInline(line, `${key}-${lineIndex}-`)}
                  </p>
                ))}
              </blockquote>
            )
          case 'ul':
            return (
              <ul
                key={key}
                className="my-1.5 list-disc space-y-0.5 pl-5 leading-7"
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    {renderInline(item, `${key}-${itemIndex}-`)}
                  </li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol
                key={key}
                className="my-1.5 list-decimal space-y-0.5 pl-5 leading-7"
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    {renderInline(item, `${key}-${itemIndex}-`)}
                  </li>
                ))}
              </ol>
            )
          case 'p':
            return (
              <p key={key} className="my-1.5 leading-7">
                {block.lines.map((line, lineIndex) => (
                  <span key={lineIndex}>
                    {lineIndex > 0 ? <br /> : null}
                    {renderInline(line, `${key}-${lineIndex}-`)}
                  </span>
                ))}
              </p>
            )
        }
      })}
    </div>
  )
}
