import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { CadenceApi, Result } from './api'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Result<T>
  if (!res.ok) throw new Error(res.error)
  return res.value
}

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const listener = (_e: unknown, v: T) => cb(v)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: CadenceApi = {
  getState: () => call('state:get'),
  onState: (cb) => subscribe('state', cb),
  onProgress: (cb) => subscribe('progress', cb),
  onNavigate: (cb) => subscribe('navigate', cb),
  pickVideos: () => call('videos:pick'),
  importFiles: (files) => call('videos:import', files.map((f) => webUtils.getPathForFile(f)).filter(Boolean)),
  saveThumbnail: (videoPath, dataUrl) => call('videos:thumbnail', videoPath, dataUrl),
  savePost: (input) => call('posts:save', input),
  savePosts: (inputs) => call('posts:saveMany', inputs),
  deletePost: (id) => call('posts:delete', id),
  postAction: (id, action, platform) => call('posts:action', id, action, platform),
  reschedule: (id, iso) => call('posts:reschedule', id, iso),
  updateSettings: (patch) => call('settings:update', patch),
  instagramConnect: (args) => call('instagram:connect', args),
  instagramChoose: (igUserId) => call('instagram:choose', igUserId),
  instagramDisconnect: () => call('instagram:disconnect'),
  instagramLimit: () => call('instagram:limit'),
  youtubeConnect: (args) => call('youtube:connect', args),
  youtubeDisconnect: () => call('youtube:disconnect'),
  importPaths: (paths) => call('videos:import', paths),
  pickYouTubeThumbnail: () => call('youtube:pickThumbnail'),
  youtubeThumbnailFromFile: (file) => call('youtube:thumbnailFromPath', webUtils.getPathForFile(file)),
  listFolder: () => call('folder:list'),
  chooseFolder: () => call('folder:choose'),
  saveFolderThumb: (path, dataUrl) => call('folder:thumb', path, dataUrl),
  onFolderChanged: (cb) => subscribe('folder:changed', () => cb()),
  folderUrl: (relPath) => `cadence-media://folder/${encodeURIComponent(relPath)}`,
  refreshInsights: () => call('insights:refresh'),
  refreshAnalytics: () => call('analytics:refresh'),
  retention: (videoId) => call('analytics:retention', videoId),
  openExternal: (url) => call('shell:open', url),
  reveal: (path) => call('shell:reveal', path),
  openDataFolder: () => call('shell:dataFolder'),
  platform: process.platform,
  mediaUrl: (path) => `cadence-media://lib/${encodeURIComponent(path.split('/').pop() ?? '')}`
}

contextBridge.exposeInMainWorld('cadence', api)
