# OfficeTime — personal attendance tracker

OfficeTime records your manual punch-in, breaks, resume-work, and end-of-day events. It calculates actual work time from timestamps, uses a daily target of **8 hours of work**, and a combined daily break allowance of **60 minutes** (15-minute break + 30-minute lunch + 15-minute break).

Break times are flexible. The 15/30/15 split is displayed as a guide; the app does not enforce fixed times or prevent a break from exceeding its planned duration.

## Stack

- React + Vite frontend
- Vercel hosting and serverless API proxy
- Google Apps Script backend
- Google Sheets for event and daily summary storage

## Important calculation details

- Actual work time is the sum of intervals between `START_WORK`/`RESUME_WORK` and the next `START_BREAK`/`END_DAY`.
- Break time is the sum of intervals between `START_BREAK` and the next `RESUME_WORK`/`END_DAY`.
- Estimated finish time is first punch-in + 8 hours + total break time.
- This is a personal helper, not an official attendance system. Follow your employer's attendance rules if they differ.

## 1. Create the Google Sheet

1. Create a blank Google Sheet, for example `OfficeTime Attendance`.
2. Copy the spreadsheet ID from its URL: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`.
3. Open **Extensions → Apps Script**.
4. Replace the editor contents with `apps-script/Code.gs`.
5. Open **Project Settings → Script Properties** and add:
   - `SPREADSHEET_ID` = the ID copied from the sheet URL.
   - `API_SECRET` = a long random secret (32+ random characters). Example generation on Windows PowerShell: `[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`
6. In Apps Script **Project Settings**, set the time zone to **Asia/Kolkata**.
7. Run `doPost` is not a useful manual test because it expects an HTTP event. Instead deploy first and test through the website.

The script creates `Events` and `Daily Summary` tabs automatically when the first request arrives.

## 2. Deploy Apps Script as a web app

1. Click **Deploy → New deployment**.
2. Select type **Web app**.
3. Description: `OfficeTime API`.
4. Execute as: **Me**.
5. Who has access: **Anyone**.
6. Deploy and complete Google's authorization prompts.
7. Copy the web app URL ending in `/exec`.

The Apps Script endpoint is publicly reachable, but it checks a shared secret before reading or writing data. The Vercel API also checks `APP_ACCESS_CODE` before forwarding a request, so visitors cannot use the website without the code. Keep both secrets private. This is a lightweight personal access gate, not a full account system with user management or multi-factor authentication.

## 3. Run locally (Windows)

Install Node.js LTS first, then open a terminal in this project folder:

```powershell
npm install
Copy-Item .env.example .env
```

Edit `.env` with the Apps Script URL and the same secret configured in Script Properties. Vite does not automatically expose server-side variables to the browser; for local development, run Vercel's local dev server so `/api/attendance` is available:

```powershell
npm install -g vercel
vercel dev
```

When prompted, link or create a Vercel project. Add the two environment variables in the Vercel project settings (or use a local `.env` file supported by your Vercel CLI version). Open the local URL printed by `vercel dev`.

For a frontend-only preview, `npm run dev` can build the UI, but API requests will fail unless you also proxy `/api` to a running serverless endpoint. Use `vercel dev` for the full integration test.

## 4. Deploy to Vercel

### Option A: GitHub (recommended)

1. Create a new GitHub repository and upload this project.
2. Import that repository in Vercel.
3. Framework preset: **Vite**.
4. Build command: `npm run build`.
5. Output directory: `dist`.
6. In Vercel → **Project → Settings → Environment Variables**, add:
   - `APPS_SCRIPT_URL` = the deployed Apps Script `/exec` URL.
   - `APPS_SCRIPT_SECRET` = the exact same secret as the Apps Script `API_SECRET`.
   - `APP_ACCESS_CODE` = a unique private code for the dashboard.
   - `APP_ACCESS_CODE` = a private code you will enter to open the dashboard. Use a long, unique value and do not reuse an important account password.
7. Redeploy after adding environment variables.

### Option B: Vercel CLI

```powershell
npm install -g vercel
vercel
```

Follow the prompts to create/link the project, then add environment variables in the Vercel dashboard. Deploy production:

```powershell
vercel --prod
```

## 5. Verify it

1. Open the deployed website.
2. Confirm the connection indicator says **Sheets connected**.
3. Press **Start Work**. Confirm a row appears in `Events`.
4. Press **Start Break**, then **Resume Work**. Confirm both timestamps are saved.
5. Press **End Day** only when you really intend to close that day's record.
6. Check `Daily Summary` for a row containing work seconds, break seconds, and status.

## Actions and data layout

`Events` is append-only and contains:
- `Timestamp`
- `Date`
- `Action`
- `Session ID`

`Daily Summary` keeps one current summary row per date. Supported transitions:
- Not started → Start Work
- Working → Start Break
- On break → Resume Work
- Working or On break → End Day

## Limitations / safeguards

- Buttons record the time the request reaches the Apps Script service, which may be a few seconds after the click.
- The website records what you enter; it does not read your office fingerprint/RFID scanner.
- Do not leave a break open overnight. Use the End Day action if you need to close the day while on break.
- The current version is designed for one personal user. The shared secret protects the backend from casual unauthenticated requests, but anyone who gains access to your Vercel project settings or secret can access the API.
- A missed punch correction UI is not included in this first version. The dashboard has a shared access-code gate; it is not a full user-account system.
