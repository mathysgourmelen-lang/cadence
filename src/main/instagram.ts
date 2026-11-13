// Instagram Reels publishing through the Instagram Graph API (Facebook Login variant).
// This variant supports Meta's resumable upload host, so videos go straight from the
// Mac to Meta without any public storage.
//
// Flow: create a REELS container with upload_type=resumable -> upload bytes to
// rupload.facebook.com -> poll status_code until FINISHED -> media_publish.

import { ApiError, fetchWithTimeout, fileBody, readJson } from './http'
import type { InstagramPageChoice } from '../shared/types'

export interface InstagramCredentials {
  igUserId: string
  /** Page access token (does not expire when derived from a long-lived user token). */
  accessToken: string
}

export interface InstagramEndpoints {
  graph: string // e.g. https://graph.facebook.com
  rupload: string // e.g. https://rupload.facebook.com
}

export const DEFAULT_IG_ENDPOINTS: InstagramEndpoints = {
  graph: 'https://graph.facebook.com',
  rupload: 'https://rupload.facebook.com'
}

export type ContainerStatus = 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED' | string

/** Graph error codes that mean "try again later". */
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 368, 613, 80001, 80002])

export function graphError(status: number, body: any, context: string): ApiError {
  const e = body?.error ?? {}
  const code: number | undefined = e.code
  const sub: number | undefined = e.error_subcode
  const userMsg: string | undefined = e.error_user_msg || e.error_user_title
  const message: string = e.message || body?._text || `HTTP ${status}`

  if (code === 190 || code === 102 || sub === 463 || sub === 460 || sub === 467) {
    return new ApiError(`Instagram sign-in expired or was revoked. Reconnect Instagram in Accounts. (${message})`, {
      status,
      retriable: false,
      authError: true,
      code,
      raw: body
    })
  }
  if (code === 10 || code === 200 || (code !== undefined && code >= 200 && code < 300)) {
    return new ApiError(`Instagram permission missing: ${userMsg || message}. Reconnect and grant all requested permissions.`, {
      status,
      retriable: false,
      authError: true,
      code,
      raw: body
    })
  }
  // Content publishing limit reached (100 posts / 24h).
  if (code === 9 || sub === 2207042) {
    return new ApiError('Instagram\'s daily publishing limit was reached. Cadence will try again in an hour.', {
      status,
      retriable: true,
      retryAfter: new Date(Date.now() + 60 * 60 * 1000),
      code,
      raw: body
    })
  }
  // Media not ready yet.
  if (sub === 2207027) {
    return new ApiError('Instagram is still processing the video.', { status, retriable: true, code, raw: body })
  }
  const retriable = status >= 500 || status === 429 || e.is_transient === true || (code !== undefined && TRANSIENT_CODES.has(code))
  return new ApiError(`${context}: ${userMsg || message}`, { status, retriable, code: sub ?? code, raw: body })
}

export class InstagramClient {
  constructor(
    private readonly version: string,
    private readonly endpoints: InstagramEndpoints = DEFAULT_IG_ENDPOINTS
  ) {}

