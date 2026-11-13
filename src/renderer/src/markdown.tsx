// A tiny Markdown renderer for the bundled setup guide (no dependencies, no HTML injection).
// Supports headings, paragraphs, nested lists, blockquotes, code blocks, tables, rules,
// **bold**, *italic*, `code` and [links](https://…). `<!-- anchor:name -->` sets the id
// of the next heading.

import type { ReactNode } from 'react'

type Block =
  | { t: 'h'; level: number; text: string; id?: string }
  | { t: 'p'; text: string }
  | { t: 'list'; ordered: boolean; items: ListItem[] }
  | { t: 'quote'; text: string }
  | { t: 'code'; text: string }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'hr' }

interface ListItem {
  text: string
  children?: Block
}

export function inline(text: string, onLink?: (href: string) => void): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*\s][^*]*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) out.push(<strong key={k++}>{inline(tok.slice(2, -2), onLink)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={k++}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!
      const href = mm[2]
      out.push(
        <a
          key={k++}
          href={href}
          onClick={(e) => {
            e.preventDefault()
            onLink?.(href)
          }}
        >
          {inline(mm[1], onLink)}
        </a>
      )
    } else out.push(<em key={k++}>{inline(tok.slice(1, -1), onLink)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function parseList(lines: string[], start: number, indent: number): { block: Block; next: number } {
  const ordered = /^\s*\d+\.\s/.test(lines[start])
  const items: ListItem[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      // A blank line continues the list only if another item follows at this indent.
      const nxt = lines.slice(i + 1).find((l) => l.trim())
      if (nxt && new RegExp(`^ {${indent}}(\\d+\\.|[-*])\\s`).test(nxt)) {
        i++
        continue
      }
      break
    }
    const lead = line.length - line.trimStart().length
    const m = /^(\s*)(\d+\.|[-*])\s+(.*)$/.exec(line)
    if (m && lead === indent) {
      items.push({ text: m[3] })
      i++
    } else if (m && lead > indent) {
      const sub = parseList(lines, i, lead)
      if (items.length) items[items.length - 1].children = sub.block
      i = sub.next
    } else if (!m && lead > indent && items.length) {
      items[items.length - 1].text += ' ' + line.trim()
      i++
    } else break
  }
  return { block: { t: 'list', ordered, items }, next: i }
}

export function parse(md: string): Block[] {
  const lines = md.replace(/\r/g, '').split('\n')
  const blocks: Block[] = []
  let anchor: string | undefined
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const a = /^<!--\s*anchor:([\w-]+)\s*-->$/.exec(line.trim())
    if (a) {
      anchor = a[1]
      i++
      continue
    }
    if (/^<!--.*-->$/.test(line.trim())) {
      i++
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      blocks.push({ t: 'h', level: h[1].length, text: h[2], id: anchor })
      anchor = undefined
      i++
      continue
    }
    if (/^---+$/.test(line.trim())) {
      blocks.push({ t: 'hr' })
      i++
      continue
    }
    if (line.startsWith('```')) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++])
      i++
      blocks.push({ t: 'code', text: buf.join('\n') })
      continue
    }
    if (line.startsWith('>')) {
      const buf: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) buf.push(lines[i++].replace(/^>\s?/, ''))
      blocks.push({ t: 'quote', text: buf.join(' ') })
      continue
    }
    if (line.trim().startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i]
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim())
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells)
        i++
      }
      blocks.push({ t: 'table', head: rows[0] ?? [], rows: rows.slice(1) })
      continue
    }
    if (/^\s*(\d+\.|[-*])\s/.test(line)) {
      const lead = line.length - line.trimStart().length
      const { block, next } = parseList(lines, i, lead)
      blocks.push(block)
      i = next
      continue
    }
    const buf: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*(\d+\.|[-*])\s|\||<!--)/.test(lines[i])) buf.push(lines[i++].trim())
    blocks.push({ t: 'p', text: buf.join(' ') })
  }
  return blocks
}

function renderBlock(b: Block, key: number, onLink?: (href: string) => void): ReactNode {
  switch (b.t) {
    case 'h': {
      const Tag = (`h${b.level}` as unknown) as 'h1'
      return (
        <Tag key={key} id={b.id ? `guide-${b.id}` : undefined}>
          {inline(b.text, onLink)}
        </Tag>
      )
    }
    case 'p':
      return <p key={key}>{inline(b.text, onLink)}</p>
    case 'quote':
      return (
        <blockquote key={key}>
          <p>{inline(b.text, onLink)}</p>
        </blockquote>
      )
    case 'code':
      return (
        <pre key={key}>
          <code>{b.text}</code>
        </pre>
      )
    case 'hr':
      return <hr key={key} style={{ border: 0, borderTop: '1px solid var(--border)', margin: '28px 0' }} />
    case 'table':
      return (
        <table key={key}>
          <thead>
            <tr>
              {b.head.map((c, i) => (
                <th key={i}>{inline(c, onLink)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{inline(c, onLink)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul'
      return (
        <Tag key={key}>
          {b.items.map((it, i) => (
            <li key={i}>
              {inline(it.text, onLink)}
              {it.children && renderBlock(it.children, 0, onLink)}
            </li>
          ))}
        </Tag>
      )
    }
  }
}

export function Markdown({ source, onLink }: { source: string; onLink?: (href: string) => void }) {
  return <>{parse(source).map((b, i) => renderBlock(b, i, onLink))}</>
}
