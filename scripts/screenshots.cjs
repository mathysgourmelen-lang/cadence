// Launches the real built app with seeded data and screenshots every screen.
const { _electron: electron } = require('playwright')
const path = require('path')
const out = process.argv[2]
const videos = process.argv[3]
const theme = process.argv[4] || 'dark'
;(async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(__dirname, '..'), '--no-sandbox', '--force-device-scale-factor=2'],
    env: { ...process.env, CADENCE_SKIP_ACCOUNT_CHECK: '1' }
  })
  const errors = []
  const win = await app.firstWindow()
  win.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`[${m.type()}] ${m.text()}`))
  win.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setSize(1440, 900)
    w.show()
  })
  await win.waitForSelector('.sidebar')
  await win.evaluate((t) => window.cadence.updateSettings({ appearance: t }), theme)
  await win.waitForTimeout(600)
  const shot = async (name) => {
    await win.waitForTimeout(700)
    await win.screenshot({ path: path.join(out, `${theme}-${name}.png`) })
  }
  const nav = async (label) => {
    await win.click(`.nav-item:has-text("${label}")`)
    await win.waitForTimeout(300)
  }
  await nav('Queue')
  await shot('queue')
  await nav('Calendar')
  await shot('calendar')
  await nav('History')
  await shot('history')
  await nav('Accounts')
  await shot('accounts')
  await nav('Settings')
  await shot('settings')
  await nav('Setup Guide')
  await shot('guide')
  await nav('Compose')
  await shot('compose-empty')
  // Stub the file dialog and import real files through the app.
  const files = ['morning-routine.mp4', 'tokyo.mp4', 'landscape-vlog.mp4'].map((f) => path.join(videos, f))
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths })
  }, files)
  await win.click('button:has-text("Choose videos")')
  await win.waitForSelector('.tray-item')
  await win.fill('textarea[placeholder^="Write a caption"]', 'My 5am routine that actually stuck ☀️ Save this for tomorrow.\n\n#morningroutine #productivity @max.creates')
  await win.waitForTimeout(2500)
  await shot('compose')
  await win.click('.chip:has-text("Core tags")')
  await win.locator('.page').evaluate((el) => el.scrollTo(0, 400))
  await shot('compose-scrolled')
  await win.click('.tray-item:nth-child(3)')
  await shot('compose-landscape')
  await win.click('button:has-text("Spread schedule")')
  await shot('spread')
  await win.click('.modal button:has-text("Apply")')
  await win.click('.tray-item:nth-child(2)')
  await win.fill('textarea[placeholder^="Write a caption"]', 'Golden hour in Shibuya 🌆 #tokyo #travel')
  await win.click('.tray-item:nth-child(3)')
  await win.fill('textarea[placeholder^="Write a caption"]', 'Weekend vlog, full version on the channel')
  await win.click('button:has-text("Schedule all")')
  await win.waitForTimeout(800)
  await shot('after-schedule')
  await nav('Queue')
  await shot('queue-after')
  const state = await win.evaluate(() => window.cadence.getState())
  console.log('posts:', state.posts.length, state.posts.map((p) => `${p.video.fileName}:${p.instagram.state}/${p.youtube.state}`).join(', '))
  console.log('ERRORS:\n' + errors.join('\n'))
  await app.evaluate(({ app }) => app.exit(0))
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
