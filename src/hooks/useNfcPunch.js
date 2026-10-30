import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Derives the punch action from current dashboard status and first punch timestamp:
 * - no entry ("NOT_STARTED" / null) or COMPLETED -> START_WORK
 * - WORKING, within 15 min of today's target finish (first punch + 9h) -> END_DAY
 * - WORKING otherwise -> START_BREAK
 * - ON_BREAK -> RESUME_WORK
 *
 * @param {string|null} status - Current dashboard status ("NOT_STARTED", "WORKING", "ON_BREAK", "COMPLETED")
 * @param {string|null} firstPunch - ISO timestamp of first punch today
 * @param {number} [nowMs=Date.now()] - Current epoch timestamp in milliseconds
 * @returns {"START_WORK" | "START_BREAK" | "RESUME_WORK" | "END_DAY"}
 */
export function deriveNfcPunchAction(status, firstPunch, nowMs = Date.now()) {
  if (!status || status === "NOT_STARTED" || status === "COMPLETED") {
    return "START_WORK";
  }

  if (status === "ON_BREAK") {
    return "RESUME_WORK";
  }

  if (status === "WORKING") {
    if (firstPunch) {
      const firstPunchMs = new Date(firstPunch).getTime();
      if (Number.isFinite(firstPunchMs)) {
        // Target finish is first punch + 9 hours
        const targetFinishMs = firstPunchMs + 9 * 60 * 60 * 1000;
        // Within 15 min of target finish (15 min prior onwards)
        if (targetFinishMs - nowMs <= 15 * 60 * 1000) {
          return "END_DAY";
        }
      }
    }
    return "START_BREAK";
  }

  return "START_WORK";
}

/**
 * Derives the dual IN and OUT punch actions for the 10-second buffer:
 * - OUT action auto-submits after 10 seconds of scanning
 * - IN action submits if confirmed (or card re-scanned) before 10 seconds
 *
 * @param {string|null} status
 * @param {string|null} firstPunch
 * @param {number} [nowMs=Date.now()]
 * @returns {{ inAction: string, outAction: string }}
 */
export function deriveNfcInOutActions(status, firstPunch, nowMs = Date.now()) {
  let inAction = "START_WORK";
  let outAction = "END_DAY";

  if (!status || status === "NOT_STARTED" || status === "COMPLETED") {
    inAction = "START_WORK";
    outAction = "END_DAY";
  } else if (status === "ON_BREAK") {
    inAction = "RESUME_WORK";
    outAction = "END_DAY";
  } else if (status === "WORKING") {
    inAction = "START_WORK";
    if (firstPunch) {
      const firstPunchMs = new Date(firstPunch).getTime();
      if (Number.isFinite(firstPunchMs)) {
        const targetFinishMs = firstPunchMs + 9 * 60 * 60 * 1000;
        if (targetFinishMs - nowMs <= 15 * 60 * 1000) {
          outAction = "END_DAY";
        } else {
          outAction = "START_BREAK";
        }
      } else {
        outAction = "START_BREAK";
      }
    } else {
      outAction = "START_BREAK";
    }
  }

  return { inAction, outAction };
}

/**
 * Validates a scanned tag serialNumber against authorized tag ID from VITE_AUTHORIZED_TAG_ID.
 * Handles hex case-insensitivity and colon/hyphen separators.
 *
 * @param {string|null} scannedSerial
 * @param {string|null} authorizedTagId
 * @returns {boolean}
 */
export function isTagAuthorized(scannedSerial, authorizedTagId = import.meta.env.VITE_AUTHORIZED_TAG_ID) {
  if (!scannedSerial || !authorizedTagId) return false;
  const s = String(scannedSerial).trim().toLowerCase();
  const a = String(authorizedTagId).trim().toLowerCase();
  if (s === a) return true;

  const normS = s.replace(/[^a-f0-9]/g, "");
  const normA = a.replace(/[^a-f0-9]/g, "");
  return normS.length > 0 && normS === normA;
}

/**
 * Triggers device vibration pattern safely across browsers.
 */
function triggerVibrate(pattern = [200, 100, 200]) {
  if (typeof window !== "undefined" && "navigator" in window && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(pattern);
    } catch (e) {}
  }
}

/**
 * React hook for native browser Web NFC (NDEFReader) tap-to-punch support.
 *
 * Features:
 * - Checks 'NDEFReader' in window on mount; no-op if unsupported (graceful degradation).
 * - Starts/stops ndef.scan(), listens via ndef.onreading.
 * - Validates event.serialNumber against VITE_AUTHORIZED_TAG_ID.
 * - 10-Second Buffer:
 *     - Scanning starts a 10s countdown buffer.
 *     - If left alone, it auto-submits Punch OUT (END_DAY / START_BREAK) after 10 seconds.
 *     - If user taps "Punch IN" or taps the card again within 10 seconds, it cancels OUT and immediately submits Punch IN (START_WORK / RESUME_WORK).
 *     - User can also tap "Cancel" to abort.
 * - Calls navigator.vibrate() on scan/confirm.
 * - Distinct "Unrecognized tag" toast if unauthorized, with no action taken.
 */
