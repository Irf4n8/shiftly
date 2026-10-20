import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine, ArrowUpFromLine, Coffee, Clock3, CalendarDays,
  CheckCircle2, CircleAlert, RefreshCw, Timer, Utensils, Wifi, WifiOff,
  Edit2, Trash2, Plus, X, Clock
} from "lucide-react";

const TARGET_SECONDS = 8 * 60 * 60;
const BREAK_ALLOWANCE_SECONDS = 60 * 60;
const ACTION_LABELS = {
  START_WORK: "Work started",
  START_BREAK: "Break started",
  RESUME_WORK: "Work resumed",
  END_DAY: "Day completed"
};

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDuration(seconds = 0) {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function formatClock(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDate(date = new Date()) {
  return date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function getLocalTimeString(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function timeStringToIso(timeStr, baseDate = new Date()) {
  if (!timeStr) return new Date().toISOString();
  const [hours, minutes] = timeStr.split(":").map(Number);
  const d = baseDate instanceof Date ? new Date(baseDate) : new Date(baseDate || Date.now());
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

function applyOffsetToTime(timeStr, minutesOffset) {
  const [hours, minutes] = (timeStr || getLocalTimeString()).split(":").map(Number);
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  d.setMinutes(d.getMinutes() + minutesOffset);
  return getLocalTimeString(d);
}

function summarize(events, nowMs = Date.now()) {
  let status = "NOT_STARTED";
  let workSeconds = 0;
  let breakSeconds = 0;
  let workStartedAt = null;
  let breakStartedAt = null;
  let firstPunch = null;
  let lastPunch = null;

  for (const event of events) {
    const t = new Date(event.timestamp).getTime();
    if (!Number.isFinite(t)) continue;
    if (!firstPunch) firstPunch = event.timestamp;
    lastPunch = event.timestamp;

    if (event.action === "START_WORK") {
      status = "WORKING";
      workStartedAt = t;
    } else if (event.action === "START_BREAK" && status === "WORKING") {
      if (workStartedAt !== null) workSeconds += Math.max(0, (t - workStartedAt) / 1000);
      workStartedAt = null;
      breakStartedAt = t;
      status = "ON_BREAK";
    } else if (event.action === "RESUME_WORK" && status === "ON_BREAK") {
      if (breakStartedAt !== null) breakSeconds += Math.max(0, (t - breakStartedAt) / 1000);
      breakStartedAt = null;
      workStartedAt = t;
      status = "WORKING";
    } else if (event.action === "END_DAY") {
      if (status === "WORKING" && workStartedAt !== null) {
        workSeconds += Math.max(0, (t - workStartedAt) / 1000);
      }
      if (status === "ON_BREAK" && breakStartedAt !== null) {
        breakSeconds += Math.max(0, (t - breakStartedAt) / 1000);
      }
      workStartedAt = null;
      breakStartedAt = null;
      status = "COMPLETED";
    }
  }

  if (status === "WORKING" && workStartedAt !== null) {
    workSeconds += Math.max(0, (nowMs - workStartedAt) / 1000);
  }
  if (status === "ON_BREAK" && breakStartedAt !== null) {
    breakSeconds += Math.max(0, (nowMs - breakStartedAt) / 1000);
  }

  return { status, workSeconds, breakSeconds, firstPunch, lastPunch };
}

export default function App() {
  const [accessCode, setAccessCode] = useState(() => sessionStorage.getItem("officetime_access") || "");
  const [codeInput, setCodeInput] = useState("");
  const [authenticated, setAuthenticated] = useState(() => Boolean(sessionStorage.getItem("officetime_access")));
  const [events, setEvents] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());
  const [connected, setConnected] = useState(false);

  // Custom punch time state
  const [isCustomTimeOpen, setIsCustomTimeOpen] = useState(false);
  const [customTime, setCustomTime] = useState(() => getLocalTimeString());

  // Edit existing punch state
  const [editingEvent, setEditingEvent] = useState(null);
  const [editTimeInput, setEditTimeInput] = useState("");

  // Add missed punch modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [manualActionInput, setManualActionInput] = useState("START_WORK");
  const [manualTimeInput, setManualTimeInput] = useState(() => getLocalTimeString());

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "GET_TODAY", accessCode })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load attendance.");
      setEvents(data.events || []);
      setHistory(data.history || []);
      setConnected(true);
      setError("");
    } catch (e) {
      setConnected(false);
      setError(e.message || "Could not connect to the attendance service.");
    } finally {
      setLoading(false);
    }
  }, [accessCode]);

  useEffect(() => {
    if (authenticated && accessCode) refresh();
    else setLoading(false);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(clock);
  }, [refresh, authenticated, accessCode]);

  const summary = useMemo(() => summarize(events, now), [events, now]);
  const workRemaining = Math.max(0, TARGET_SECONDS - summary.workSeconds);
  const breakRemaining = Math.max(0, BREAK_ALLOWANCE_SECONDS - summary.breakSeconds);
  const breakOver = Math.max(0, summary.breakSeconds - BREAK_ALLOWANCE_SECONDS);
  const progress = Math.min(100, (summary.workSeconds / TARGET_SECONDS) * 100);
  const estimatedEnd = useMemo(() => {
    if (!summary.firstPunch || summary.status === "COMPLETED") return null;
    const start = new Date(summary.firstPunch).getTime();
    return new Date(start + TARGET_SECONDS * 1000 + summary.breakSeconds * 1000);
  }, [summary.firstPunch, summary.breakSeconds, summary.status]);

  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "GET_TODAY", accessCode: codeInput })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not verify access code.");
      sessionStorage.setItem("officetime_access", codeInput);
      setAccessCode(codeInput);
      setAuthenticated(true);
      setEvents(data.events || []);
      setHistory(data.history || []);
      setConnected(true);
      setCodeInput("");
      setNotice("");
    } catch (e) {
      setError(e.message || "Could not verify access code.");
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    sessionStorage.removeItem("officetime_access");
    setAccessCode("");
    setAuthenticated(false);
    setEvents([]);
    setHistory([]);
    setConnected(false);
  }

  async function punch(action, customTimestamp = null) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = { action, accessCode };
      if (customTimestamp) {
        body.timestamp = customTimestamp;
      }
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not save this punch.");
      setEvents(data.events || []);
      setHistory(data.history || []);
      setConnected(true);
      setNotice(data.message || ACTION_LABELS[action] || "Saved.");
      setIsCustomTimeOpen(false);
      setCustomTime(getLocalTimeString());
    } catch (e) {
      setError(e.message || "Could not save this punch.");
    } finally {
      setBusy(false);
    }
  }

  function openEditModal(event) {
    setEditingEvent(event);
    setEditTimeInput(getLocalTimeString(new Date(event.timestamp)));
  }

  async function saveEditPunch() {
    if (!editingEvent || !editTimeInput) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const newIso = timeStringToIso(editTimeInput, editingEvent.timestamp);
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "EDIT_EVENT",
          sessionId: editingEvent.sessionId,
          originalTimestamp: editingEvent.timestamp,
          timestamp: newIso,
          accessCode
        })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not update punch time.");
      setEvents(data.events || []);
      setHistory(data.history || []);
      setConnected(true);
      setNotice("Punch time updated.");
      setEditingEvent(null);
    } catch (e) {
      setError(e.message || "Could not update punch time.");
    } finally {
      setBusy(false);
    }
  }

  async function deletePunch(eventToDelete) {
    const timeFormatted = formatClock(eventToDelete.timestamp);
    const actionName = ACTION_LABELS[eventToDelete.action] || eventToDelete.action;
    if (!window.confirm(`Are you sure you want to remove this punch?\n\n${actionName} at ${timeFormatted}`)) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "DELETE_EVENT",
          sessionId: eventToDelete.sessionId,
          originalTimestamp: eventToDelete.timestamp,
          accessCode
        })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not delete punch.");
      setEvents(data.events || []);
      setHistory(data.history || []);
      setConnected(true);
      setNotice("Punch removed.");
    } catch (e) {
      setError(e.message || "Could not delete punch.");
    } finally {
      setBusy(false);
    }
  }

  async function addManualPunch() {
    if (!manualTimeInput) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const newIso = timeStringToIso(manualTimeInput);
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: manualActionInput,
          timestamp: newIso,
          force: true,
          accessCode
        })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not add missed punch.");
      setEvents(data.events || []);
      setHistory(data.history || []);
      setConnected(true);
      setNotice("Missed punch added successfully.");
      setIsAddModalOpen(false);
    } catch (e) {
      setError(e.message || "Could not add missed punch.");
    } finally {
      setBusy(false);
    }
  }

  const statusCopy = {
    NOT_STARTED: ["Not started", "Start your day when you arrive."],
    WORKING: ["Working", "Your work timer is running."],
    ON_BREAK: ["On break", "Your break timer is running."],
    COMPLETED: ["Day completed", "Today's attendance has been closed."]
  }[summary.status];

  // Helper for custom punch label
  const customTimeFormatted = isCustomTimeOpen && customTime ? formatClock(timeStringToIso(customTime)) : null;

  if (!authenticated || !accessCode) {
    return (
      <main className="shell auth-shell">
        <header className="topbar">
          <a className="brand" href="/" aria-label="OfficeTime home"><span className="brand-mark"><Clock3 size={20} /></span><span>Office<span className="brand-light">Time</span></span></a>
          <div className="connection offline"><WifiOff size={15} /><span>Private access</span></div>
        </header>
        <section className="auth-card">
          <div className="brand-mark auth-mark"><Clock3 size={24} /></div>
          <p className="eyebrow">PERSONAL ATTENDANCE</p>
          <h1>Welcome <span>back.</span></h1>
          <p className="auth-copy">Enter your private access code to open your attendance dashboard.</p>
          {error && <div className="alert error"><CircleAlert size={18} /><span>{error}</span></div>}
          <form onSubmit={login} className="auth-form">
            <label htmlFor="access-code">Access code</label>
            <input id="access-code" type="password" autoComplete="current-password" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="Enter your access code" required />
            <button className="action-button primary auth-submit" type="submit" disabled={busy || !codeInput.trim()}><span><strong>{busy ? "Checking…" : "Unlock dashboard"}</strong><small>Your code is checked securely on the server</small></span><span className="action-arrow">↗</span></button>
          </form>
          <p className="helper-note">Set APP_ACCESS_CODE in your Vercel environment variables before using the deployed app.</p>
        </section>
        <footer><span>OfficeTime · Personal use</span><span>Private dashboard</span></footer>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="OfficeTime home">
          <span className="brand-mark"><Clock3 size={20} /></span>
          <span>Office<span className="brand-light">Time</span></span>
        </a>
        <div className="topbar-right">
          <div className={`connection ${connected ? "online" : "offline"}`}>
            {connected ? <Wifi size={15} /> : <WifiOff size={15} />}
            <span>{connected ? "Sheets connected" : "Not connected"}</span>
          </div>
          <button className="logout-button" onClick={logout}>Lock</button>
        </div>
      </header>

      <section className="intro">
        <div>
          <p className="eyebrow">PERSONAL ATTENDANCE</p>
          <h1>Your workday,<br /><span>under control.</span></h1>
          <p className="date-line"><CalendarDays size={16} /> {formatDate()}</p>
        </div>
        <div className="status-pill">
          <span className={`status-dot ${summary.status.toLowerCase()}`} />
          {statusCopy[0]}
        </div>
      </section>

      {error && <div className="alert error"><CircleAlert size={18} /><span>{error}</span><button className="text-button" onClick={() => refresh()}>Retry</button></div>}
      {notice && !error && <div className="alert success"><CheckCircle2 size={18} /><span>{notice}</span></div>}

      <section className="hero-card">
        <div className="hero-head">
          <div>
            <p className="muted-label">ACTUAL WORK TIME</p>
            <div className="big-time">{formatDuration(summary.workSeconds)}</div>
            <p className="target-line">of <strong>8 hours</strong> required</p>
          </div>
          <div className="hero-icon"><Timer size={27} /></div>
        </div>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
        <div className="progress-caption"><span>{Math.round(progress)}% complete</span><span>{workRemaining > 0 ? `${formatDuration(workRemaining)} to go` : "Target reached"}</span></div>
        <div className="hero-divider" />
        <div className="hero-bottom">
          <div><span className="small-label">Punched in</span><strong>{formatClock(summary.firstPunch)}</strong></div>
          <div><span className="small-label">Estimated finish</span><strong>{estimatedEnd ? estimatedEnd.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}</strong></div>
        </div>
      </section>

      <section className="metrics-grid">
        <article className="metric-card">
          <div className="metric-icon break"><Coffee size={19} /></div>
          <p className="metric-label">Break time used</p>
          <div className="metric-number">{formatDuration(summary.breakSeconds)}</div>
          <div className="metric-foot">{formatDuration(Math.max(0, BREAK_ALLOWANCE_SECONDS - summary.breakSeconds))} allowance left</div>
          <div className="mini-track"><div className={`mini-fill ${breakOver > 0 ? "over" : ""}`} style={{ width: `${Math.min(100, summary.breakSeconds / BREAK_ALLOWANCE_SECONDS * 100)}%` }} /></div>
          {breakOver > 0 && <p className="over-text">{formatDuration(breakOver)} over allowance</p>}
        </article>
        <article className="metric-card">
          <div className="metric-icon lunch"><Utensils size={19} /></div>
          <p className="metric-label">Daily break plan</p>
          <div className="metric-number">60 <span>min</span></div>
          <div className="break-breakdown">
            <span>Break 1 <b>15m</b></span>
            <span>Lunch <b>30m</b></span>
            <span>Break 2 <b>15m</b></span>
          </div>
        </article>
      </section>

      <section className="actions-section">
        <div className="section-heading">
          <div><p className="eyebrow">QUICK ACTIONS</p><h2>Attendance controls</h2></div>
          <span className="autosave"><span /> Saves to Google Sheets</span>
        </div>

        <div className="action-grid">
          {summary.status === "NOT_STARTED" && (
            <button className="action-button primary" disabled={busy || loading} onClick={() => punch("START_WORK", isCustomTimeOpen && customTime ? timeStringToIso(customTime) : null)}>
              <span className="action-icon"><ArrowDownToLine size={21} /></span>
              <span>
                <strong>{customTimeFormatted ? `Start Work (${customTimeFormatted})` : "Start Work"}</strong>
                <small>{customTimeFormatted ? `Record punch-in set at ${customTimeFormatted}` : "Record your first punch-in"}</small>
              </span>
              <span className="action-arrow">↗</span>
            </button>
          )}
          {summary.status === "WORKING" && (
            <button className="action-button primary" disabled={busy || loading} onClick={() => punch("START_BREAK", isCustomTimeOpen && customTime ? timeStringToIso(customTime) : null)}>
              <span className="action-icon"><Coffee size={21} /></span>
              <span>
                <strong>{customTimeFormatted ? `Start Break (${customTimeFormatted})` : "Start Break"}</strong>
                <small>{customTimeFormatted ? `Pause timer set at ${customTimeFormatted}` : "Pause your work timer"}</small>
              </span>
              <span className="action-arrow">↗</span>
            </button>
          )}
          {summary.status === "ON_BREAK" && (
            <button className="action-button primary" disabled={busy || loading} onClick={() => punch("RESUME_WORK", isCustomTimeOpen && customTime ? timeStringToIso(customTime) : null)}>
              <span className="action-icon"><ArrowUpFromLine size={21} /></span>
              <span>
                <strong>{customTimeFormatted ? `Resume Work (${customTimeFormatted})` : "Resume Work"}</strong>
                <small>{customTimeFormatted ? `End break set at ${customTimeFormatted}` : "End your current break"}</small>
              </span>
              <span className="action-arrow">↗</span>
            </button>
          )}
          {(summary.status === "WORKING" || summary.status === "ON_BREAK") && (
            <button className="action-button secondary" disabled={busy || loading} onClick={() => {
              if (window.confirm("End your workday now? This will close today's attendance record.")) {
                punch("END_DAY", isCustomTimeOpen && customTime ? timeStringToIso(customTime) : null);
              }
            }}>
              <span className="action-icon"><ArrowDownToLine size={21} /></span>
              <span>
                <strong>{customTimeFormatted ? `End Day (${customTimeFormatted})` : "End Day"}</strong>
                <small>Close today's attendance</small>
              </span>
              <span className="action-arrow">↗</span>
            </button>
          )}
          {summary.status === "COMPLETED" && (
            <div className="completed-card"><CheckCircle2 size={22} /><div><strong>Day completed</strong><p>Today's punches are saved. Come back tomorrow to start a new day.</p></div></div>
          )}
        </div>

        {/* Custom Punch Time Accordion */}
        <div className="custom-time-bar">
          <button
            type="button"
            className={`custom-time-toggle ${isCustomTimeOpen ? "active" : ""}`}
            onClick={() => {
              if (!isCustomTimeOpen) setCustomTime(getLocalTimeString());
              setIsCustomTimeOpen(!isCustomTimeOpen);
            }}
          >
            <Clock size={13} />
            <span>{isCustomTimeOpen ? "Cancel custom time" : "Forgot to punch earlier? Set custom punch time"}</span>
          </button>

          {isCustomTimeOpen && (
            <div className="custom-time-box">
              <div className="custom-time-row">
                <label htmlFor="custom-punch-time">Set exact punch time:</label>
                <input
                  id="custom-punch-time"
                  type="time"
                  className="time-input"
                  value={customTime}
                  onChange={(e) => setCustomTime(e.target.value)}
                />
                <div className="chip-group">
                  <button type="button" className="chip-btn" onClick={() => setCustomTime(getLocalTimeString())}>Now</button>
                  <button type="button" className="chip-btn" onClick={() => setCustomTime(applyOffsetToTime(customTime, -15))}>-15m</button>
                  <button type="button" className="chip-btn" onClick={() => setCustomTime(applyOffsetToTime(customTime, -30))}>-30m</button>
                  <button type="button" className="chip-btn" onClick={() => setCustomTime(applyOffsetToTime(customTime, -45))}>-45m</button>
                  <button type="button" className="chip-btn" onClick={() => setCustomTime(applyOffsetToTime(customTime, -60))}>-1h</button>
                  <button type="button" className="chip-btn" onClick={() => setCustomTime(applyOffsetToTime(customTime, -120))}>-2h</button>
                </div>
              </div>
              <div className="custom-time-preview">
                Your next punch above will be recorded as: <strong>{formatClock(timeStringToIso(customTime))} today</strong>.
              </div>
            </div>
          )}
        </div>

        <p className="helper-note">Use Start Break when you leave work for any reason, then Resume Work when you return. Break timing is flexible.</p>
      </section>

      <section className="history-section">
        <div className="section-heading">
          <div><p className="eyebrow">TODAY'S ACTIVITY</p><h2>Punch history</h2></div>
          <div className="history-controls">
            <button className="add-punch-btn" onClick={() => { setManualTimeInput(getLocalTimeString()); setIsAddModalOpen(true); }} disabled={loading || busy}>
              <Plus size={13} /> Add punch
            </button>
            <button className="refresh-button" onClick={() => refresh()} disabled={loading || busy}>
              <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
            </button>
          </div>
        </div>
        <div className="history-card">
          {loading ? <div className="empty-state">Loading your attendance…</div> :
            events.length === 0 ? <div className="empty-state"><Clock3 size={22} /><strong>No punches yet</strong><span>Press Start Work when you arrive at the office.</span></div> :
            [...events].reverse().map((event, index) => (
              <div className="history-row" key={`${event.timestamp}-${event.action}-${index}`}>
                <div className={`history-symbol ${event.action.toLowerCase()}`}>
                  {event.action === "START_BREAK" ? <Coffee size={17} /> :
                   event.action === "END_DAY" ? <ArrowDownToLine size={17} /> :
                   <CheckCircle2 size={17} />}
                </div>
                <div className="history-description">
                  <strong>{ACTION_LABELS[event.action] || event.action}</strong>
                  <span>{new Date(event.timestamp).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                </div>
                <time>{formatClock(event.timestamp)}</time>
                <div className="history-actions">
                  <button className="icon-btn" title="Edit punch time" onClick={() => openEditModal(event)} disabled={busy}>
                    <Edit2 size={13} />
                  </button>
                  <button className="icon-btn danger" title="Delete punch" onClick={() => deletePunch(event)} disabled={busy}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
        </div>
      </section>

      {/* Edit Punch Time Modal */}
      {editingEvent && (
        <div className="modal-overlay" onClick={() => !busy && setEditingEvent(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="modal-header">
              <h3>Edit Punch Time</h3>
              <button className="modal-close" onClick={() => setEditingEvent(null)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <p className="modal-desc">
                Adjusting timestamp for <strong>{ACTION_LABELS[editingEvent.action] || editingEvent.action}</strong>.
              </p>
              <div className="modal-field">
                <label htmlFor="edit-punch-time">Corrected punch time:</label>
                <input
                  id="edit-punch-time"
                  type="time"
                  className="time-input"
                  value={editTimeInput}
                  onChange={(e) => setEditTimeInput(e.target.value)}
                />
              </div>
              <div className="chip-group">
                <button type="button" className="chip-btn" onClick={() => setEditTimeInput(applyOffsetToTime(editTimeInput, -30))}>-30m</button>
                <button type="button" className="chip-btn" onClick={() => setEditTimeInput(applyOffsetToTime(editTimeInput, -15))}>-15m</button>
                <button type="button" className="chip-btn" onClick={() => setEditTimeInput(applyOffsetToTime(editTimeInput, +15))}>+15m</button>
                <button type="button" className="chip-btn" onClick={() => setEditTimeInput(applyOffsetToTime(editTimeInput, +30))}>+30m</button>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setEditingEvent(null)} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={saveEditPunch} disabled={busy || !editTimeInput}>
                {busy ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Missed Punch Modal */}
      {isAddModalOpen && (
        <div className="modal-overlay" onClick={() => !busy && setIsAddModalOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="modal-header">
              <h3>Add Missed Punch</h3>
              <button className="modal-close" onClick={() => setIsAddModalOpen(false)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <p className="modal-desc">Add a punch record for today that you forgot to log.</p>
              <div className="modal-field">
                <label htmlFor="manual-action">Punch Action:</label>
                <select
                  id="manual-action"
                  className="select-input"
                  value={manualActionInput}
                  onChange={(e) => setManualActionInput(e.target.value)}
                >
                  <option value="START_WORK">Work started (Punch In)</option>
                  <option value="START_BREAK">Break started</option>
                  <option value="RESUME_WORK">Work resumed (Break Ended)</option>
                  <option value="END_DAY">Day completed (Punch Out)</option>
                </select>
              </div>
              <div className="modal-field">
                <label htmlFor="manual-time">Punch Time:</label>
                <input
                  id="manual-time"
                  type="time"
                  className="time-input"
                  value={manualTimeInput}
                  onChange={(e) => setManualTimeInput(e.target.value)}
                />
              </div>
              <div className="chip-group">
                <button type="button" className="chip-btn" onClick={() => setManualTimeInput(getLocalTimeString())}>Now</button>
                <button type="button" className="chip-btn" onClick={() => setManualTimeInput(applyOffsetToTime(manualTimeInput, -15))}>-15m</button>
                <button type="button" className="chip-btn" onClick={() => setManualTimeInput(applyOffsetToTime(manualTimeInput, -30))}>-30m</button>
                <button type="button" className="chip-btn" onClick={() => setManualTimeInput(applyOffsetToTime(manualTimeInput, -60))}>-1h</button>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setIsAddModalOpen(false)} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={addManualPunch} disabled={busy || !manualTimeInput}>
                {busy ? "Adding…" : "Add Punch"}
              </button>
            </div>
          </div>
        </div>
      )}

      <footer>
        <span>OfficeTime <span className="footer-dot">·</span> Personal use</span>
        <span>8h work target <span className="footer-dot">·</span> 1h break allowance</span>
      </footer>
    </main>
  );
}
