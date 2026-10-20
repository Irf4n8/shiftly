/**
 * OfficeTime Google Apps Script backend.
 *
 * Supports:
 * - Real-time punches (START_WORK, START_BREAK, RESUME_WORK, END_DAY)
 * - Custom punch-in timestamp (when you forget to punch in earlier)
 * - Editing existing punch timestamps (EDIT_EVENT)
 * - Deleting mistaken punches (DELETE_EVENT)
 * - Automatic recalculation of Daily Summary and work/break times
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
    const expectedSecret = String(props.getProperty("API_SECRET") || "").trim();
    const receivedSecret = String(payload.secret || "").trim();
    if (!expectedSecret || receivedSecret !== expectedSecret) {
      return json_({ ok: false, error: "Unauthorized request." });
    }

    const ss = getSpreadsheet_();
    ensureSheets_(ss);
    const action = String(payload.action || "");

    if (action === "GET_TODAY") {
      const now = new Date();
      const dateKey = dateKey_(now);
      const allEvents = readEvents_(ss);
      const events = allEvents.filter(row => row.date === dateKey);
      const history = buildDailyHistory_(allEvents);
      return json_({ ok: true, events: events, history: history });
    }

    // Edit an existing punch timestamp
    if (action === "EDIT_EVENT") {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        const sessionId = String(payload.sessionId || "");
        const originalTimestamp = String(payload.originalTimestamp || "");
        const newTimestamp = payload.timestamp ? new Date(payload.timestamp) : null;
        if (!newTimestamp || isNaN(newTimestamp.getTime())) {
          return json_({ ok: false, error: "Invalid timestamp provided." });
        }

        const sheet = ss.getSheetByName(EVENTS_SHEET);
        const lastRow = sheet.getLastRow();
        if (lastRow < 2) return json_({ ok: false, error: "No events found to edit." });

        const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
        let targetRowIndex = -1;
        for (let i = 0; i < values.length; i++) {
          if (sessionId && String(values[i][3]) === sessionId) {
            targetRowIndex = i + 2;
            break;
          }
          if (originalTimestamp) {
            const rowIso = values[i][0] instanceof Date ? values[i][0].toISOString() : new Date(values[i][0]).toISOString();
            if (rowIso === originalTimestamp) {
              targetRowIndex = i + 2;
              break;
            }
          }
        }

        if (targetRowIndex === -1) {
          return json_({ ok: false, error: "Event not found in sheet." });
        }

        const dateKey = dateKey_(newTimestamp);
        sheet.getRange(targetRowIndex, 1).setValue(newTimestamp);
        sheet.getRange(targetRowIndex, 2).setValue(dateKey);

        const now = new Date();
        const updatedEvents = readEvents_(ss).filter(row => row.date === dateKey);
        const updatedSummary = summarize_(updatedEvents, now.getTime());
        upsertDailySummary_(ss, dateKey, updatedEvents, updatedSummary, now);

        return json_({
          ok: true,
          message: "Punch time updated successfully.",
          events: updatedEvents,
          history: buildDailyHistory_(readEvents_(ss))
        });
      } finally {
        lock.releaseLock();
      }
    }

    // Delete an accidental punch
    if (action === "DELETE_EVENT") {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        const sessionId = String(payload.sessionId || "");
        const originalTimestamp = String(payload.originalTimestamp || "");
        const sheet = ss.getSheetByName(EVENTS_SHEET);
        const lastRow = sheet.getLastRow();
        if (lastRow < 2) return json_({ ok: false, error: "No events found to delete." });

        const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
        let targetRowIndex = -1;
        let eventDate = "";
        for (let i = 0; i < values.length; i++) {
          if (sessionId && String(values[i][3]) === sessionId) {
            targetRowIndex = i + 2;
            eventDate = String(values[i][1]);
            break;
          }
          if (originalTimestamp) {
            const rowIso = values[i][0] instanceof Date ? values[i][0].toISOString() : new Date(values[i][0]).toISOString();
            if (rowIso === originalTimestamp) {
              targetRowIndex = i + 2;
              eventDate = String(values[i][1]);
              break;
            }
          }
        }

        if (targetRowIndex === -1) {
          return json_({ ok: false, error: "Event not found in sheet." });
        }

        sheet.deleteRow(targetRowIndex);

        const now = new Date();
        const dateKey = eventDate || dateKey_(now);
        const updatedEvents = readEvents_(ss).filter(row => row.date === dateKey);
        const updatedSummary = summarize_(updatedEvents, now.getTime());
        upsertDailySummary_(ss, dateKey, updatedEvents, updatedSummary, now);

        return json_({
          ok: true,
          message: "Punch removed.",
          events: updatedEvents,
          history: buildDailyHistory_(readEvents_(ss))
        });
      } finally {
        lock.releaseLock();
      }
    }

    const allowed = ["START_WORK", "START_BREAK", "RESUME_WORK", "END_DAY"];
    if (!allowed.includes(action)) {
      return json_({ ok: false, error: "Unknown action." });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const now = new Date();
      // Allow custom past timestamp (e.g. if punch-in was forgotten)
      const eventTime = payload.timestamp ? new Date(payload.timestamp) : now;
      if (isNaN(eventTime.getTime())) {
        return json_({ ok: false, error: "Invalid timestamp." });
      }

      const dateKey = dateKey_(eventTime);
      const allEvents = readEvents_(ss);
      const today = allEvents.filter(row => row.date === dateKey);
      const state = summarize_(today, now.getTime());

      // Validate transitions unless force is requested
      if (!payload.force) {
        const transitions = {
          START_WORK: state.status === "NOT_STARTED",
          START_BREAK: state.status === "WORKING",
          RESUME_WORK: state.status === "ON_BREAK",
          END_DAY: state.status === "WORKING" || state.status === "ON_BREAK"
        };
        if (!transitions[action]) {
          return json_({
            ok: false,
            error: "That action is not available in your current state. You can edit previous punches or toggle custom time."
          });
        }
      }

      const sessionId = dateKey + "-" + (today.length + 1) + "-" + new Date().getTime();
      ss.getSheetByName(EVENTS_SHEET).appendRow([
        eventTime,
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
  return values.filter(row => row[0]).map(row => {
    let iso = "";
    try {
      iso = row[0] instanceof Date ? row[0].toISOString() : new Date(row[0]).toISOString();
    } catch (e) {
      iso = new Date().toISOString();
    }
    return {
      timestamp: iso,
      date: String(row[1] || ""),
      action: String(row[2] || ""),
      sessionId: String(row[3] || "")
    };
  }).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
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

    if (event.action === "START_WORK") {
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
