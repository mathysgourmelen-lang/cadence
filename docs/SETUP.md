# Setting up Cadence

This guide takes you from zero to your first scheduled Reel and Short. Plan on about **30 minutes** the first time. You only do it once.

You will:

1. Install Cadence on your Mac.
2. Connect **Instagram** (about 15 minutes).
3. Connect **YouTube** (about 10 minutes).
4. Schedule your first post.

You can connect just one platform if you only post to one.

> Cadence has no servers and no account. Videos go straight from your Mac to Instagram and YouTube, and your keys are stored encrypted in the macOS Keychain.

<!-- anchor:install -->
## 1. Install Cadence

1. Download `Cadence-<version>-arm64.dmg` (Apple Silicon: M1, M2, M3, M4…) or `Cadence-<version>-x64.dmg` (older Intel Macs). Not sure? Apple menu → **About This Mac**: if it says "Chip: Apple M…", pick arm64.
2. Open the .dmg and drag **Cadence** into **Applications**.
3. Open Cadence from Applications. Because the app isn't signed with a paid Apple Developer certificate, macOS asks for confirmation the first time:
   - If you see **"Apple could not verify Cadence…"**, click **Done**, then open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to the Cadence message. Confirm with your password.
   - If you see **"Cadence is damaged and can't be opened"**, open the Terminal app, paste `xattr -cr /Applications/Cadence.app`, press Return, and open Cadence again. (This removes the "downloaded from the internet" flag; nothing is actually damaged.)
4. Cadence opens on the **Accounts** screen and adds a small icon to the menu bar at the top of your screen.

---

<!-- anchor:instagram -->
## 2. Connect Instagram

Instagram only allows apps to publish to **professional accounts** (Business or Creator) that are **linked to a Facebook Page**. That's a Meta rule, not a Cadence one. You'll then create a free "Meta app", which is just a set of keys that lets Cadence talk to Instagram for you.

### 2.1 Make your Instagram account professional

Skip this if your account is already a Creator or Business account.

1. In the Instagram app, go to your profile → **☰ menu** → **Account type and tools** (sometimes under **Settings and privacy → Account type and tools**).
2. Tap **Switch to professional account**, pick a category, and choose **Creator** or **Business**. Both work with Cadence.

### 2.2 Link Instagram to a Facebook Page

1. If you don't have a Facebook Page yet, create one at [facebook.com/pages/create](https://www.facebook.com/pages/create). Any name works (for example your creator name). It doesn't need to be public-facing or active.
2. Link it: in the Instagram app, go to your profile → **Edit profile** → **Page** (under "Public business information") → choose your Page. Alternatively, on Facebook open your Page → **Settings → Linked accounts → Instagram → Connect account**.

### 2.3 Create a Meta developer account and app

