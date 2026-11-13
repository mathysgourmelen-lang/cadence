import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../src/renderer/src/markdown'

describe('setup guide', () => {
  const md = readFileSync(join(__dirname, '../docs/SETUP.md'), 'utf8')
  const blocks = parse(md)
  it('parses and has the anchors the app links to', () => {
    const ids = blocks.filter((b) => b.t === 'h').map((b) => (b as { id?: string }).id)
    for (const a of ['install', 'instagram', 'youtube', 'audit', 'using', 'awake']) expect(ids).toContain(a)
  })
  it('keeps numbered steps together with their sub-bullets', () => {
    const lists = blocks.filter((b) => b.t === 'list') as { items: { text: string; children?: unknown }[] }[]
    const tokenSteps = lists.find((l) => l.items.some((i) => i.text.includes('Graph API Explorer')))!
    expect(tokenSteps.items.length).toBe(6)
    expect(tokenSteps.items[3].children).toBeTruthy()
  })
})
