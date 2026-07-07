import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Markdown, renderInline } from './markdown'

const inline = (text: string) => renderToStaticMarkup(<>{renderInline(text)}</>)

const block = (text: string) => renderToStaticMarkup(<Markdown text={text} />)

describe('renderInline', () => {
  it('renders bold, italic, strikethrough and code', () => {
    expect(inline('**bold**')).toContain('<strong>bold</strong>')
    expect(inline('_italic_')).toContain('<em>italic</em>')
    expect(inline('~~gone~~')).toContain('<del>gone</del>')
    expect(inline('`code`')).toContain('code')
    expect(inline('`code`')).toContain('<code')
  })

  it('nests formatting', () => {
    expect(inline('**bold _and italic_**')).toContain('<em>and italic</em>')
  })

  it('renders safe links and rejects dangerous schemes', () => {
    const link = inline('[docs](https://example.com)')
    expect(link).toContain('href="https://example.com"')
    expect(link).toContain('rel="noreferrer noopener"')

    // javascript: must never become an href — the token is left as text.
    const xss = inline('[click](javascript:alert(1))')
    expect(xss).not.toContain('href="javascript')
    expect(xss).not.toContain('<a ')
  })

  it('escapes raw HTML in user text', () => {
    const out = inline('<img src=x onerror="alert(1)">')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })
})

describe('Markdown', () => {
  it('renders headings, lists and quotes', () => {
    expect(block('# Title')).toContain('<h1')
    expect(block('- one\n- two')).toContain('<ul')
    expect(block('1. first')).toContain('<ol')
    expect(block('> quoted')).toContain('<blockquote')
  })

  it('renders fenced code blocks verbatim without parsing inline markup', () => {
    const out = block('```\n**not bold**\n```')
    expect(out).toContain('<pre')
    expect(out).toContain('**not bold**')
    expect(out).not.toContain('<strong>')
  })

  it('does not emit raw HTML from a code fence', () => {
    const out = block('```\n<script>alert(1)</script>\n```')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })
})