1. Go to [developers.facebook.com](https://developers.facebook.com) and click **Get Started** (or **Log in**) with the Facebook account that manages your Page. Accept the terms and verify your account if asked.
2. Click **My Apps → Create App**.
3. Give it a name like **Cadence** and enter your email.
4. When asked what the app should do (the "use case" step), choose **Other**, then choose the app type **Business**. If you are asked to connect a Business portfolio, you can skip it ("I don't want to connect a business portfolio yet").
5. Click **Create app** and enter your Facebook password if asked.
6. On the app's dashboard, find **Instagram** in the list of products and click **Set up**. If you are offered two options, choose **API setup with Facebook login** (not "Instagram login"). Also add **Facebook Login for Business** if it is offered.

> Leave the app in **Development** mode. You don't need App Review or Business Verification: as the app's admin, you can publish to your own accounts.

### 2.4 Copy your App ID and App Secret

1. In the left sidebar go to **App settings → Basic**.
2. Copy the **App ID** (a long number).
3. Next to **App secret** click **Show**, enter your password, and copy it (32 letters and numbers).

Keep this tab open.

### 2.5 Generate an access token

1. Open the [Graph API Explorer](https://developers.facebook.com/tools/explorer/).
2. On the right, under **Meta App**, select **Cadence** (the app you just made).
3. Under **User or Page**, choose **Get User Access Token** (or **User Token**).
4. Under **Permissions**, click **Add a permission** and add all six of these:
   - `instagram_basic`
   - `instagram_content_publish`
   - `instagram_manage_insights` (lets the **Views** tab read your view counts)
   - `pages_show_list`
   - `pages_read_engagement`
   - `business_management`
   - Only if your Page is managed in **Meta Business Suite** (a business portfolio): also `ads_management` and `ads_read`. Meta requires them in that setup. Cadence never touches ads.
5. Click **Generate Access Token**. A Facebook window opens:
   - Click **Continue as …**.
   - When asked which Pages and Instagram accounts to allow, select **the Page** from step 2.2 **and your Instagram account** (or choose "Opt in to all current and future…").
   - Leave every permission switched on and click **Save** / **Continue**.
6. Copy the long token that appears in the **Access Token** field (it starts with `EAA`).

This token is short-lived, but Cadence immediately trades it for a permanent one, so you only do this once.

### 2.6 Paste everything into Cadence

1. In Cadence open [Accounts](cadence://accounts).
2. In the Instagram card, paste the **App ID**, **App Secret** and **Access token**.
3. Click **Connect Instagram**. If you manage several Pages with Instagram accounts, tick every account you want to post to.

You should see your @username with a green **connected** badge.

**More Instagram accounts:** click **Add Instagram account**. Cadence reuses your App ID and Secret, so you only paste a new access token. Make it as in 2.5 while logged in to Facebook with access to that account's Page, and tick that Page and Instagram account in the Facebook window. One token can cover several accounts: Cadence lists them all and you tick the ones to add.

### Instagram troubleshooting

| Message | What to do |
| --- | --- |
| "No Instagram professional account was found" | Check 2.1 and 2.2, then generate a new token in 2.5 and make sure you ticked both the Page and the Instagram account in the Facebook window. |
| "Instagram permission missing" | One of the six permissions in 2.5 is missing. Generate a new token with all six. |
| Views tab says Instagram "did not allow Cadence to read views" | The token was made without `instagram_manage_insights`. Repeat 2.5 with that permission added, then 2.6. Your scheduled posts are not affected. |
| "Instagram sign-in expired or was revoked" | This happens if you change your Facebook password, remove the app's access, or lose admin access to the Page. Repeat 2.5 and 2.6. |
| "Page Publishing Authorization" error | Facebook wants extra verification for your Page. Open the Page on Facebook and follow the prompt (usually confirming your identity), then retry. |
| "Instagram could not process this video" | The file is in a format Instagram rejects. Re-export as H.264, AAC audio, 30 fps, 1080×1920. |

---

<!-- anchor:youtube -->
## 3. Connect YouTube

You'll create a free Google Cloud project, which gives Cadence permission to upload to your channel.

### 3.1 Create a project and enable the YouTube API

1. Open [console.cloud.google.com](https://console.cloud.google.com) and sign in with the Google account that owns your YouTube channel. Accept the terms if asked. No billing or credit card is needed.
2. Click the project picker at the top → **New project** → name it **Cadence** → **Create**. Make sure the new project is selected at the top.
3. Open [the YouTube Data API v3 page](https://console.cloud.google.com/apis/library/youtube.googleapis.com) and click **Enable**.
4. Open [the YouTube Analytics API page](https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com) and click **Enable** too. The **Analytics** tab uses it for watch time and retention.

### 3.2 Set up the consent screen

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) (APIs & Services → OAuth consent screen) and click **Get started**.
2. **App information:** app name **Cadence**, choose your email as the support email → **Next**.
3. **Audience:** choose **External** → **Next**.
4. **Contact information:** your email → **Next**, tick the agreement → **Create**.
5. Go to **Audience** in the left menu. Under **Test users**, click **Add users** and add your own Gmail address.

### 3.3 Create the OAuth client

1. Go to **Clients** in the left menu → **Create client**.
2. **Application type: Desktop app**. Name it **Cadence Mac** → **Create**.
3. A window shows the **Client ID** and **Client secret**. **Copy both now** (or click **Download JSON**). Google may not show the secret again; if you lose it, create a new client.

### 3.4 Stop the 7-day sign-out (important)

While your app is in **Testing**, Google signs Cadence out of YouTube **every 7 days**. To avoid that:

1. Go to **Audience** → under **Publishing status**, click **Publish app** → **Confirm**.
2. The status changes to **In production**. You do **not** need to submit for verification. Since only you use it, Google will simply show an "unverified app" warning when you sign in.

### 3.5 Sign in from Cadence

1. In Cadence open [Accounts](cadence://accounts) and paste the **Client ID** and **Client secret** into the YouTube card.
2. Click **Sign in with Google**. Your browser opens.
3. Choose the account that owns your channel. If you see **"Google hasn't verified this app"**, click **Advanced → Go to Cadence (unsafe)**. It's your own app, so this is expected.
4. Tick **every** box (manage your YouTube videos, view your YouTube account, and view YouTube Analytics reports), then click **Continue**.
5. The browser says "YouTube connected". Switch back to Cadence; your channel appears in the YouTube card.

**More channels:** click **Add another channel** and sign in again, choosing the other Google account or brand channel. All channels share the same Client ID. While your Google Cloud app is in Testing, add each extra Google account under **Audience → Test users** first (step 3.2.5). The 100 uploads a day limit is shared by all channels.

<!-- anchor:audit -->
### 3.6 If your uploads stay private

Google may keep videos uploaded from a brand-new, unaudited Cloud project as **private**, even when you ask for public. Google's documentation has been inconsistent about this, so Cadence checks every upload: if YouTube kept a video private, the post's activity log says so and the video is still safely on your channel.

If that happens:

- You can make a video public by hand in [YouTube Studio](https://studio.youtube.com) → Content → Visibility.
- To remove the restriction for good, submit the **YouTube API Services – Audit and Quota Extension Form** at [support.google.com/youtube/contact/yt_api_form](https://support.google.com/youtube/contact/yt_api_form). Describe it honestly: "A personal desktop app that uploads my own videos to my own channel. No other users." Approval usually takes a few days to a few weeks.

### YouTube limits to know

- **Uploads per day:** YouTube's default allowance is **100 uploads per day** per Cloud project, reset at midnight Pacific time. Cadence shows how many you've used. Your channel may also have its own daily upload cap; if you hit it, Cadence retries later.
- **Shorts:** a video becomes a Short when it's **vertical or square** and **3 minutes or less**. Adding `#Shorts` to the title or description is optional.
- **Scheduling:** with **Let YouTube publish** (the default), Cadence uploads the Short as soon as you schedule it and YouTube makes it public at your chosen time, even if your Mac is off.

### YouTube troubleshooting

| Message | What to do |
| --- | --- |
| "The YouTube Data API v3 is not enabled" | Do step 3.1.3, wait 2 minutes, then retry. |
| "The YouTube Analytics API is not enabled" | Do step 3.1.4, wait 2 minutes, then click **Refresh** in Analytics. |
| Analytics says "Cadence needs permission to read your YouTube analytics" | You connected before the Analytics tab existed, or left a box unticked. In Accounts, click **Add another channel**, choose the same channel and tick every box. Scheduled posts are kept. |
| The wrong channel was added | Click **Remove** next to it, then **Add another channel** and choose the right account. |
| "Access blocked: Cadence has not completed the Google verification process" | Your account isn't a test user and the app isn't published. Do step 3.2.5 or 3.4. |
| "YouTube sign-in expired or was revoked" | Usually the 7-day limit from step 3.4. Publish the app, then click **Reconnect**. |
| "Google did not return a refresh token" | Go to [myaccount.google.com/permissions](https://myaccount.google.com/permissions), remove Cadence, then sign in again. |
| "This Google account has no YouTube channel" | Create a channel at [youtube.com](https://www.youtube.com) first, or sign in with the right account. |

---

<!-- anchor:using -->
## 4. Scheduling your posts

1. Click **New Post** and drag your MP4 or MOV files into the window (or click **Choose videos**). You can add many at once.
2. For each video, choose **Instagram**, **YouTube** or both, write the caption, and check the YouTube title (it's filled from your caption's first line).
3. Pick a date and time, or **Post now**. With several videos, **Spread schedule** gives each one its own slot (for example every day at 6 PM).
4. Click **Schedule** (or **Schedule all**).

**Several accounts:** when you've connected more than one Instagram account or YouTube channel, a **Post to** card appears at the top of the post. Tick the accounts this video goes to. Ticking two accounts creates two separate posts (one per account) at the same time, which you can then edit or move on their own. The Queue, Calendar and History show which account each post goes to, the Views tab shows every account plus a combined total, and Analytics has an account switch at the top.

**Custom YouTube thumbnail (optional):** in YouTube details, click **Choose image** (or drop a PNG or JPEG on the box). Cadence shrinks big images to YouTube's 2 MB limit and sets the thumbnail right after the upload. YouTube only allows custom thumbnails on **verified channels**: verify yours once with a phone number at [youtube.com/verify](https://www.youtube.com/verify). If it isn't verified, the Short still posts and the post's activity log explains why the thumbnail was skipped.

The right side shows a live phone preview and checks every video against each platform's rules before anything uploads.

### How posting works

- **Instagram:** Instagram doesn't let apps schedule reels on its servers, so Cadence does it on your Mac. It uploads the reel about 10 minutes early (you can change this in [Settings](cadence://settings)), lets Instagram process it, and publishes it right on time.
- **YouTube:** Cadence uploads right away and YouTube publishes at your time on its own.
- If something fails because of the network, Cadence retries automatically with increasing delays. Real problems (for example a rejected video) show up in **History → Needs attention** with the exact reason and a **Retry** button.
- Cadence never posts the same video twice: if it was interrupted mid-publish, it checks with Instagram before trying again.

### Your video folder (Library tab)

If you always export your edits to the same place, open **Library** and click **Choose folder** (for example `Movies › Exports`). Cadence lists every MP4 and MOV in it and its subfolders, newest first, and updates the list when you add files.

- Each video shows its length, shape, and whether it's ready for a **Reel** and a **Short** (green tick, yellow warning, or red cross; hover for the reason).
- Badges show which videos are already **Posted** or **In queue**, so you don't post the same clip twice. **Not posted** filters to the fresh ones.
- Use the slider next to the sort menu (or **⌘ −** and **⌘ +**) to show from 2 to 12 videos per row. **⌘ 0** goes back to 5.
- Hover a video to play it. Click to select several (Shift-click selects a range), then **Create posts**. Or hover one and click **Post this**.
- Your files are never moved or changed. Cadence makes its own copy when you schedule, so you can tidy the folder afterwards.

### Your views (Views tab)

**Views** shows the total views on each connected account, a combined total, how much they grew over the last 7, 30 or 90 days, and your most-viewed posts.

- **YouTube:** the total is YouTube's own lifetime view count for your channel. Top videos come from your latest 200 uploads.
- **Instagram:** Instagram doesn't give a single account total, so Cadence adds up the views of each of your posts (up to your latest 1,000). This needs the `instagram_manage_insights` permission from step 2.5.
- Numbers refresh when you open the tab (if they're over 15 minutes old), every few hours in the background, or when you click **Refresh**. The growth lines fill in as Cadence checks each day.
- Posts marked **via Cadence** were published by this app.

### Watch time, skip rate and retention (Analytics tab)

**Analytics** shows how people watch each video, like the dashboards inside Instagram and YouTube Studio. Click a column title to sort; click a row for details.

- **Instagram Reels (latest 50):** views, reach, **average watch time**, **skip rate** (the share of views that swiped away in the first 3 seconds; lower is better), total watch time, shares and saves. It also highlights your best hook and the reel watched longest, and how much of each reel an average play covers.
- **YouTube (latest 50 uploads):** views, engaged views, **average % viewed** (over 100% means people rewatched, common for Shorts), average view duration, watch time, likes and subscribers gained, plus where your views came from (Shorts feed, search, and so on) over the last 28 days. Click a video for its **audience retention graph**, with a note on whether it's above or below typical for its length.
- **Best time to post:** a heatmap of how your posts did by weekday and time of day (in your Mac's time zone), with your best window, best days and weakest window. Each post is compared with the ones you posted around the same time, so a growing account doesn't skew it. It uses up to 1,000 reels or 200 Shorts once the Views tab has loaded, needs at least 8 posts older than 2 days, and **Use … as my times** makes Compose suggest those times for new posts.
- **Best video length:** groups your videos by length (under 10 s, 10–15 s, 15–20 s and so on) and shows, for each group, how many views they got compared with your typical post and what share of the video people watched. Your **sweet spot** is the length that clearly gets the most views. Like best time to post, it compares each post with the ones around it and needs at least 8 posts older than 2 days. Instagram doesn't report a reel's length, so Cadence reads it from the start of each video file (a few kilobytes, not the whole video) and remembers it.
- **Exact numbers:** hover any shortened number (like 62K) to see the exact count.
- **What isn't available:** Instagram's API has no retention graph, and YouTube's API doesn't share the Shorts "stayed to watch vs swiped away" figure, so Cadence can't show those. Instagram marks skip rate as still in development; if your account doesn't get it yet, Cadence says so.
- Numbers lag 1 to 3 days behind the apps, the same as their own dashboards' API data.

<!-- anchor:awake -->
### Keep Cadence running for Instagram

For Instagram posts, Cadence must be **open** (it can be hidden; closing the window keeps it in the menu bar) and your Mac must be **awake** at posting time.

- Turn on **Open at login** in [Settings](cadence://settings) so it starts after a restart.
- **Keep Mac awake before posts** (on by default) stops your Mac from idling to sleep while uploads run or a post is due soon.
- A **closed MacBook lid** still puts the Mac to sleep. If you post at times you're away, keep the lid open and plugged in, or use an external display.
- If your Mac was off at posting time, Cadence posts as soon as it's back, or asks you first if you choose **Ask me first** in Settings.

### Recommended video format

| Setting | Recommended |
| --- | --- |
| Resolution | 1080 × 1920 (9:16 vertical) |
| Codec | H.264 (or HEVC) with AAC audio |
| Frame rate | 24, 25, 30 or 60 fps |
| Length | 3 seconds to 3 minutes (Shorts max 3:00, Reels max 15:00) |
| File size | Under 300 MB for Instagram |

In Final Cut Pro, Premiere, CapCut or iMovie, the default "1080p H.264" export at 9:16 works.

---

## Privacy and security

- Your Meta token, App Secret and Google sign-in are encrypted with the **macOS Keychain** and stored only on this Mac.
- Cadence talks only to `graph.facebook.com`, `rupload.facebook.com` and Google's YouTube and sign-in servers.
- To remove Cadence's access at any time: Instagram via [Facebook → Settings → Business integrations](https://www.facebook.com/settings?tab=business_tools), YouTube via [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
