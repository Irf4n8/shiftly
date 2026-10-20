/**
 * OfficeTime Google Apps Script backend.
 *
 * Before deploying:
 * 1. Create a Google Sheet.
 * 2. Open Extensions > Apps Script and paste this file.
 * 3. In Project Settings > Script Properties, add:
 *      API_SECRET = the same long random secret as Vercel APPS_SCRIPT_SECRET
 *      SPREADSHEET_ID = the ID from the Google Sheet URL
 * 4. Deploy > New deployment > Web app.
 *    Execute as: Me
 *    Who has access: Anyone
 * The public endpoint only accepts requests carrying the shared secret.
 */

const EVENTS_SHEET = "Events";
const DAILY_SHEET = "Daily Summary";
const HEADERS = ["Timestamp", "Date", "Action", "Session ID"];
const DAILY_HEADERS = [
  "Date", "First Punch In", "Last Punch", "Status",
  "Work Seconds", "Break Seconds", "Work Hours", "Break Minutes", "Updated At"
];

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const props = PropertiesService.getScriptProperties();
    const expectedSecret = props.getProperty("API_SECRET");
    if (!expectedSecret || payload.secret !== expectedSecret) {
      return json_({ ok: false, error: "Unauthorized request." });
    }

    const ss = getSpreadsheet_();
    ensureSheets_(ss);
    const action = String(payload.action || "");

    if (action === "GET_TODAY") {
      const dateKey = dateKey_(new Date());
      const allEvents = readEvents_(ss);
      const events = allEvents.filter(row => row.date === dateKey);
      const history = buildDailyHistory_(allEvents);
      return json_({ ok: true, events: events, history: history });
    }

    const allowed = ["START_WORK", "START_BREAK", "RESUME_WORK", "END_DAY"];
    if (!allowed.includes(action)) {
      return json_({ ok: false, error: "Unknown action." });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const now = new Date();
      const dateKey = dateKey_(now);
      const allEvents = readEvents_(ss);
      const today = allEvents.filter(row => row.date === dateKey);
      const state = summarize_(today, now.getTime());

      const transitions = {
        START_WORK: state.status === "NOT_STARTED",
        START_BREAK: state.status === "WORKING",
        RESUME_WORK: state.status === "ON_BREAK",
        END_DAY: state.status === "WORKING" || state.status === "ON_BREAK"
      };
      if (!transitions[action]) {
        return json_({
          ok: false,
          error: "That action is not available in your current state. Refresh the page and try again."
        });
      }

      const sessionId = dateKey + "-" + (today.length + 1);
      ss.getSheetByName(EVENTS_SHEET).appendRow([
        now,
        dateKey,
        action,
        sessionId
      ]);

      const updatedEvents = readEvents_(ss).filter(row => row.date === dateKey);
      const updatedSummary = summarize_(updatedEvents, now.getTime());
      upsertDailySummary_(ss, dateKey, updatedEvents, updatedSummary, now);
      return json_({
        ok: true,
        message: messageFor_(action),
        events: updatedEvents,
        history: buildDailyHistory_(readEvents_(ss))
      });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("Set SPREADSHEET_ID in Apps Script Project Settings > Script Properties.");
  return SpreadsheetApp.openById(id);
}

function ensureSheets_(ss) {
  let events = ss.getSheetByName(EVENTS_SHEET);
  if (!events) events = ss.insertSheet(EVENTS_SHEET);
  if (events.getLastRow() === 0) events.appendRow(HEADERS);

  let daily = ss.getSheetByName(DAILY_SHEET);
  if (!daily) daily = ss.insertSheet(DAILY_SHEET);
  if (daily.getLastRow() === 0) daily.appendRow(DAILY_HEADERS);

  events.setFrozenRows(1);
  daily.setFrozenRows(1);
  events.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
  daily.getRange(1, 1, 1, DAILY_HEADERS.length).setFontWeight("bold");
}

