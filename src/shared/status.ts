import type { Post, PostStatus, TargetBase, TargetState } from './types'

export const TERMINAL: TargetState[] = ['published', 'failed', 'canceled', 'scheduled_remote']
export const IN_FLIGHT: TargetState[] = ['uploading', 'processing', 'publishing']

export function activeTargets(post: Post): TargetBase[] {
  return [post.instagram, post.youtube].filter((t) => t.enabled)
}

export function postStatus(post: Post): PostStatus {
  const ts = activeTargets(post)
  if (!ts.length) return 'draft'
  const states = ts.map((t) => t.state)
  if (states.every((s) => s === 'draft')) return 'draft'
  if (states.every((s) => s === 'canceled')) return 'canceled'
  if (states.some((s) => IN_FLIGHT.includes(s))) return 'in_progress'
  if (states.some((s) => s === 'missed')) return 'missed'
  const done = (s: TargetState) => s === 'published'
  if (states.every(done)) return 'published'
  if (states.every((s) => s === 'failed' || s === 'canceled')) return 'failed'
  if (states.some((s) => s === 'failed') && states.some(done)) return 'partial'
  if (states.some((s) => s === 'failed')) return 'failed'
  return 'scheduled'
}

const PENDING: TargetState[] = ['draft', 'scheduled', 'missed', 'uploading', 'processing', 'ready', 'publishing', 'scheduled_remote']

/** A post is "upcoming" while any enabled target still has work or a remote publish pending. */
export function isUpcoming(post: Post): boolean {
  return activeTargets(post).some((t) => PENDING.includes(t.state))
}

export function stateLabel(state: TargetState): string {
  switch (state) {
    case 'draft':
      return 'Draft'
    case 'scheduled':
      return 'Scheduled'
    case 'missed':
      return 'Missed'
    case 'uploading':
      return 'Uploading'
    case 'processing':
      return 'Processing'
    case 'ready':
      return 'Ready'
    case 'publishing':
      return 'Publishing'
    case 'scheduled_remote':
      return 'Scheduled on YouTube'
    case 'published':
      return 'Published'
    case 'failed':
      return 'Failed'
    case 'canceled':
      return 'Canceled'
  }
}

/** Whether the user may still change the text/time of this target. */
export function isEditable(state: TargetState): boolean {
  return state === 'draft' || state === 'scheduled' || state === 'missed' || state === 'failed' || state === 'ready' || state === 'canceled'
}
