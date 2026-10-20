import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine, ArrowUpFromLine, Coffee, Clock3, CalendarDays,
  CheckCircle2, CircleAlert, RefreshCw, Timer, Utensils, Wifi, WifiOff,
  Edit2, Trash2, Plus, X, Clock, Zap, Sun, Moon, Sparkles,
  BarChart3
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

function formatDuration(seconds = 0, alwaysShowSeconds = true) {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) {
    if (alwaysShowSeconds) {
      return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
    }
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }
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

const RANDOM_DIGITS = "0123456789";

function AirportBoardTimer({ seconds = 0, shuffleKey = 0, onShuffle }) {
  const safe = Math.max(0, Math.floor(seconds));
  const targetH = String(Math.floor(safe / 3600)).padStart(2, "0");
  const targetM = String(Math.floor((safe % 3600) / 60)).padStart(2, "0");
  const targetS = String(safe % 60).padStart(2, "0");
  const targetDigits = [targetH[0], targetH[1], targetM[0], targetM[1], targetS[0], targetS[1]];

  const [displayDigits, setDisplayDigits] = useState(targetDigits);
  const [flippingFlags, setFlippingFlags] = useState([false, false, false, false, false, false]);

  const targetRef = useRef(targetDigits);
  targetRef.current = targetDigits;

  const isShufflingRef = useRef(true);
  const lockedSlotsRef = useRef([false, false, false, false, false, false]);

  // Airport split-flap board shuffle animation when app opens or refresh is triggered
  useEffect(() => {
    isShufflingRef.current = true;
    lockedSlotsRef.current = [false, false, false, false, false, false];

    const lockDelays = [320, 500, 720, 940, 1180, 1400];
    const timeouts = [];

    // Rolling animation for unlocked slots
    const rollInterval = setInterval(() => {
      setDisplayDigits((prev) =>
        prev.map((val, idx) => {
          if (lockedSlotsRef.current[idx]) {
            return targetRef.current[idx];
          }
          return RANDOM_DIGITS[Math.floor(Math.random() * RANDOM_DIGITS.length)];
        })
      );
      setFlippingFlags((prev) => prev.map((_, idx) => !lockedSlotsRef.current[idx]));
    }, 45);

    // Staggered settling per digit slot
    lockDelays.forEach((delay, idx) => {
      const t = setTimeout(() => {
        lockedSlotsRef.current[idx] = true;
        setDisplayDigits((prev) => {
          const next = [...prev];
          next[idx] = targetRef.current[idx];
          return next;
        });
        // Settle flip
        setFlippingFlags((prev) => {
          const next = [...prev];
          next[idx] = true;
          return next;
        });
        setTimeout(() => {
          setFlippingFlags((prev) => {
            const next = [...prev];
            next[idx] = false;
            return next;
          });
        }, 110);

        if (idx === lockDelays.length - 1) {
          isShufflingRef.current = false;
          clearInterval(rollInterval);
        }
      }, delay);
      timeouts.push(t);
    });

    return () => {
      clearInterval(rollInterval);
      timeouts.forEach(clearTimeout);
    };
  }, [shuffleKey]);

  // Live ticking flips once the board is loaded
  const prevDigitsRef = useRef(targetDigits);
  useEffect(() => {
    if (isShufflingRef.current) return;

    setDisplayDigits(targetDigits);

    const changed = targetDigits.map((val, idx) => val !== prevDigitsRef.current[idx]);
    prevDigitsRef.current = targetDigits;

    if (changed.some(Boolean)) {
      setFlippingFlags((prev) => prev.map((_, idx) => changed[idx]));
      const t = setTimeout(() => {
        setFlippingFlags([false, false, false, false, false, false]);
      }, 140);
      return () => clearTimeout(t);
    }
  }, [targetH, targetM, targetS]);

  return (
    <div
      className="flap-display"
      role="timer"
      aria-label={`Actual work time: ${targetH} hours ${targetM} minutes ${targetS} seconds`}
      onClick={onShuffle}
      title="Click to replay split-flap animation"
    >
      {/* Hours */}
      <div className="flap-group">
        <div className={`flap-tile ${flippingFlags[0] ? "flipping" : ""}`}>
          <span className="flap-char">{displayDigits[0]}</span>
        </div>
        <div className={`flap-tile ${flippingFlags[1] ? "flipping" : ""}`}>
          <span className="flap-char">{displayDigits[1]}</span>
        </div>
        <span className="flap-unit">h</span>
      </div>

      {/* Minutes */}
      <div className="flap-group">
        <div className={`flap-tile ${flippingFlags[2] ? "flipping" : ""}`}>
          <span className="flap-char">{displayDigits[2]}</span>
        </div>
        <div className={`flap-tile ${flippingFlags[3] ? "flipping" : ""}`}>
          <span className="flap-char">{displayDigits[3]}</span>
        </div>
        <span className="flap-unit">m</span>
      </div>

      {/* Seconds */}
      <div className="flap-group">
        <div className={`flap-tile ${flippingFlags[4] ? "flipping" : ""}`}>
          <span className="flap-char">{displayDigits[4]}</span>
        </div>
        <div className={`flap-tile ${flippingFlags[5] ? "flipping" : ""}`}>
          <span className="flap-char">{displayDigits[5]}</span>
        </div>
        <span className="flap-unit">s</span>
      </div>
    </div>
  );
}