  private url(path: string, params: Record<string, string | number | boolean | undefined> = {}): string {
    const u = new URL(`${this.endpoints.graph}/${this.version}/${path.replace(/^\//, '')}`)
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v))
    return u.toString()
  }

  private async get(path: string, params: Record<string, string | number | boolean | undefined>, context: string): Promise<any> {
    const res = await fetchWithTimeout(this.url(path, params), { method: 'GET' })
    const body = await readJson(res)
    if (!res.ok || body?.error) throw graphError(res.status, body, context)
    return body
  }

  private async post(path: string, params: Record<string, string | number | boolean | undefined>, context: string): Promise<any> {
    const form = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') form.set(k, String(v))
    const res = await fetchWithTimeout(this.url(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    })
    const body = await readJson(res)
    if (!res.ok || body?.error) throw graphError(res.status, body, context)
    return body
  }

  // ---------- Connecting ----------

  /** Exchanges a short-lived user token (from Graph API Explorer) for a long-lived one. */
  async exchangeToken(appId: string, appSecret: string, shortToken: string): Promise<string> {
    const body = await this.get(
      'oauth/access_token',
      { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken },
      'Could not verify the token'
    )
    if (!body.access_token) throw new ApiError('Meta did not return a long-lived token.', { retriable: false, raw: body })
    return body.access_token as string
  }

  /** Lists Facebook Pages the user manages that have an Instagram professional account linked. */
  async listInstagramAccounts(userToken: string): Promise<(InstagramPageChoice & { pageToken: string })[]> {
    const out: (InstagramPageChoice & { pageToken: string })[] = []
    let next: string | undefined = this.url('me/accounts', {
      fields: 'id,name,access_token,instagram_business_account{id,username,profile_picture_url}',
      limit: 100,
      access_token: userToken
    })
    let pages = 0
    while (next && pages++ < 10) {
      const res = await fetchWithTimeout(next, { method: 'GET' })
      const body = await readJson(res)
      if (!res.ok || body?.error) throw graphError(res.status, body, 'Could not list your Facebook Pages')
      for (const p of body.data ?? []) {
        const ig = p.instagram_business_account
        if (ig?.id && p.access_token) {
          out.push({
            pageId: p.id,
            pageName: p.name,
            igUserId: ig.id,
            username: ig.username ?? '',
            profilePictureUrl: ig.profile_picture_url,
            pageToken: p.access_token
          })
        }
      }
      next = body.paging?.next
    }
    return out
  }

  async getProfile(creds: InstagramCredentials): Promise<{ username: string; profilePictureUrl?: string }> {
    const body = await this.get(creds.igUserId, { fields: 'username,profile_picture_url', access_token: creds.accessToken }, 'Could not read the Instagram account')
    return { username: body.username, profilePictureUrl: body.profile_picture_url }
  }

  async publishingLimit(creds: InstagramCredentials): Promise<{ used: number; total: number }> {
    const body = await this.get(
      `${creds.igUserId}/content_publishing_limit`,
      { fields: 'config,quota_usage', access_token: creds.accessToken },
      'Could not read the publishing limit'
    )
    const d = body.data?.[0] ?? {}
    return { used: d.quota_usage ?? 0, total: d.config?.quota_total ?? 100 }
  }

  // ---------- Publishing ----------

  async createReelContainer(
    creds: InstagramCredentials,
    opts: { caption: string; shareToFeed: boolean; coverOffsetMs: number | null }
  ): Promise<{ id: string; uploadUri: string }> {
    const body = await this.post(
      `${creds.igUserId}/media`,
      {
        media_type: 'REELS',
        upload_type: 'resumable',
        caption: opts.caption,
        share_to_feed: opts.shareToFeed,
        thumb_offset: opts.coverOffsetMs != null ? Math.max(0, Math.round(opts.coverOffsetMs)) : undefined,
        access_token: creds.accessToken
      },
      'Instagram rejected the post'
    )
    if (!body.id) throw new ApiError('Instagram did not return a container id.', { retriable: true, raw: body })
    const uploadUri: string = body.uri || `${this.endpoints.rupload}/ig-api-upload/${this.version}/${body.id}`
    return { id: String(body.id), uploadUri }
  }

  async uploadVideo(
    creds: InstagramCredentials,
    uploadUri: string,
    filePath: string,
    size: number,
    onProgress?: (fraction: number) => void
  ): Promise<void> {
    const res = await fetchWithTimeout(uploadUri, {
      method: 'POST',
      timeoutMs: 60 * 60 * 1000,
      headers: {
        Authorization: `OAuth ${creds.accessToken}`,
        offset: '0',
        file_size: String(size),
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(size)
      },
      body: fileBody(filePath, 0, size, (sent) => onProgress?.(sent / size)) as any,
      duplex: 'half'
    } as RequestInit & { duplex: 'half' })
    const body = await readJson(res)
    if (!res.ok || body?.success === false || body?.error || body?.debug_info) {
      const info = body?.debug_info
      if (info) {
        throw new ApiError(`Instagram upload failed: ${info.message || info.type || 'unknown error'}`, {
          status: res.status,
          retriable: info.retriable !== false,
          raw: body
        })
      }
      throw graphError(res.status, body, 'Instagram upload failed')
    }
  }

  async containerStatus(creds: InstagramCredentials, containerId: string): Promise<{ statusCode: ContainerStatus; status?: string }> {
    const body = await this.get(containerId, { fields: 'status_code,status', access_token: creds.accessToken }, 'Could not check the upload status')
    return { statusCode: body.status_code, status: body.status }
  }

  async publish(creds: InstagramCredentials, containerId: string): Promise<string> {
    const body = await this.post(
      `${creds.igUserId}/media_publish`,
      { creation_id: containerId, access_token: creds.accessToken },
      'Instagram could not publish the reel'
    )
    if (!body.id) throw new ApiError('Instagram did not return the published media id.', { retriable: false, raw: body })
    return String(body.id)
  }

  async permalink(creds: InstagramCredentials, mediaId: string): Promise<string | undefined> {
    try {
      const body = await this.get(mediaId, { fields: 'permalink', access_token: creds.accessToken }, 'Could not read the permalink')
      return body.permalink
    } catch {
      return undefined
    }
  }

  /** Used after a crash during publishing: finds a recent reel to avoid posting twice. */
  async recentMedia(creds: InstagramCredentials, limit = 5): Promise<{ id: string; permalink?: string; timestamp?: string; caption?: string }[]> {
    const body = await this.get(
      `${creds.igUserId}/media`,
      { fields: 'id,permalink,timestamp,caption', limit, access_token: creds.accessToken },
      'Could not list recent media'
    )
    return body.data ?? []
  }

  // ---------- Stats ----------

  async accountStats(creds: InstagramCredentials): Promise<{ followers?: number; mediaCount?: number }> {
    const body = await this.get(
      creds.igUserId,
      { fields: 'followers_count,media_count', access_token: creds.accessToken },
      'Could not read the Instagram account'
    )
    return { followers: body.followers_count, mediaCount: body.media_count }
  }

  /**
   * One page of the account's posts. With `insights`, each post carries its view count
   * (needs the instagram_manage_insights permission).
   */
  async mediaPage(creds: InstagramCredentials, opts: { after?: string; insights: boolean; limit?: number }): Promise<{ items: IgMediaItem[]; after?: string }> {
    const fields = ['id', 'caption', 'media_type', 'media_product_type', 'timestamp', 'permalink', 'thumbnail_url', 'media_url', 'like_count', 'comments_count']
    if (opts.insights) fields.push('insights.metric(views)')
    const body = await this.get(
      `${creds.igUserId}/media`,
      { fields: fields.join(','), limit: opts.limit ?? 50, after: opts.after, access_token: creds.accessToken },
      'Could not list your Instagram posts'
    )
    const items: IgMediaItem[] = (body.data ?? []).map((m: any) => ({
      id: m.id,
      caption: m.caption,
      mediaType: m.media_type,
      productType: m.media_product_type,
      timestamp: m.timestamp,
      permalink: m.permalink,
      thumbnailUrl: m.thumbnail_url ?? (m.media_type === 'VIDEO' ? undefined : m.media_url),
      likes: m.like_count,
      comments: m.comments_count,
      views: opts.insights ? insightValue(m.insights) : undefined
    }))
    return { items, after: body.paging?.next ? body.paging?.cursors?.after : undefined }
  }

  /** Several insight metrics of one post, as { metric: value }. */
  async mediaInsights(creds: InstagramCredentials, mediaId: string, metrics: string[]): Promise<Record<string, number | null>> {
    const body = await this.get(`${mediaId}/insights`, { metric: metrics.join(','), access_token: creds.accessToken }, 'Could not read post insights')
    const out: Record<string, number | null> = {}
    for (const d of body.data ?? []) out[d.name] = insightValue({ data: [d] })
    return out
  }

  /** Views of a single post. */
  async mediaViews(creds: InstagramCredentials, mediaId: string): Promise<number | null> {
    const body = await this.get(`${mediaId}/insights`, { metric: 'views', access_token: creds.accessToken }, 'Could not read post views')
    return insightValue(body)
  }
}

export interface IgMediaItem {
  id: string
  caption?: string
  mediaType?: string
  productType?: string
  timestamp?: string
  permalink?: string
  thumbnailUrl?: string
  likes?: number
  comments?: number
  /** undefined = not requested, null = not available for this post. */
  views?: number | null
}

/** Reads a metric value from an insights response ({ data: [{ values: [{ value }] }] or total_value). */
export function insightValue(insights: any): number | null {
  const d = insights?.data?.[0]
  if (!d) return null
  const v = d.total_value?.value ?? d.values?.[0]?.value
  return typeof v === 'number' ? v : null
}
