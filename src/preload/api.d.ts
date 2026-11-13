import type {
  AccountsState,
  AppSnapshot,
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
  instagramConnect(args: { appId: string; appSecret: string; token: string }): Promise<InstagramPageChoice[]>
  instagramChoose(igUserId: string): Promise<InstagramAccount>
  instagramDisconnect(): Promise<void>
  instagramLimit(): Promise<{ used: number; total: number } | null>
  youtubeConnect(args: { clientId: string; clientSecret: string }): Promise<YouTubeAccount>
  youtubeDisconnect(): Promise<void>
  importPaths(paths: string[]): Promise<ImportedVideo[]>
  listFolder(): Promise<FolderListing>
  chooseFolder(): Promise<FolderListing>
  saveFolderThumb(path: string, dataUrl: string): Promise<string | undefined>
  onFolderChanged(cb: () => void): () => void
  /** URL the <video> element can play for a file inside the library folder. */
  folderUrl(relPath: string): string
  refreshInsights(): Promise<InsightsState>
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