function readEvents_(ss) {
  const sheet = ss.getSheetByName(EVENTS_SHEET);
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();
  return values.map(row => ({
    timestamp: row[0] instanceof Date ? row[0].toISOString() : new Date(row[0]).toISOString(),
    date: String(row[1]),
    action: String(row[2]),
    sessionId: String(row[3] || "")
  })).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function summarize_(events, nowMs) {
  let status = "NOT_STARTED";
  let workSeconds = 0;
  let breakSeconds = 0;
  let workStartedAt = null;
  let breakStartedAt = null;
  let firstPunch = "";
  let lastPunch = "";

  events.forEach(event => {
    const t = new Date(event.timestamp).getTime();
    if (!firstPunch) firstPunch = event.timestamp;
    lastPunch = event.timestamp;

    if (event.action === "START_WORK" && status === "NOT_STARTED") {
      status = "WORKING";
      workStartedAt = t;
    } else if (event.action === "START_BREAK" && status === "WORKING") {
      workSeconds += Math.max(0, (t - workStartedAt) / 1000);
      workStartedAt = null;
      breakStartedAt = t;
      status = "ON_BREAK";
    } else if (event.action === "RESUME_WORK" && status === "ON_BREAK") {
      breakSeconds += Math.max(0, (t - breakStartedAt) / 1000);
      breakStartedAt = null;
      workStartedAt = t;
      status = "WORKING";
    } else if (event.action === "END_DAY" && (status === "WORKING" || status === "ON_BREAK")) {
      if (status === "WORKING" && workStartedAt !== null) {
        workSeconds += Math.max(0, (t - workStartedAt) / 1000);
      } else if (status === "ON_BREAK" && breakStartedAt !== null) {
        breakSeconds += Math.max(0, (t - breakStartedAt) / 1000);
      }
      workStartedAt = null;
      breakStartedAt = null;
      status = "COMPLETED";
    }
  });

  if (status === "WORKING" && workStartedAt !== null) {
    workSeconds += Math.max(0, (nowMs - workStartedAt) / 1000);
  }
  if (status === "ON_BREAK" && breakStartedAt !== null) {
    breakSeconds += Math.max(0, (nowMs - breakStartedAt) / 1000);
  }
  return { status: status, workSeconds: workSeconds, breakSeconds: breakSeconds, firstPunch: firstPunch, lastPunch: lastPunch };
}

function upsertDailySummary_(ss, dateKey, events, summary, now) {
  const sheet = ss.getSheetByName(DAILY_SHEET);
  const row = [
    dateKey,
    summary.firstPunch ? new Date(summary.firstPunch) : "",
    summary.lastPunch ? new Date(summary.lastPunch) : "",
    summary.status,
    Math.round(summary.workSeconds),
    Math.round(summary.breakSeconds),
    Math.round(summary.workSeconds / 3600 * 100) / 100,
    Math.round(summary.breakSeconds / 60 * 100) / 100,
    now
  ];
  const last = sheet.getLastRow();
  let targetRow = 0;
  if (last >= 2) {
    const dates = sheet.getRange(2, 1, last - 1, 1).getDisplayValues().flat();
    const idx = dates.findIndex(value => value === dateKey);
    if (idx >= 0) targetRow = idx + 2;
  }
  if (targetRow === 0) targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
  sheet.getRange(targetRow, 2, 1, 1).setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange(targetRow, 3, 1, 1).setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange(targetRow, 9, 1, 1).setNumberFormat("yyyy-mm-dd hh:mm:ss");
}

function buildDailyHistory_(events) {
  const byDate = {};
  events.forEach(event => {
    if (!byDate[event.date]) byDate[event.date] = [];
    byDate[event.date].push(event);
  });
  return Object.keys(byDate).sort().reverse().slice(0, 31).map(date => {
    const rows = byDate[date];
    const summary = summarize_(rows, new Date(rows[rows.length - 1].timestamp).getTime());
    return {
      date: date,
      status: summary.status,
      workSeconds: Math.round(summary.workSeconds),
      breakSeconds: Math.round(summary.breakSeconds),
      firstPunch: summary.firstPunch,
      lastPunch: summary.lastPunch
    };
  });
}

function dateKey_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}
function messageFor_(action) {
  return {
    START_WORK: "Work started. Your punch-in is saved.",
    START_BREAK: "Break started. Your work timer is paused.",
    RESUME_WORK: "Welcome back. Your break duration is saved.",
    END_DAY: "Day completed. Your attendance is saved."
  }[action] || "Saved.";
}
function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
