# Shared Calendar — Setup Guide

A mobile-first PWA that syncs a shared calendar in real time between everyone who has the link.

---

## 1. Set up Supabase

1. Go to [supabase.com](https://supabase.com) and open your project
2. Click **SQL Editor** in the left sidebar
3. Paste the contents of **setup.sql** and click **Run**
4. Go to **Project Settings → API**
5. Copy your **Project URL** and **anon public** key

---

## 2. Configure the app

Open **config.js** and replace the placeholders:

```js
const SUPABASE_URL  = 'https://your-project-id.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGc...your-anon-key...';
```

---

## 3. Deploy to Render

1. Push all these files to a **GitHub repository**
2. Go to [render.com](https://render.com) → **New → Static Site**
3. Connect your GitHub repo
4. Set **Publish directory** to `.` (just a dot)
5. Leave **Build Command** blank
6. Click **Create Static Site**

Render gives you a URL like `https://shared-calendar-xxxx.onrender.com`

---

## 4. Add to phones as an app icon

**iPhone (Safari):**
1. Open the URL in Safari
2. Tap the Share button (box with arrow)
3. Scroll down → **Add to Home Screen**
4. Tap **Add**

**Android (Chrome):**
1. Open the URL in Chrome
2. Tap the three-dot menu
3. Tap **Add to Home screen**
4. Tap **Add**

Share the URL with everyone who needs access — they repeat the "add to home screen" step.

---

## Features

- **Shared in real time** — events appear instantly on everyone's screen
- **Month calendar view** — tap any day to see events
- **Add/edit/delete events** — title, date, time, color, notes
- **All-day events** — shown as colored bars across the day
- **Reminders** — browser notification when browser is running (10 min / 30 min / 1 hr / 1 day / 2 days before)
- **Who added it** — every event shows who created it
- **Works offline** — app loads from cache if you have no connection (read-only when offline)
- **Dark mode** — follows your system preference

---

## Notes on reminders

Browser reminders fire when the browser is open and running. For the most reliable reminders:
- On iPhone, keep the app open or in recent apps
- On Android, the browser can run reminders in the background

For push notifications that work even when the browser is fully closed, a third-party push service would need to be added — this version keeps it simple.
