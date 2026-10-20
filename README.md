# ⏱️ Shiftly — Smart Workday & Shift Attendance Tracker

> A high-contrast, hyper-tactile **Neo-Brutalist** workday tracker designed for daily office shifts. Automatically computes actual working hours, monitors break budgets, provides smart countdown timers with vibration alerts, compensates break overages, and securely records attendance to your own **Google Sheet** — with **100% offline resilience**.

---

## ⚡ Key Highlights

- **8-Hour Target & 60-Minute Break Budget**: Configured for standard office shifts (8 hours required work + 60 minutes flexible planned break time: 15m Morning + 30m Lunch + 15m Evening).
- **Split-Flap Airport Clock Display**: Real-time flip animation showing live working hours, minutes, and seconds.
- **Offline Resilience (Zero Lost Punches)**: If connection drops in basements, parking lots, or elevators, punches save instantly to local cache (0ms response) and auto-sync to Google Sheets with original timestamps when connectivity restores.
- **Smart Break Focus Timer & Vibration Alerts**: Visual countdown ring for 15m, 30m, or custom breaks. Vibrates your mobile device at 2 minutes remaining and at 0m so you never accidentally exceed your allowance.
- **Smart Break Compensation Advisor**: If morning or lunch goes over allowance, the advisor dynamically calculates the exact adjustment needed for upcoming breaks and provides a **1-Tap `[⚡ Apply]`** preset to preserve your standard on-time finish!
- **Late Punch & Custom Time Picker**: Forgot to punch in 20 minutes ago? Slide the interactive hour/minute swipe pickers or use quick nudge chips (`-15m`, `-30m`, `-1h`) to log the exact time you arrived.
- **Full Punch Management**: Edit past punch timestamps, add missed punches, or delete accidental punches directly from the UI.
- **Attendance Calendar & Discipline Streaks**: Track consecutive on-time workdays (meeting 8 hours with 0m break overage) and inspect daily details on a monthly calendar view.
- **Analytics & CSV Export**: Weekly bar charts comparing work vs. break time against the 8-hour target line, plus 1-click CSV export of historical records.
- **Neo-Brutalist Light & Dark Themes**: Handcrafted high-contrast palettes with tactile 3D offset hard shadows and instantaneous 1-tap switching.
- **100% Free & Serverless**: Hosted on Vercel with Google Sheets as your private database. No monthly subscription or database hosting fees.

---

## 🏗️ Architecture

```
┌─────────────────────────────────┐
│     Client (Browser / PWA)      │
│  React + Vite · Neo-Brutalism   │
└───────────────┬─────────────────┘
                │ POST /api/attendance
                ▼
┌─────────────────────────────────┐
│      Vercel Serverless API      │
│  Validates APP_ACCESS_CODE &    │
│  proxies request with SECRET    │
└───────────────┬─────────────────┘
                │ POST payload + API_SECRET
                ▼
┌─────────────────────────────────┐
│    Google Apps Script Web App   │
│   (LockService · In-Memory)     │
└───────────────┬─────────────────┘
                │ Reads & Writes
                ▼
┌─────────────────────────────────┐
│       Your Google Sheet         │
│  Tabs: 'Events' & 'Daily Summary'│
└─────────────────────────────────┘
```

---

## 🚀 Quick Setup Guide (For New Users)

Follow these 4 simple steps to set up and deploy your own private Shiftly tracker.

---

### Step 1: Create Your Google Sheet Backend

