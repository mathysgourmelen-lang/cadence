import { useEffect, useRef } from 'react'
import { Topbar } from '../App'
import { api, useApp } from '../state'
import { Markdown } from '../markdown'
import guide from '../../../../docs/SETUP.md?raw'

export default function Guide() {
  const { guideAnchor, go } = useApp()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!guideAnchor) return
    const el = document.getElementById(`guide-${guideAnchor}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [guideAnchor])

  const onLink = (href: string) => {
    if (href.startsWith('#')) {
      document.getElementById(`guide-${href.slice(1)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else if (href === 'cadence://accounts') go('accounts')
    else if (href === 'cadence://settings') go('settings')
    else if (/^https:\/\//.test(href)) void api.openExternal(href)
  }

  return (
    <>
      <Topbar title="Setup Guide" subtitle="Everything you need, step by step" />
      <div className="page" ref={ref}>
        <article className="guide">
          <Markdown source={guide} onLink={onLink} />
        </article>
      </div>
    </>
  )
}