function ShiftAnalyticsDashboard({ history = [], currentSeconds = 0 }) {
  const [selectedDay, setSelectedDay] = useState(null);

  const daysData = useMemo(() => {
    const list = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = todayKey(d);
      const isToday = i === 0;

      const match = (history || []).find((h) => h.date === key);
      let workSec = 0;
      let breakSec = 0;
      let status = "NO_DATA";

      if (isToday) {
        workSec = currentSeconds;
        status = "TODAY";
      } else if (match) {
        workSec = match.workSeconds || 0;
        breakSec = match.breakSeconds || 0;
        status = match.status || "COMPLETED";
      }

      const hours = Math.round((workSec / 3600) * 10) / 10;
      const dayName = isToday ? "Today" : d.toLocaleDateString([], { weekday: "short" });
      const dateFormatted = d.toLocaleDateString([], { month: "short", day: "numeric" });
      const hitTarget = workSec >= 8 * 3600;

      list.push({
        dateKey: key,
        dayName,
        dateFormatted,
        isToday,
        workSec,
        breakSec,
        hours,
        status,
        hitTarget
      });
    }
    return list;
  }, [history, currentSeconds]);

  // Summary calculations
  const totalWorkedSeconds = daysData.reduce((acc, d) => acc + d.workSec, 0);
  const totalHours = Math.round((totalWorkedSeconds / 3600) * 10) / 10;
  const activeDaysCount = daysData.filter((d) => d.workSec > 0).length || 1;
  const avgHours = Math.round((totalWorkedSeconds / activeDaysCount / 3600) * 10) / 10;
  const targetDaysCount = daysData.filter((d) => d.hitTarget).length;

  return (
    <section className="analytics-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">WORK LOG TRENDS</p>
          <h2>Shift analytics</h2>
        </div>
        <span className="analytics-pill">Last 7 Days</span>
      </div>

      <div className="analytics-card">
        {/* KPI metrics row */}
        <div className="analytics-kpis">
          <div className="kpi-item">
            <span className="kpi-label">7-DAY TOTAL</span>
            <div className="kpi-value">{totalHours} <small>hrs</small></div>
            <span className="kpi-sub">Across logged shifts</span>
          </div>
          <div className="kpi-item">
            <span className="kpi-label">DAILY AVERAGE</span>
            <div className="kpi-value">{avgHours} <small>hrs/day</small></div>
            <span className="kpi-sub">{avgHours >= 8 ? "✓ Meeting 8h goal" : "Under 8h target"}</span>
          </div>
          <div className="kpi-item">
            <span className="kpi-label">TARGET HIT RATE</span>
            <div className="kpi-value">{targetDaysCount} <small>/ 7 days</small></div>
            <span className="kpi-sub">{Math.round((targetDaysCount / 7) * 100)}% consistency</span>
          </div>
        </div>

        {/* 7-Day Neo-Brutalist Bar Chart */}
        <div className="chart-container">
          <div className="chart-header">
            <div className="chart-legend">
              <span className="legend-item"><span className="legend-swatch hit" /> ≥ 8h Target</span>
              <span className="legend-item"><span className="legend-swatch in-progress" /> &lt; 8h</span>
            </div>
            <span className="chart-goal-label">--- 8H GOAL ---</span>
          </div>

          <div className="chart-plot-area">
            {/* 8-Hour Dashed Target Line */}
            <div className="chart-target-line" style={{ bottom: "80%" }}>
              <span className="target-tag">8h</span>
            </div>

            {/* Bars */}
            <div className="chart-bars-row">
              {daysData.map((d) => {
                // Max height scale is 10 hours = 100%
                const barHeightPercent = Math.min(100, Math.max(d.hours > 0 ? 8 : 4, (d.hours / 10) * 100));
                const isSelected = selectedDay && selectedDay.dateKey === d.dateKey;

                return (
                  <div
                    key={d.dateKey}
                    className={`chart-bar-col ${d.isToday ? "is-today" : ""} ${isSelected ? "selected" : ""}`}
                    onClick={() => setSelectedDay(isSelected ? null : d)}
                  >
                    <div className="bar-value-pill">
                      {d.hours > 0 ? `${d.hours}h` : "—"}
                    </div>
                    <div className="bar-track">
                      <div
                        className={`bar-fill ${d.hitTarget ? "hit" : d.hours > 0 ? "partial" : "empty"}`}
                        style={{ height: `${barHeightPercent}%` }}
                      />
                    </div>
                    <div className="bar-label-group">
                      <strong className="bar-day-name">{d.dayName}</strong>
                      <small className="bar-date-num">{d.dateFormatted.split(" ")[1]}</small>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Interactive Inspection Details for tapped bar */}
          {selectedDay && (
            <div className="chart-detail-box">
              <div className="detail-date">
                <strong>{selectedDay.dayName}, {selectedDay.dateFormatted}</strong>
                <span className={`detail-status ${selectedDay.hitTarget ? "hit" : ""}`}>
                  {selectedDay.hitTarget ? "Target Reached (≥8h)" : selectedDay.hours > 0 ? "Under Target" : "No Shift Recorded"}
                </span>
              </div>
              <div className="detail-stats">
                <span>Actual Work: <b>{formatDuration(selectedDay.workSec)}</b></span>
                <span>Break Taken: <b>{formatDuration(selectedDay.breakSec)}</b></span>
              </div>
            </div>
          )}
        </div>

        {/* Recent Shifts Mini Table */}
        <div className="recent-shifts-wrap">
          <div className="recent-shifts-header">
            <h4>Recent recorded shifts</h4>
            <span className="recent-count">Auto-synced from Google Sheets</span>
          </div>
          <div className="recent-shifts-list">
            {daysData.filter((d) => d.workSec > 0).map((d) => (
              <div className="shift-row" key={`recent-${d.dateKey}`}>
                <div className="shift-row-date">
                  <strong>{d.dayName}</strong>
                  <span>{d.dateFormatted}</span>
                </div>
                <div className="shift-row-bar">
                  <div className="shift-mini-track">
                    <div
                      className={`shift-mini-fill ${d.hitTarget ? "hit" : ""}`}
                      style={{ width: `${Math.min(100, (d.workSec / (8 * 3600)) * 100)}%` }}
                    />
                  </div>
                  <span className="shift-hours-text">{formatDuration(d.workSec)}</span>
                </div>
                <div className="shift-row-badge">
                  {d.hitTarget ? (
                    <span className="badge-hit">8h+ Goal Met</span>
                  ) : (
                    <span className="badge-partial">{formatDuration(d.breakSec)} break</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const [accessCode, setAccessCode] = useState(() => sessionStorage.getItem("shiftly_access") || sessionStorage.getItem("officetime_access") || "");
  const [codeInput, setCodeInput] = useState("");
  const [authenticated, setAuthenticated] = useState(() => Boolean(sessionStorage.getItem("shiftly_access") || sessionStorage.getItem("officetime_access")));
  const [events, setEvents] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());
  const [connected, setConnected] = useState(false);
  const [shuffleKey, setShuffleKey] = useState(0);
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("shiftly_theme") || "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("shiftly_theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

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
    if (!quiet) {
      setLoading(true);
      setShuffleKey((k) => k + 1);
    }
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
    if (authenticated && accessCode) {
      refresh();

      // 1. Live second ticking timer
      const clock = window.setInterval(() => setNow(Date.now()), 1000);

      // 2. Real-time background sync every 10 seconds so mobile & laptop stay synchronized
      const pollTimer = window.setInterval(() => {
        refresh(true); // silent background fetch
      }, 10000);

      // 3. Instant sync whenever switching back to tab, window, or unlocking device
      const handleVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          refresh(true);
        }
      };
      const handleFocus = () => {
        refresh(true);
      };

      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("focus", handleFocus);

      return () => {
        window.clearInterval(clock);
        window.clearInterval(pollTimer);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        window.removeEventListener("focus", handleFocus);
      };
    } else {
      setLoading(false);
    }
  }, [refresh, authenticated, accessCode]);

  const summary = useMemo(() => summarize(events, now), [events, now]);
  const workRemaining = Math.max(0, TARGET_SECONDS - summary.workSeconds);
  const breakRemaining = Math.max(0, BREAK_ALLOWANCE_SECONDS - summary.breakSeconds);
  const breakOver = Math.max(0, summary.breakSeconds - BREAK_ALLOWANCE_SECONDS);
  const progress = Math.min(100, (summary.workSeconds / TARGET_SECONDS) * 100);

  // Planned finish includes 8h work + at least 1h (60 min) break allowance.
  // If break exceeded 60 minutes, finish time extends by the extra minutes!
  const effectiveBreakSeconds = Math.max(BREAK_ALLOWANCE_SECONDS, summary.breakSeconds);
  const extraBreakSeconds = Math.max(0, summary.breakSeconds - BREAK_ALLOWANCE_SECONDS);
  const extraBreakMinutes = Math.round(extraBreakSeconds / 60);

  const estimatedEnd = useMemo(() => {
    if (!summary.firstPunch || summary.status === "COMPLETED") return null;
    const start = new Date(summary.firstPunch).getTime();
    return new Date(start + TARGET_SECONDS * 1000 + effectiveBreakSeconds * 1000);
  }, [summary.firstPunch, effectiveBreakSeconds, summary.status]);

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
      sessionStorage.setItem("shiftly_access", codeInput);
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
    sessionStorage.removeItem("shiftly_access");
    sessionStorage.removeItem("officetime_access");
    setAccessCode("");
    setAuthenticated(false);
    setEvents([]);
    setHistory([]);
    setConnected(false);
  }

  async function punch(action, customTimestamp = null) {
    // Instant Optimistic Update (0ms latency feel)
    const eventTimeIso = customTimestamp || new Date().toISOString();
    const tempSessionId = "temp-" + Date.now();
    const optimisticEvent = {
      action,
      timestamp: eventTimeIso,
      date: todayKey(new Date(eventTimeIso)),
      sessionId: tempSessionId
    };
    const prevEvents = [...events];
    setEvents(prev => [...prev, optimisticEvent].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));
    setNotice(ACTION_LABELS[action] || "Saved.");
    setIsCustomTimeOpen(false);
    setCustomTime(getLocalTimeString());

    setBusy(true);
    setError("");
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
    } catch (e) {
      // Revert optimistic update if request fails
      setEvents(prevEvents);
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
    const newIso = timeStringToIso(editTimeInput, editingEvent.timestamp);
    const prevEvents = [...events];

    // Optimistic update
    setEvents(prev => prev.map(ev => {
      if ((editingEvent.sessionId && ev.sessionId === editingEvent.sessionId) || ev.timestamp === editingEvent.timestamp) {
        return { ...ev, timestamp: newIso, date: todayKey(new Date(newIso)) };
      }
      return ev;
    }).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));

    setEditingEvent(null);
    setBusy(true);
    setError("");
    setNotice("");
    try {
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
    } catch (e) {
      setEvents(prevEvents);
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

    const prevEvents = [...events];
    // Optimistic delete
    setEvents(prev => prev.filter(ev => {
      if (eventToDelete.sessionId && ev.sessionId === eventToDelete.sessionId) return false;
      return ev.timestamp !== eventToDelete.timestamp;
    }));

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
      setEvents(prevEvents);
      setError(e.message || "Could not delete punch.");
    } finally {
      setBusy(false);
    }
  }

  async function addManualPunch() {
    if (!manualTimeInput) return;
    const newIso = timeStringToIso(manualTimeInput);
    const prevEvents = [...events];

    // Optimistic insert
    const tempSessionId = "manual-" + Date.now();
    const optimisticEvent = {
      action: manualActionInput,
      timestamp: newIso,
      date: todayKey(new Date(newIso)),
      sessionId: tempSessionId
    };
    setEvents(prev => [...prev, optimisticEvent].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));
    setIsAddModalOpen(false);

    setBusy(true);
    setError("");
    setNotice("");
    try {
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
    } catch (e) {
      setEvents(prevEvents);
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
          <a className="brand" href="/" aria-label="Shiftly home">
            <span className="brand-mark"><Zap size={18} /></span>
            <span>Shift<span className="brand-accent">ly</span></span>
          </a>
          <div className="topbar-right">
            <button
              type="button"
              className="theme-toggle-btn"
              onClick={toggleTheme}
              title={`Switch to ${theme === "light" ? "Dark" : "Light"} Neo-Brutalist mode`}
            >
              {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
              <span>{theme === "light" ? "DARK" : "LIGHT"}</span>
            </button>
            <div className="connection offline"><WifiOff size={14} /><span>Private</span></div>
          </div>
        </header>
        <section className="auth-card">
          <div className="brand-mark auth-mark"><Zap size={24} /></div>
          <p className="eyebrow">SMART WORKDAY & SHIFT TRACKER</p>
          <h1>Welcome <span>back.</span></h1>
          <p className="auth-copy">Enter your access code to open your Shiftly dashboard.</p>
          {error && <div className="alert error"><CircleAlert size={18} /><span>{error}</span></div>}
          <form onSubmit={login} className="auth-form">
            <label htmlFor="access-code">Access code</label>
            <input id="access-code" type="password" autoComplete="current-password" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="Enter your access code" required />
            <button className="action-button primary auth-submit" type="submit" disabled={busy || !codeInput.trim()}><span><strong>{busy ? "Checking…" : "Unlock dashboard"}</strong><small>Your code is checked securely on the server</small></span><span className="action-arrow">↗</span></button>
          </form>
          <p className="helper-note">Set APP_ACCESS_CODE in your Vercel environment variables before using the deployed app.</p>
        </section>
        <footer><span>Shiftly · Neo-Brutalist Attendance</span><span>Private access</span></footer>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Shiftly home">
          <span className="brand-mark"><Zap size={18} /></span>
          <span>Shift<span className="brand-accent">ly</span></span>
        </a>
        <div className="topbar-right">
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={toggleTheme}
            title={`Switch to ${theme === "light" ? "Dark" : "Light"} Neo-Brutalist mode`}
          >
            {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
            <span>{theme === "light" ? "DARK" : "LIGHT"}</span>
          </button>
          <div className={`connection ${connected ? "online" : "offline"}`}>
            {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span>{connected ? "Syncing Live" : "Offline"}</span>
          </div>
          <button className="logout-button" onClick={logout}>Lock</button>
        </div>
      </header>

      <section className="intro">
        <div>
          <div className="eyebrow-badge">
            <Sparkles size={13} />
            <span>SMART SHIFT TRACKER</span>
          </div>
          <h1>Master your workday,<br /><span>shift by shift.</span></h1>
          <p className="date-line"><CalendarDays size={15} /> {formatDate()}</p>
        </div>
        <div className="status-pill">
          <span className={`status-dot ${summary.status.toLowerCase()}`} />
          <span className="status-pill-text">{statusCopy[0]}</span>
        </div>
      </section>

      {error && <div className="alert error"><CircleAlert size={18} /><span>{error}</span><button className="text-button" onClick={() => refresh()}>Retry</button></div>}
      {notice && !error && <div className="alert success"><CheckCircle2 size={18} /><span>{notice}</span></div>}

      <section className="hero-card">
        <div className="hero-head">
          <div className="hero-head-left">
            <p className="muted-label">ACTUAL WORK TIME</p>
            <AirportBoardTimer
              seconds={summary.workSeconds}
              shuffleKey={shuffleKey}
              onShuffle={() => setShuffleKey((k) => k + 1)}
            />
            <p className="target-line">Daily target: <strong>8 hours</strong> required</p>
          </div>
          <div className="hero-icon" title="Split-flap live flight board"><Timer size={27} /></div>
        </div>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
        <div className="progress-caption"><span>{Math.round(progress)}% complete</span><span>{workRemaining > 0 ? `${formatDuration(workRemaining)} to go` : "Target reached"}</span></div>
        <div className="hero-divider" />
        <div className="hero-bottom">
          <div>
            <span className="small-label">Punched in</span>
            <strong>{formatClock(summary.firstPunch)}</strong>
          </div>
          <div>
            <span className="small-label">Estimated finish</span>
            <div className="finish-time-row">
              <strong>{estimatedEnd ? estimatedEnd.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}</strong>
              {extraBreakMinutes > 0 && (
                <span className="extra-break-badge">+{extraBreakMinutes}m</span>
              )}
            </div>
            <span className="finish-subtext">
              {extraBreakMinutes > 0 ? (
                <span className="text-danger">+{extraBreakMinutes}m extra break taken</span>
              ) : (
                <span>Includes 1h planned break</span>
              )}
            </span>
          </div>
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
            <button className="action-button action-start-work" disabled={busy || loading} onClick={() => punch("START_WORK", isCustomTimeOpen && customTime ? timeStringToIso(customTime) : null)}>
              <span className="action-icon"><ArrowDownToLine size={21} /></span>
              <span>
                <strong>{customTimeFormatted ? `Start Work (${customTimeFormatted})` : "Start Work"}</strong>
                <small>{customTimeFormatted ? `Record punch-in set at ${customTimeFormatted}` : "Record your first punch-in"}</small>
              </span>
              <span className="action-arrow">↗</span>
            </button>
          )}
          {summary.status === "WORKING" && (
            <button className="action-button action-start-break" disabled={busy || loading} onClick={() => punch("START_BREAK", isCustomTimeOpen && customTime ? timeStringToIso(customTime) : null)}>
              <span className="action-icon"><Coffee size={21} /></span>
              <span>
                <strong>{customTimeFormatted ? `Start Break (${customTimeFormatted})` : "Start Break"}</strong>
                <small>{customTimeFormatted ? `Pause timer set at ${customTimeFormatted}` : "Pause your work timer"}</small>
              </span>
              <span className="action-arrow">↗</span>
            </button>
          )}
          {summary.status === "ON_BREAK" && (
            <button className="action-button action-resume-work" disabled={busy || loading} onClick={() => punch("RESUME_WORK", isCustomTimeOpen && customTime ? timeStringToIso(customTime) : null)}>
              <span className="action-icon"><ArrowUpFromLine size={21} /></span>
              <span>
                <strong>{customTimeFormatted ? `Resume Work (${customTimeFormatted})` : "Resume Work"}</strong>
                <small>{customTimeFormatted ? `End break set at ${customTimeFormatted}` : "End your current break"}</small>
              </span>
              <span className="action-arrow">↗</span>
            </button>
          )}
          {(summary.status === "WORKING" || summary.status === "ON_BREAK") && (
            <button className="action-button action-end-day" disabled={busy || loading} onClick={() => {
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

      <ShiftAnalyticsDashboard history={history} currentSeconds={summary.workSeconds} />

      <footer>
        <span>Shiftly <span className="footer-dot">·</span> Smart Workday Tracker</span>
        <span>8h target <span className="footer-dot">·</span> 1h break allowance</span>
      </footer>
    </main>
  );
}
