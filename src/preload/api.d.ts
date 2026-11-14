import type {
  AccountsState,
  AppSnapshot,
  AnalyticsState,
  ChosenThumbnail,
  RetentionPoint,
  ReplaySource,
  FolderListing,
  InsightsState,
  ImportedVideo,
  InstagramAccount,
  InstagramPageChoice,
  Platform,
  Post,
  PostDraftInput,
  ProgressEvent,
  Settings,
  YouTubeAccount
} from '../shared/types'

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
export type PostAction = 'postNow' | 'cancel' | 'retry' | 'unschedule'

export interface CadenceApi {
  getState(): Promise<AppSnapshot>
  onState(cb: (s: AppSnapshot) => void): () => void
  onProgress(cb: (e: ProgressEvent) => void): () => void
  onNavigate(cb: (route: string) => void): () => void
  pickVideos(): Promise<ImportedVideo[]>
  importFiles(files: File[]): Promise<ImportedVideo[]>
  saveThumbnail(videoPath: string, dataUrl: string): Promise<string | undefined>
  savePost(input: PostDraftInput): Promise<Post>
  savePosts(inputs: PostDraftInput[]): Promise<Post[]>
  deletePost(id: string): Promise<void>
  postAction(id: string, action: PostAction, platform?: Platform): Promise<Post>
  reschedule(id: string, iso: string): Promise<Post>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  /** App ID and secret can be omitted once an account is connected. */
  instagramConnect(args: { appId?: string; appSecret?: string; token: string }): Promise<(InstagramPageChoice & { connected: boolean })[]>
  instagramChoose(igUserIds: string[]): Promise<InstagramAccount[]>
  instagramDisconnect(id: string): Promise<void>
  instagramLimit(id?: string): Promise<{ used: number; total: number } | null>
  /** Signs in one channel. Client ID and secret can be omitted once saved. */
  youtubeConnect(args: { clientId?: string; clientSecret?: string }): Promise<YouTubeAccount>
  youtubeDisconnect(id: string): Promise<void>
  importPaths(paths: string[]): Promise<ImportedVideo[]>
  /** Opens a file picker; null when canceled. */
  pickYouTubeThumbnail(): Promise<ChosenThumbnail | null>
  youtubeThumbnailFromFile(file: File): Promise<ChosenThumbnail>
  listFolder(): Promise<FolderListing>
  chooseFolder(): Promise<FolderListing>
  saveFolderThumb(path: string, dataUrl: string): Promise<string | undefined>
  onFolderChanged(cb: () => void): () => void
  /** URL the <video> element can play for a file inside the library folder. */
  folderUrl(relPath: string): string
  refreshInsights(): Promise<InsightsState>
  refreshAnalytics(): Promise<AnalyticsState>
  retention(videoId: string, channelId?: string): Promise<RetentionPoint[]>
  /** Finds the local file of a YouTube video for retention replay. */
  replayFind(videoId: string, durationSec?: number, title?: string): Promise<ReplaySource>
  replayPick(videoId: string, durationSec?: number): Promise<ReplaySource>
  replayForget(videoId: string): Promise<void>
  replayUrl(videoId: string): string
  openExternal(url: string): Promise<void>
  reveal(path: string): Promise<void>
  openDataFolder(): Promise<void>
  mediaUrl(path: string): string
  platform: string
}

export type { AccountsState }

declare global {
  interface Window {
    cadence: CadenceApi
  }
}