1. Open [Google Sheets](https://sheets.new) and create a new blank spreadsheet (e.g., name it `Shiftly Attendance`).
2. Copy the **Spreadsheet ID** from the address bar in your browser:
   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit
   ```
3. In the Google Sheets menu, click **Extensions → Apps Script**.
4. In the Apps Script code editor, delete any existing code and paste the entire contents of [`apps-script/Code.gs`](apps-script/Code.gs).
5. On the left sidebar of Apps Script, click the **Project Settings** (gear icon ⚙️):
   - Under **Script Properties**, click **Add script property** and add these two:
     - `SPREADSHEET_ID` = Paste the Spreadsheet ID you copied in Step 1.2.
     - `API_SECRET` = A strong random secret string (e.g. `shiftly_secret_9843729184712`).
   - Under **Time zone**, verify that the time zone matches your office/local time zone (e.g., `(GMT+05:30) India Standard Time - Kolkata`).
6. Click **Deploy → New deployment** (top right blue button):
   - Click the gear icon next to "Select type" and choose **Web app**.
   - **Description**: `Shiftly Production API`
   - **Execute as**: **Me** (`your-email@gmail.com`)
   - **Who has access**: **Anyone** *(Access is protected by your secret key)*
   - Click **Deploy**.
   - Authorize permissions when prompted by Google (*Click Advanced → Go to Shiftly (unsafe)*).
7. Copy the **Web App URL** ending in `/exec`. It looks like:
   ```
   https://script.google.com/macros/s/AKfycbx.../exec
   ```

> [!NOTE]
> When your first punch arrives, Apps Script will automatically generate and format the two required tabs: `Events` (raw punch timeline) and `Daily Summary` (daily totals and status).

---

### Step 2: Deploy to Vercel (Zero Cost)

Deploying to Vercel provides HTTPS hosting and protects your backend secrets through a serverless API proxy.

#### Option A: GitHub Import (Recommended)

1. Push or fork this repository to your GitHub account.
2. Go to [Vercel](https://vercel.com) and click **Add New → Project**.
3. Import your GitHub repository.
4. Keep the default settings:
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Expand **Environment Variables** and add these 3 variables:

| Variable Name | Value Description | Example |
| :--- | :--- | :--- |
| `APPS_SCRIPT_URL` | The Web App URL ending in `/exec` from Step 1.7 | `https://script.google.com/macros/s/.../exec` |
| `APPS_SCRIPT_SECRET` | The exact same value you entered in Apps Script `API_SECRET` | `shiftly_secret_9843729184712` |
| `APP_ACCESS_CODE` | A private PIN/password you will enter to unlock the dashboard | `your_secret_pin_here` |

6. Click **Deploy**.
7. In ~30 seconds, Vercel will provide your live URL (e.g. `https://your-shiftly.vercel.app`).

---

### Step 3: Run Locally (Optional)

If you want to run Shiftly on your local computer or make custom code changes:

1. Clone your repository and install dependencies:
   ```bash
   git clone https://github.com/your-username/shiftly.git
   cd shiftly
   npm install
   ```

2. Create your local environment file:
   ```bash
   # On Windows PowerShell:
   Copy-Item .env.example .env

   # On macOS / Linux:
   cp .env.example .env
   ```

3. Open `.env` and fill in your three values:
   ```env
   APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
   APPS_SCRIPT_SECRET=your_configured_secret
   APP_ACCESS_CODE=your_chosen_login_code
   ```

4. Run the development server with Vercel CLI (so local serverless `/api` routes work):
   ```bash
   npm install -g vercel
   vercel dev
   ```
   Open `http://localhost:3000` in your browser.

---

## 📱 How to Use Shiftly (Daily Workflow)

### 1. Unlocking Your Dashboard
When you open Shiftly, enter your **Access Code** (the `APP_ACCESS_CODE` you configured in Vercel). Shiftly securely remembers your session in your browser so you don't have to retype it every time.

---

### 2. Standard Shift Flow
- **When You Arrive**: Tap **Start Work** (green button). Your live Split-Flap board begins ticking and shows your on-time target finish time (first punch + 8 hours + 1 hour standard break = e.g., `6:16 PM`).
- **When Stepping Out for Break / Lunch**: Tap **Start Break** (yellow button). The break timer starts counting.
- **When Returning from Break**: Tap **Resume Work** (purple button). Your work timer resumes immediately.
- **When Leaving the Office**: Tap **End Day** (coral red button). This records your final checkout timestamp and locks today's record.

---

### 3. Forgot to Punch? Use Late Punch Slider
If you arrived at `9:15 AM` but forgot to open the app until `9:35 AM`:
1. Tap **"Forgot to punch earlier? Set custom punch time"**.
2. Tap the **`-15m`** or **`-30m`** quick nudge chips, or drag the interactive **Hour / Minute Swipe Sliders** to `9:15 AM`.
3. Tap **Start Work**. Shiftly records your punch with the exact backdated timestamp!

---

### 4. Smart Break Focus Countdown & Alerts
When you tap **Start Break**, an interactive focus ring appears:
- Choose from presets (`15m`, `30m Lunch`, `45m`, or custom).
- As you take your break, the ring counts down in real time.
- **Gentle Vibration Alert**: At **2 minutes remaining**, your phone gives a subtle alert pattern: *“Break ending soon — head back to punch in on time!”*
- At **0 minutes remaining**, it notifies you that your allowance has been met.

---

### 5. Smart Break Compensation Advisor
If a break accidentally runs over allowance (e.g. morning break was 19m instead of 15m):
- The advisor analyzes your upcoming untouched break slots.
- **1-Tap Preset**: Tap **`[⚡ Apply]`** next to Option 1: *"Shorten Lunch from 30m to 26m to still finish at 6:16 PM"*.
- The live progress bar and finish targets immediately update to preserve your standard on-time finish.
- If you change your mind, tap **`[↺ Undo Preset]`** anytime.

---

### 6. Editing Past Punches
Made an error?
- Scroll down to **Today's Activity / Punch History**.
- Tap the **Pencil (Edit)** icon on any punch row to adjust its time with the swipe picker.
- Tap the **Trash** icon to delete a duplicate punch.
- Tap **Add Punch** to insert a missing punch between existing records.

---

### 7. Offline Resilience (Basement & Elevator Protection)
- When offline, a distinct indicator appears: `Offline (Queued)`.
- You can tap **Start Work**, **Start Break**, or **Resume Work** completely normally.
- Punches are saved instantly to local browser memory with the exact second you tapped.
- Once connectivity returns, an amber sync badge prompts you or auto-syncs all queued events directly to Google Sheets with their original timestamps preserved!

---

### 8. Light & Dark Neo-Brutalist Themes
Tap the **`LIGHT` / `DARK`** toggle button in the top right corner anytime. Shiftly instantly switches the high-contrast Neo-Brutalist palette and remembers your preference.

---

## 📊 Google Sheets Data Structure

Shiftly automatically manages two sheets inside your spreadsheet:

### Tab 1: `Events` (Append-Only Log)
Every single punch action is appended as an immutable record:
| Column | Description | Example |
| :--- | :--- | :--- |
| `Timestamp` | ISO 8601 UTC timestamp | `2026-10-20T03:45:00.000Z` |
| `Date` | Local date string (`YYYY-MM-DD`) | `2026-10-20` |
| `Action` | One of `START_WORK`, `START_BREAK`, `RESUME_WORK`, `END_DAY` | `START_WORK` |
| `Session ID` | Unique deterministic identifier | `sess_1729415100000_w8b2` |

### Tab 2: `Daily Summary` (Consolidated Daily Records)
One consolidated row per date, automatically updated with every action:
| Column | Description | Example |
| :--- | :--- | :--- |
| `Date` | Local date key | `2026-10-20` |
| `First Punch In` | First arrival time | `9:16 AM` |
| `Last Punch` | Most recent action time | `6:22 PM` |
| `Status` | Current state | `COMPLETED` |
| `Work Seconds` | Total net seconds worked | `28820` |
| `Break Seconds` | Total seconds on break | `3600` |
| `Work Hours` | Formatted work duration | `8h 00m` |
| `Break Minutes` | Formatted break duration | `60m` |
| `Updated At` | Timestamp of last calculation | `2026-10-20T12:52:00.000Z` |

---

## 🛠️ Tech Stack & Dependencies

- **Frontend**: [React 18](https://react.dev) + [Vite](https://vitejs.dev)
- **Styling**: Vanilla CSS (Neo-Brutalist design tokens, 3D offset hard shadows, split-flap keyframe animations)
- **Icons**: [Lucide React](https://lucide.dev)
- **Hosting**: [Vercel](https://vercel.com) Serverless Functions (`api/attendance.js`)
- **Backend & Database**: [Google Apps Script](https://developers.google.com/apps-script) + [Google Sheets](https://docs.google.com/spreadsheets)

---

## ❓ Frequently Asked Questions (FAQ)

### Can I install Shiftly on my phone like an app?
**Yes!** Open your deployed Vercel URL in **Safari (iOS)** or **Chrome (Android)**:
- On **iOS Safari**: Tap the Share button → **Add to Home Screen**.
- On **Android Chrome**: Tap the three dots menu → **Add to Home screen** / **Install App**.
Shiftly will launch in full-screen standalone mode with no browser address bar!

### Is my data shared with anyone?
**No.** All attendance records are written exclusively to your own Google Sheet in your personal Google Drive. The Vercel function merely acts as a secure serverless proxy between your browser and your Google Sheet.

### What if I work past midnight?
Punches are grouped by local calendar day (`todayKey()`). To start a fresh workday, complete your previous shift with **End Day** before beginning the next day's shift.

---

## 📜 Credits & License

Created with care by [Irf4n](https://github.com/Irf4n8).  
Distributed under the **MIT License**. Free for personal and commercial use.
