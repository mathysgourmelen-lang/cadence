// Types shared by the main process, the preload bridge and the UI.

export type Platform = 'instagram' | 'youtube'

export interface MediaInfo {
  /** Container brand, e.g. "isom", "mp42", "qt  ". */
  brand: string
  isQuickTime: boolean
  durationSec: number
  /** Display width/height after applying the rotation matrix. */
  width: number
  height: number
  rotation: 0 | 90 | 180 | 270
  videoCodec: string | null
  audioCodec: string | null
  audioSampleRate: number | null
  audioChannels: number | null
  fps: number | null
  /** Average total bitrate in bits per second. */
  bitrate: number
  /** True when the moov atom comes before mdat ("fast start"). */
  fastStart: boolean
  hasEditList: boolean
  isFragmented: boolean
  sizeBytes: number
}

export type Severity = 'ok' | 'warn' | 'error'

export interface Check {
  id: string
  label: string
  severity: Severity
  detail?: string
}

export interface PlatformValidation {
  platform: Platform
  checks: Check[]
  /** True when no check has severity "error". */
  canPost: boolean
}

export type TargetState =
  | 'draft' // saved but not scheduled
  | 'scheduled' // waiting for its time
  | 'missed' // its time passed while the app was closed and the user wants to confirm
  | 'uploading'
  | 'processing' // platform is processing the upload
  | 'ready' // Instagram: container is processed, waiting for the publish time
  | 'publishing'
  | 'scheduled_remote' // YouTube: uploaded, YouTube publishes it at publishAt
  | 'published'
  | 'failed'
  | 'canceled'

export interface TargetBase {
  enabled: boolean
  state: TargetState
  error?: string
  attempts: number
  nextAttemptAt?: string
  progress?: number // 0..1 while uploading
  url?: string
  publishedAt?: string
  log: LogEntry[]
}

export interface LogEntry {
  at: string
  message: string
  level: 'info' | 'error'
}

export interface InstagramTarget extends TargetBase {
  caption: string
  shareToFeed: boolean
  /** Cover frame offset in milliseconds. */
  coverOffsetMs: number | null
  containerId?: string
  containerCreatedAt?: string
  mediaId?: string
}

export type YouTubePrivacy = 'public' | 'unlisted' | 'private'

export interface YouTubeTarget extends TargetBase {
  title: string
  description: string
  tags: string[]
  privacy: YouTubePrivacy
  madeForKids: boolean
  categoryId: string
  /** native: upload early and let YouTube publish at the time. atTime: upload at the time. */
  mode: 'native' | 'atTime'
  uploadUrl?: string
  videoId?: string
}

export interface VideoRef {
  fileName: string
  originalPath: string
  /** Copy inside the app library, so moving the original does not break the post. */
  libraryPath: string
  thumbnailPath?: string
  sizeBytes: number
  media: MediaInfo
}

export interface Post {
  id: string
  createdAt: string
  updatedAt: string
  /** ISO time. null = publish as soon as possible. */
  scheduledAt: string | null
  video: VideoRef
  instagram: InstagramTarget
  youtube: YouTubeTarget
}

export type PostStatus =
  | 'draft'
  | 'scheduled'
  | 'in_progress'
  | 'published'
  | 'partial'
  | 'failed'
  | 'missed'
  | 'canceled'

export interface Settings {
  appearance: 'system' | 'dark' | 'light'
  launchAtLogin: boolean
  keepAwake: boolean
  /** Minutes before the publish time to upload Instagram videos so they post on time. */
  instagramLeadMinutes: number
  missedPolicy: 'post' | 'ask'
  defaultTimes: string[] // "HH:MM"
  youtubeDefaultPrivacy: YouTubePrivacy
  youtubeDefaultCategory: string
  youtubeDefaultMode: 'native' | 'atTime'
  youtubeMadeForKids: boolean
  instagramShareToFeed: boolean
  graphApiVersion: string
  snippets: Snippet[]
  paused: boolean
  notifications: boolean
  /** Folder on the Mac that the Library tab shows (e.g. where you export your edits). */
  libraryFolder: string | null
}

export interface Snippet {
  id: string
  name: string
  text: string
}

export interface InstagramAccount {
  connected: boolean
  username?: string
  igUserId?: string
  pageName?: string
  profilePictureUrl?: string
  appId?: string
  hasSecret?: boolean
  connectedAt?: string
  /** Set when the saved sign-in stopped working. */
  problem?: string
}

export interface YouTubeAccount {
  connected: boolean
  channelTitle?: string
  channelId?: string
  thumbnailUrl?: string
  clientId?: string
  hasSecret?: boolean
  connectedAt?: string
  problem?: string
  /** Uploads started today (Pacific time), as counted by this app. */
  quotaUsedToday: number
}

export interface AccountsState {
  instagram: InstagramAccount
  youtube: YouTubeAccount
}

export interface InstagramPageChoice {
  pageId: string
  pageName: string
  igUserId: string
  username: string
  profilePictureUrl?: string
}

export interface ImportedVideo {
  ok: boolean
  error?: string
  video?: VideoRef
}

export interface PostDraftInput {
  id?: string
  scheduledAt: string | null
  video: VideoRef
  instagram: Pick<InstagramTarget, 'enabled' | 'caption' | 'shareToFeed' | 'coverOffsetMs'>
  youtube: Pick<YouTubeTarget, 'enabled' | 'title' | 'description' | 'tags' | 'privacy' | 'madeForKids' | 'categoryId' | 'mode'>
  /** false = save as draft. */
  schedule: boolean
}

export interface AppSnapshot {
  posts: Post[]
  settings: Settings
  accounts: AccountsState
  insights: InsightsState
  version: string
}

// ---------- Library folder ----------

export interface FolderVideo {
  path: string
  /** Path relative to the library folder, e.g. "Edits/clip.mp4". */
  relPath: string
  name: string
  sizeBytes: number
  mtimeMs: number
  media?: MediaInfo
  /** Set when the file could not be read as a video. */
  error?: string
  /** cadence-media:// URL of a cached thumbnail, when one exists. */
  thumbUrl?: string
}

export interface FolderListing {
  folder: string | null
  exists: boolean
  videos: FolderVideo[]
  /** True when the folder had more videos than Cadence lists. */
  truncated: boolean
  scannedAt: string
}

// ---------- Views / insights ----------

export interface MediaStat {
  id: string
  title: string
  url?: string
  thumbnailUrl?: string
  publishedAt?: string
  views: number | null
  likes?: number
  comments?: number
  /** Posted through Cadence. */
  viaCadence?: boolean
}

export interface AccountInsights {
  fetchedAt: string
  /** Total views across the account. null when the platform did not return views. */
  totalViews: number | null
  followers?: number
  postCount?: number
  /** How many posts the total was summed from (Instagram). */
  countedPosts?: number
  top: MediaStat[]
  recent: MediaStat[]
  /** Explains a limitation, e.g. a missing permission. */
  note?: string
}

export interface InsightsPoint {
  /** Local day, YYYY-MM-DD. */
  day: string
  instagram?: number
  youtube?: number
}

export interface InsightsState {
  instagram?: AccountInsights
  youtube?: AccountInsights
  /** One point per day, used for the trend lines. */
  history: InsightsPoint[]
  instagramError?: string
  youtubeError?: string
  refreshing: boolean
}

export interface ProgressEvent {
  postId: string
  platform: Platform
  progress: number
}
