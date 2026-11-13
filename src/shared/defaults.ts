import type { Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  appearance: 'system',
  launchAtLogin: false,
  keepAwake: true,
  instagramLeadMinutes: 10,
  missedPolicy: 'post',
  defaultTimes: ['09:00', '12:30', '18:00', '21:00'],
  youtubeDefaultPrivacy: 'public',
  youtubeDefaultCategory: '22',
  youtubeDefaultMode: 'native',
  youtubeMadeForKids: false,
  instagramShareToFeed: true,
  graphApiVersion: 'v24.0',
  snippets: [],
  paused: false,
  notifications: true,
  libraryFolder: null
}

export const YOUTUBE_CATEGORIES: { id: string; name: string }[] = [
  { id: '1', name: 'Film & Animation' },
  { id: '2', name: 'Autos & Vehicles' },
  { id: '10', name: 'Music' },
  { id: '15', name: 'Pets & Animals' },
  { id: '17', name: 'Sports' },
  { id: '19', name: 'Travel & Events' },
  { id: '20', name: 'Gaming' },
  { id: '22', name: 'People & Blogs' },
  { id: '23', name: 'Comedy' },
  { id: '24', name: 'Entertainment' },
  { id: '25', name: 'News & Politics' },
  { id: '26', name: 'Howto & Style' },
  { id: '27', name: 'Education' },
  { id: '28', name: 'Science & Technology' },
  { id: '29', name: 'Nonprofits & Activism' }
]