export function useNfcPunch({
  status,
  firstPunch,
  punch,
  onPunch,
  setNotice,
  onNotice,
  setError,
  onError,
  busy = false
} = {}) {
  const handlePunch = punch || onPunch;
  const handleNotice = setNotice || onNotice;
  const handleError = setError || onError;

  const [isSupported, setIsSupported] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [pendingPunch, setPendingPunch] = useState(null); // { outAction, inAction, secondsLeft }

  const statusRef = useRef(status);
  const firstPunchRef = useRef(firstPunch);
  const handlePunchRef = useRef(handlePunch);
  const handleNoticeRef = useRef(handleNotice);
  const handleErrorRef = useRef(handleError);
  const busyRef = useRef(busy);
  const pendingPunchRef = useRef(null);

  useEffect(() => {
    statusRef.current = status;
    firstPunchRef.current = firstPunch;
    handlePunchRef.current = handlePunch;
    handleNoticeRef.current = handleNotice;
    handleErrorRef.current = handleError;
    busyRef.current = busy;
  });

  useEffect(() => {
    pendingPunchRef.current = pendingPunch;
  }, [pendingPunch]);

  const activeAbortControllerRef = useRef(null);
  const isProcessingRef = useRef(false);
  const pendingTimeoutRef = useRef(null);
  const countdownIntervalRef = useRef(null);

  const stopScan = useCallback(() => {
    if (activeAbortControllerRef.current) {
      try {
        activeAbortControllerRef.current.abort();
      } catch (e) {}
      activeAbortControllerRef.current = null;
    }
    setIsScanning(false);
  }, []);

  const cancelPendingPunch = useCallback(() => {
    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setPendingPunch(null);
    isProcessingRef.current = false;
    triggerVibrate([100]);
    if (handleNoticeRef.current) {
      handleNoticeRef.current("Punch cancelled.");
    }
  }, []);

  const confirmPunchIn = useCallback(() => {
    const currentPending = pendingPunchRef.current;
    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setPendingPunch(null);
    isProcessingRef.current = false;
    triggerVibrate([120, 60, 120]);

    const inAction =
      currentPending?.inAction || (statusRef.current === "ON_BREAK" ? "RESUME_WORK" : "START_WORK");

    if (handleNoticeRef.current) {
      handleNoticeRef.current(`Punch IN confirmed (${inAction})`);
    }
    if (handlePunchRef.current) {
      handlePunchRef.current(inAction);
    }
  }, []);

  const confirmPunchOut = useCallback(() => {
    const currentPending = pendingPunchRef.current;
    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setPendingPunch(null);
    isProcessingRef.current = false;
    triggerVibrate([200, 100, 200]);

    const outAction = currentPending?.outAction || "END_DAY";

    if (handleNoticeRef.current) {
      handleNoticeRef.current(`Punch OUT confirmed (${outAction})`);
    }
    if (handlePunchRef.current) {
      handlePunchRef.current(outAction);
    }
  }, []);

  const start10SecBuffer = useCallback((outAction, inAction) => {
    if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

    let seconds = 10;
    setPendingPunch({ outAction, inAction, secondsLeft: seconds });

    if (handleNoticeRef.current) {
      handleNoticeRef.current(`Card scanned: Punching OUT in 10s... (Tap card again or select Punch IN before 10s)`);
    }

    countdownIntervalRef.current = setInterval(() => {
      seconds -= 1;
      if (seconds > 0) {
        setPendingPunch({ outAction, inAction, secondsLeft: seconds });
      } else {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
      }
    }, 1000);

    pendingTimeoutRef.current = setTimeout(() => {
      setPendingPunch(null);
      pendingTimeoutRef.current = null;
      isProcessingRef.current = false;
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }

      triggerVibrate([200, 100, 200]);
      if (handleNoticeRef.current) {
        handleNoticeRef.current(`Auto-submitted: ${outAction} (Punch OUT after 10s)`);
      }
      if (handlePunchRef.current) {
        handlePunchRef.current(outAction);
      }
    }, 10000);
  }, []);

  const handleReading = useCallback(
    (event) => {
      const serialNumber = event?.serialNumber || "";
      const authorizedTagId = import.meta.env.VITE_AUTHORIZED_TAG_ID;

      console.log(
        "[Shiftly Web NFC] Scanned serialNumber:",
        serialNumber,
        "| Configured authorized tag:",
        authorizedTagId
      );

      // Validate tag serialNumber against authorized tag ID
      if (!isTagAuthorized(serialNumber, authorizedTagId)) {
        triggerVibrate([80, 80, 80, 80]);
        if (handleErrorRef.current) {
          handleErrorRef.current(`Unrecognized tag (${serialNumber || "no serial"}). Punch ignored.`);
        }
        return;
      }

      // If already counting down inside the 10-second buffer:
      // Tapping the card again before 10s triggers Punch IN!
      if (pendingPunchRef.current) {
        console.log("[Shiftly Web NFC] Card scanned again before 10s -> Executing Punch IN!");
        confirmPunchIn();
        return;
      }

      if (isProcessingRef.current || busyRef.current) {
        return;
      }

      // Tag is authorized - trigger tactile success vibration
      triggerVibrate([150, 50, 150]);

      // Derive IN and OUT actions based on dashboard status
      const { inAction, outAction } = deriveNfcInOutActions(
        statusRef.current,
        firstPunchRef.current,
        Date.now()
      );

      // Start 10-second countdown buffer
      start10SecBuffer(outAction, inAction);
    },
    [confirmPunchIn, start10SecBuffer]
  );

  const handleReadingRef = useRef(handleReading);
  useEffect(() => {
    handleReadingRef.current = handleReading;
  });

  const startScan = useCallback(async () => {
    if (typeof window === "undefined" || !("NDEFReader" in window)) {
      return;
    }

    try {
      if (activeAbortControllerRef.current) {
        try {
          activeAbortControllerRef.current.abort();
        } catch (e) {}
      }
      const abortController = new AbortController();
      activeAbortControllerRef.current = abortController;

      const ndef = new window.NDEFReader();
      await ndef.scan({ signal: abortController.signal });
      setIsScanning(true);

      ndef.onreading = (event) => {
        if (handleReadingRef.current) {
          handleReadingRef.current(event);
        }
      };

      ndef.onreadingerror = () => {
        triggerVibrate([100, 50, 100]);
        if (handleErrorRef.current) {
          handleErrorRef.current("NFC tag read failed. Please hold tag steady against device.");
        }
      };

      triggerVibrate([80]);
      if (handleNoticeRef.current) {
        handleNoticeRef.current("NFC reader active. Bring authorized tag near phone.");
      }
    } catch (err) {
      setIsScanning(false);
      if (err.name === "AbortError") return;
      if (err.name === "NotAllowedError") {
        if (handleErrorRef.current) {
          handleErrorRef.current("NFC permission was denied. Please allow NFC access.");
        }
      } else if (err.name === "NotSupportedError") {
        if (handleErrorRef.current) {
          handleErrorRef.current("NFC is not supported or disabled in device settings.");
        }
      } else {
        if (handleErrorRef.current) {
          handleErrorRef.current(`NFC error: ${err.message || err.name}`);
        }
      }
    }
  }, []);

  const toggleScan = useCallback(() => {
    if (isScanning) {
      stopScan();
      if (handleNoticeRef.current) {
        handleNoticeRef.current("NFC scanning stopped.");
      }
    } else {
      startScan();
    }
  }, [isScanning, startScan, stopScan]);

  // 'NDEFReader' in window check on mount; no-op if unsupported.
  useEffect(() => {
    const supported = typeof window !== "undefined" && "NDEFReader" in window;
    setIsSupported(supported);
    if (!supported) return;

    let isMounted = true;
    const abortController = new AbortController();
    activeAbortControllerRef.current = abortController;

    const autoStart = async () => {
      try {
        const ndef = new window.NDEFReader();
        await ndef.scan({ signal: abortController.signal });
        if (!isMounted) return;
        setIsScanning(true);

        ndef.onreading = (event) => {
          if (handleReadingRef.current) {
            handleReadingRef.current(event);
          }
        };

        ndef.onreadingerror = () => {
          if (isMounted && handleErrorRef.current) {
            handleErrorRef.current("NFC tag read failed. Please hold tag steady.");
          }
        };
      } catch (err) {
        // Safe rejection when user gesture is required or permission not yet granted.
        if (isMounted) {
          setIsScanning(false);
        }
      }
    };

    autoStart();

    return () => {
      isMounted = false;
      try {
        abortController.abort();
      } catch (e) {}
      if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      setIsScanning(false);
    };
  }, []);

  return {
    isSupported,
    isScanning,
    startScan,
    stopScan,
    toggleScan,
    pendingPunch,
    cancelPendingPunch,
    confirmPunchIn,
    confirmPunchOut,
    deriveAction: (customNowMs) =>
      deriveNfcPunchAction(statusRef.current, firstPunchRef.current, customNowMs)
  };
}

export default useNfcPunch;
