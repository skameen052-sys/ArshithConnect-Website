import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, AlertCircle, Clock, ShieldCheck, LogOut, Check, ChevronDown, X } from 'lucide-react';
import { attendanceService } from '../../services/attendanceService';
import { authService } from '../../services/authService';
import AttendanceCheckInModal from './AttendanceCheckInModal';
import AttendancePhotoDisplay from './AttendancePhotoDisplay';
import LateCheckInModal from './LateCheckInModal';
import AttendanceCelebrationModal from './AttendanceCelebrationModal';

const formatDisplayTime = (val) => {
  if (!val || val === '--') return '--';
  const s = String(val).trim();
  if (s.includes('T') || s.endsWith('Z')) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    }
  }
  return s;
};

const parseTimeCandidate = (rawVal, recordDateStr) => {
  if (!rawVal || rawVal === '--') return null;

  if (rawVal instanceof Date) {
    return !isNaN(rawVal.getTime()) ? rawVal : null;
  }

  if (typeof rawVal === 'object') {
    if (typeof rawVal.toDate === 'function') {
      const d = rawVal.toDate();
      return d && !isNaN(d.getTime()) ? d : null;
    }
    const secs = rawVal.seconds ?? rawVal._seconds;
    if (secs !== undefined && secs !== null) {
      const d = new Date(Number(secs) * 1000);
      return !isNaN(d.getTime()) ? d : null;
    }
  }

  if (typeof rawVal === 'number') {
    const d = new Date(rawVal > 1e11 ? rawVal : rawVal * 1000);
    return !isNaN(d.getTime()) ? d : null;
  }

  const s = String(rawVal).trim();
  if (!s || s === 'None' || s === 'null') return null;

  // Full ISO timestamp or date-time string
  if (s.includes('T') || s.endsWith('Z') || /^\d{4}-\d{2}-\d{2}/.test(s)) {
    const parsedIso = new Date(s);
    if (!isNaN(parsedIso.getTime())) return parsedIso;
  }

  // Time-only string such as "09:24 AM", "9:24:10 AM", or "14:30"
  const match12 = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  const match24 = !match12 ? s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/) : null;
  if (match12 || match24) {
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth();
    let day = now.getDate();

    if (recordDateStr && /^\d{4}-\d{2}-\d{2}/.test(String(recordDateStr).trim())) {
      const parts = String(recordDateStr).trim().slice(0, 10).split('-').map(Number);
      if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
        [year, month, day] = [parts[0], parts[1] - 1, parts[2]];
      }
    }

    let hours = Number((match12 || match24)[1]);
    const mins = Number((match12 || match24)[2]);
    const secs = Number((match12 || match24)[3] || 0);
    if (match12) {
      const meridiem = match12[4].toUpperCase();
      if (meridiem === 'AM' && hours === 12) hours = 0;
      else if (meridiem === 'PM' && hours < 12) hours += 12;
    }
    const d = new Date(year, month, day, hours, mins, secs, 0);
    return !isNaN(d.getTime()) ? d : null;
  }

  return null;
};

const parseAttendanceDateTime = (timestampVal, displayTimeVal, recordDateStr) =>
  parseTimeCandidate(timestampVal, recordDateStr) || parseTimeCandidate(displayTimeVal, recordDateStr);

const formatElapsedHms = (diffMs) => {
  const diffSecs = Math.max(0, Math.floor(diffMs / 1000));
  const hrs = Math.floor(diffSecs / 3600);
  const mins = Math.floor((diffSecs % 3600) / 60);
  const secs = diffSecs % 60;
  return `${hrs.toString().padStart(2, '0')}h ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
};

const formatSummaryHrsMins = (diffMs) => {
  const diffSecs = Math.max(0, Math.floor(diffMs / 1000));
  const hrs = Math.floor(diffSecs / 3600);
  const mins = Math.floor((diffSecs % 3600) / 60);
  return `${hrs.toString().padStart(2, '0')} hrs ${mins.toString().padStart(2, '0')} mins`;
};

const getTodayIsoDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function AttendanceCard() {
  const [currentTime, setCurrentTime] = useState(new Date());

  const todayIso = getTodayIsoDate();
  const cachedAttendance = (() => {
    try {
      const raw = localStorage.getItem(`arshith_attendance_cache_${todayIso}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.date === todayIso ? parsed : null;
    } catch {
      return null;
    }
  })();

  // Current authenticated user info
  const [currentUser, setCurrentUser] = useState(() => authService.getCurrentUser());

  // Attendance state loaded from backend / instant cache
  const [recordId, setRecordId] = useState(cachedAttendance?.id || null);
  const [isCheckedIn, setIsCheckedIn] = useState(Boolean(cachedAttendance?.isCheckedIn));
  const [isCompleted, setIsCompleted] = useState(Boolean(cachedAttendance?.isCompleted));
  const [checkInTime, setCheckInTime] = useState(formatDisplayTime(cachedAttendance?.checkInTime) || '--');
  const [checkOutTime, setCheckOutTime] = useState(formatDisplayTime(cachedAttendance?.checkOutTime) || '--');
  const [workingDuration, setWorkingDuration] = useState(cachedAttendance?.workingDuration || '--');
  const [workMode, setWorkMode] = useState(cachedAttendance?.workMode || 'WFO');
  const [status, setStatus] = useState(cachedAttendance?.status || 'Not Checked In');
  const [checkInDateObj, setCheckInDateObj] = useState(() => {
    if (cachedAttendance?.isCheckedIn && !cachedAttendance?.isCompleted) {
      return parseAttendanceDateTime(cachedAttendance.checkInTimestamp, cachedAttendance.checkInTime, todayIso);
    }
    return null;
  });

  // Late check-in state (Section 2 & 6)
  const [isLate, setIsLate] = useState(false);
  const [lateReason, setLateReason] = useState(null);
  const [lateReasonStatus, setLateReasonStatus] = useState('NOT_REQUIRED');
  const [lateReasonSubmittedAt, setLateReasonSubmittedAt] = useState(null);
  const [isLateModalOpen, setIsLateModalOpen] = useState(false);

  // Work Mode dropdown state and ref
  const workModeDropdownRef = useRef(null);
  const [isWorkModeDropdownOpen, setIsWorkModeDropdownOpen] = useState(false);

  // GPS & Photo metadata from backend
  const [gpsLatitude, setGpsLatitude] = useState(null);
  const [gpsLongitude, setGpsLongitude] = useState(null);
  const [gpsAccuracy, setGpsAccuracy] = useState(null);
  const [hasCheckInPhoto, setHasCheckInPhoto] = useState(false);

  // UI interaction states
  const [isCheckInModalOpen, setIsCheckInModalOpen] = useState(false);
  const [isCheckOutModalOpen, setIsCheckOutModalOpen] = useState(false);
  const [isEvidenceModalOpen, setIsEvidenceModalOpen] = useState(false);
  const [celebrationState, setCelebrationState] = useState({
    isOpen: false,
    type: 'check-in',
    data: {},
  });
  const [toastMessage, setToastMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [isProcessingCheckout, setIsProcessingCheckout] = useState(false);

  // Close Work Mode dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        workModeDropdownRef.current &&
        !workModeDropdownRef.current.contains(event.target)
      ) {
        setIsWorkModeDropdownOpen(false);
      }
    };
    if (isWorkModeDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isWorkModeDropdownOpen]);

  // Live Clock Ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch today's authoritative attendance status from backend
  const fetchTodayStatus = async () => {
    try {
      const data = await attendanceService.getTodayStatus();
      if (!data) return;

      setRecordId(data.id || null);
      if (data.isCheckedIn || data.isCompleted) {
        // Once checked in or completed, lock to the recorded work mode
        const recordedMode = data.workMode && data.workMode !== '--' ? data.workMode : 'WFO';
        setWorkMode(recordedMode);
      } else {
        // If not checked in, check saved user preference from localStorage or backend default
        try {
          const savedPref = localStorage.getItem('arshith_employee_preferred_work_mode');
          if (savedPref === 'WFH' || savedPref === 'WFO') {
            setWorkMode(savedPref);
          } else {
            const effectiveMode = data.authorizedWorkMode || (data.workMode && data.workMode !== '--' ? data.workMode : 'WFO');
            setWorkMode(effectiveMode);
          }
        } catch (e) {
          const effectiveMode = data.authorizedWorkMode || (data.workMode && data.workMode !== '--' ? data.workMode : 'WFO');
          setWorkMode(effectiveMode);
        }
      }
      setCheckInTime(formatDisplayTime(data.checkInTime) || '--');
      setCheckOutTime(formatDisplayTime(data.checkOutTime) || '--');
      setHasCheckInPhoto(Boolean(data.hasCheckInPhoto));
      setGpsLatitude(data.checkInLatitude ?? null);
      setGpsLongitude(data.checkInLongitude ?? null);
      setGpsAccuracy(data.checkInLocationAccuracy ?? null);

      const isRecordLate = Boolean(data.isLate);
      setIsLate(isRecordLate);
      setLateReason(data.lateReason || null);
      setLateReasonStatus(
        data.lateReasonStatus || (isRecordLate ? (data.lateReason ? 'SUBMITTED' : 'PENDING') : 'NOT_REQUIRED')
      );
      setLateReasonSubmittedAt(data.lateReasonSubmittedAt || null);

      if (data.isCompleted) {
        // Attendance completed and locked for today
        setIsCompleted(true);
        setIsCheckedIn(false);
        setCheckInDateObj(null);
        setStatus('Completed');
        const hasValidDur = data.workingDuration && data.workingDuration !== '--' && data.workingDuration !== 'In Progress';
        if (hasValidDur) {
          setWorkingDuration(data.workingDuration);
        } else {
          const parsedIn = parseAttendanceDateTime(data.checkInTimestamp, data.checkInTime, data.date);
          const parsedOut = parseAttendanceDateTime(data.checkOutTimestamp, data.checkOutTime, data.date);
          if (parsedIn && parsedOut) {
            setWorkingDuration(formatSummaryHrsMins(parsedOut.getTime() - parsedIn.getTime()));
          } else {
            setWorkingDuration('--');
          }
        }
      } else if (data.isCheckedIn) {
        // Active check-in state
        setIsCompleted(false);
        setIsCheckedIn(true);
        setStatus(data.status || 'Present');

        const parsedIn = parseAttendanceDateTime(data.checkInTimestamp, data.checkInTime, data.date);
        if (parsedIn) {
          setCheckInDateObj(parsedIn);
          setWorkingDuration(formatElapsedHms(Date.now() - parsedIn.getTime()));
        } else {
          setCheckInDateObj(null);
          const fallbackDur = data.workingDuration && data.workingDuration !== 'In Progress' ? data.workingDuration : '--';
          setWorkingDuration(fallbackDur);
        }
      } else {
        // Not checked in yet
        setIsCompleted(false);
        setIsCheckedIn(false);
        setCheckInDateObj(null);
        setStatus('Not Checked In');
        setWorkingDuration('--');
      }

      // Persist latest authoritative state to cache for instant rendering
      try {
        localStorage.setItem(`arshith_attendance_cache_${data.date || todayIso}`, JSON.stringify(data));
      } catch (_) {}
    } catch (err) {
      console.warn('Could not fetch today attendance status from backend', err);
    }
  };

  useEffect(() => {
    fetchTodayStatus();

    // Fast polling every 10 seconds for live attendance sync across mobile/web
    const pollTimer = setInterval(() => {
      fetchTodayStatus();
    }, 10000);

    // Immediate sync whenever user refocuses tab or app becomes visible
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchTodayStatus();
      }
    };
    const handleFocus = () => {
      fetchTodayStatus();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Live Working Duration counter when checked in
  useEffect(() => {
    let durationTimer;
    if (isCheckedIn && !isCompleted && checkInDateObj) {
      const updateElapsed = () => {
        setWorkingDuration(formatElapsedHms(Date.now() - checkInDateObj.getTime()));
      };
      updateElapsed();
      durationTimer = setInterval(updateElapsed, 1000);
    }
    return () => clearInterval(durationTimer);
  }, [isCheckedIn, isCompleted, checkInDateObj]);

  const formattedDate = currentTime.toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const formattedClock = currentTime.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  // Check-In: opens location & camera modal
  const handleCheckInClick = () => {
    if (isCheckedIn || isCompleted) return;
    setIsCheckInModalOpen(true);
  };

  const handleSelectWorkMode = (mode) => {
    if (isCheckedIn || isCompleted) return;
    setWorkMode(mode);
    setIsWorkModeDropdownOpen(false);
    try {
      localStorage.setItem('arshith_employee_preferred_work_mode', mode);
    } catch (e) {
      console.warn('Could not save work mode preference to localStorage', e);
    }
  };

  const handleCheckInSuccess = (res) => {
    setIsCheckedIn(true);
    setIsCompleted(false);
    setRecordId(res.id || null);
    setCheckInTime(formatDisplayTime(res.checkIn || res.checkInTime) || 'Just now');
    setWorkMode(res.workMode || workMode);
    setStatus(res.status || 'Present');
    const startedAt =
      parseAttendanceDateTime(res.timestamp || res.attendance?.check_in_timestamp, res.checkIn || res.checkInTime) ||
      new Date();
    setCheckInDateObj(startedAt);
    setWorkingDuration(formatElapsedHms(Date.now() - startedAt.getTime()));
    setHasCheckInPhoto(true);
    setGpsLatitude(res.checkInLatitude ?? null);
    setGpsLongitude(res.checkInLongitude ?? null);
    setGpsAccuracy(res.checkInLocationAccuracy ?? null);

    const isRecordLate = Boolean(res.isLate);
    setIsLate(isRecordLate);
    setLateReason(res.lateReason || null);
    setLateReasonStatus(
      res.lateReasonStatus || (isRecordLate ? (res.lateReason ? 'SUBMITTED' : 'PENDING') : 'NOT_REQUIRED')
    );
    setLateReasonSubmittedAt(res.lateReasonSubmittedAt || null);

    setIsError(false);
    setToastMessage(`Checked In (${res.workMode || workMode}) - Status: ${res.status || 'Present'}`);
    setTimeout(() => setToastMessage(''), 4000);

    // Save optimistic cache immediately
    try {
      localStorage.setItem(`arshith_attendance_cache_${todayIso}`, JSON.stringify({
        id: res.id || recordId,
        date: todayIso,
        isCheckedIn: true,
        isCompleted: false,
        checkInTime: formatDisplayTime(res.checkIn || res.checkInTime) || 'Just now',
        checkOutTime: '--',
        checkInTimestamp: startedAt.toISOString(),
        workMode: res.workMode || workMode,
        status: res.status || 'Present',
        workingDuration: formatElapsedHms(Date.now() - startedAt.getTime()),
      }));
    } catch (_) {}

    // Synchronize authoritative state in background
    fetchTodayStatus();

    // Trigger celebratory Check-In Animation
    setCelebrationState({
      isOpen: true,
      type: 'check-in',
      data: {
        checkInTime: formatDisplayTime(res.checkIn || res.checkInTime) || 'Just now',
        workMode: res.workMode || workMode,
        status: res.status || 'Present',
      },
    });

    // If check-in is after 9:30 AM IST (late), prompt the user with Late Check-in Reason modal immediately
    if (isRecordLate && !res.lateReason) {
      setTimeout(() => {
        setIsLateModalOpen(true);
      }, 450);
    }
  };

  // Check-Out: confirmation modal trigger
  const handleCheckOutClick = () => {
    if (!isCheckedIn || isCompleted) return;
    setIsCheckOutModalOpen(true);
  };

  const handleConfirmCheckOut = async () => {
    try {
      setIsProcessingCheckout(true);
      setIsError(false);
      const empId = currentUser?.employeeId || currentUser?.employee_id;
      const res = await attendanceService.checkOut({ employeeId: empId });

      setIsCheckOutModalOpen(false);
      setIsCheckedIn(false);
      setIsCompleted(true);
      setStatus('Completed');
      setCheckOutTime(formatDisplayTime(res.checkOut || res.checkOutTime) || 'Just now');
      if (res.duration || res.workingDuration) {
        setWorkingDuration(res.duration || res.workingDuration);
      }

      setToastMessage(`Checked Out successfully at ${formatDisplayTime(res.checkOut || res.checkOutTime) || 'now'}`);
      setTimeout(() => setToastMessage(''), 4500);

      // Save optimistic checkout cache immediately
      try {
        localStorage.setItem(`arshith_attendance_cache_${todayIso}`, JSON.stringify({
          id: res.id || recordId,
          date: todayIso,
          isCheckedIn: false,
          isCompleted: true,
          checkInTime: checkInTime,
          checkOutTime: formatDisplayTime(res.checkOut || res.checkOutTime) || 'Just now',
          workingDuration: res.duration || res.workingDuration || workingDuration,
          workMode: workMode,
          status: 'Completed',
        }));
      } catch (_) {}

      // Refresh authoritative attendance status
      fetchTodayStatus();

      // Trigger celebratory Check-Out Animation
      setCelebrationState({
        isOpen: true,
        type: 'check-out',
        data: {
          checkOutTime: formatDisplayTime(res.checkOut || res.checkOutTime) || 'Just now',
          workingDuration: res.duration || res.workingDuration || workingDuration,
          status: 'Completed',
        },
      });
    } catch (err) {
      setIsError(true);
      setToastMessage(err.message || 'Check-out failed');
      setTimeout(() => setToastMessage(''), 4000);
    } finally {
      setIsProcessingCheckout(false);
    }
  };

  // Lock background scroll and listen for Escape key when Check-Out modal is open
  useEffect(() => {
    if (!isCheckOutModalOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isProcessingCheckout) {
        setIsCheckOutModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isCheckOutModalOpen, isProcessingCheckout]);

  // Status badge styling
  let badgeClass = 'status-badge-not-checked';
  let badgeLabel = 'Not Checked In';

  if (isCompleted) {
    badgeClass = 'status-badge-completed';
    badgeLabel = 'Attendance Completed';
  } else if (isCheckedIn) {
    badgeClass = 'status-badge-checked';
    badgeLabel = 'Working';
  }

  return (
    <div className="attendance-main-card">
      {/* Top Card Header */}
      <div className="attendance-card-header">
        <span className="attendance-date">{formattedDate}</span>
        <div className={`status-badge-pill ${badgeClass}`}>
          <span className={`badge-dot ${isCheckedIn ? 'badge-beacon-green' : isCompleted ? 'badge-beacon-blue' : ''}`} />
          <span>{badgeLabel}</span>
        </div>
      </div>

      {/* Large Live Digital Clock */}
      <div className="attendance-live-clock">{formattedClock}</div>

      <div className="attendance-summary-label">Your attendance for today</div>

      {/* Attendance Stats Info Grid */}
      <div className="attendance-info-grid">
        <div className="attendance-info-row">
          <span className="info-label">Check-in:</span>
          <span className="info-val">{formatDisplayTime(checkInTime)}</span>
        </div>
        <div className="attendance-info-row">
          <span className="info-label">Check-out:</span>
          <span className="info-val">{formatDisplayTime(checkOutTime)}</span>
        </div>
        <div className="attendance-info-row">
          <span className="info-label">Working Duration:</span>
          <span className="info-val">{workingDuration}</span>
        </div>
        <div className="attendance-info-row" style={{ position: 'relative' }}>
          <span className="info-label">Work Mode:</span>
          <div ref={workModeDropdownRef} style={{ position: 'relative', display: 'inline-flex' }}>
            <button
              type="button"
              className="work-mode-dropdown-trigger"
              onClick={() => {
                if (!isCheckedIn && !isCompleted) {
                  setIsWorkModeDropdownOpen((prev) => !prev);
                }
              }}
              disabled={isCheckedIn || isCompleted}
              title={
                isCheckedIn || isCompleted
                  ? 'Work mode is locked for today'
                  : 'Click to select Work Mode (WFO or WFH)'
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.85rem',
                fontWeight: '700',
                color: workMode === 'WFO' ? '#0b3d2b' : '#1d4ed8',
                backgroundColor: workMode === 'WFO' ? '#ecfdf5' : '#eff6ff',
                border: workMode === 'WFO' ? '1px solid #a7f3d0' : '1px solid #bfdbfe',
                borderRadius: '6px',
                padding: '3px 8px',
                cursor: isCheckedIn || isCompleted ? 'default' : 'pointer',
                outline: 'none',
                transition: 'all 0.15s ease-in-out',
                boxShadow: isWorkModeDropdownOpen ? '0 0 0 2px rgba(16, 185, 129, 0.2)' : 'none',
              }}
            >
              <span>{workMode === 'WFH' ? 'WFH (Home)' : 'WFO (Office)'}</span>
              {!isCheckedIn && !isCompleted && (
                <ChevronDown
                  size={13}
                  style={{
                    transition: 'transform 0.2s ease',
                    transform: isWorkModeDropdownOpen ? 'rotate(180deg)' : 'none',
                    color: workMode === 'WFO' ? '#047857' : '#2563eb',
                  }}
                />
              )}
            </button>

            {/* Dropdown Menu Options */}
            {isWorkModeDropdownOpen && !isCheckedIn && !isCompleted && (
              <div
                className="work-mode-dropdown-menu animate-fade-in"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  right: 0,
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
                  zIndex: 50,
                  minWidth: '160px',
                  overflow: 'hidden',
                  padding: '4px',
                }}
              >
                <button
                  type="button"
                  onClick={() => handleSelectWorkMode('WFO')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: '0.83rem',
                    fontWeight: workMode === 'WFO' ? '700' : '500',
                    color: workMode === 'WFO' ? '#0b3d2b' : '#334155',
                    backgroundColor: workMode === 'WFO' ? '#ecfdf5' : 'transparent',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background-color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (workMode !== 'WFO') e.currentTarget.style.backgroundColor = '#f8fafc';
                  }}
                  onMouseLeave={(e) => {
                    if (workMode !== 'WFO') e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: '#10b981',
                      }}
                    />
                    <span>WFO (Office)</span>
                  </div>
                  {workMode === 'WFO' && <Check size={14} color="#059669" />}
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectWorkMode('WFH')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: '0.83rem',
                    fontWeight: workMode === 'WFH' ? '700' : '500',
                    color: workMode === 'WFH' ? '#1d4ed8' : '#334155',
                    backgroundColor: workMode === 'WFH' ? '#eff6ff' : 'transparent',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background-color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (workMode !== 'WFH') e.currentTarget.style.backgroundColor = '#f8fafc';
                  }}
                  onMouseLeave={(e) => {
                    if (workMode !== 'WFH') e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: '#3b82f6',
                      }}
                    />
                    <span>WFH (Home)</span>
                  </div>
                  {workMode === 'WFH' && <Check size={14} color="#2563eb" />}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Side-by-side Check-In and Check-Out Action Buttons */}
      <div className="attendance-actions-row">
        <button
          type="button"
          id="btn-attendance-check-in"
          className={`btn-check-in ${
            !isCheckedIn && !isCompleted ? 'btn-check-in-active btn-shimmer' : 'btn-check-in-disabled'
          }`}
          onClick={handleCheckInClick}
          disabled={isCheckedIn || isCompleted}
          title={
            isCompleted
              ? 'Attendance completed for today'
              : isCheckedIn
              ? 'Already checked in for today'
              : 'Click to start check-in'
          }
        >
          CHECK IN
        </button>
        <button
          type="button"
          id="btn-attendance-check-out"
          className={`btn-check-out ${
            isCheckedIn && !isCompleted
              ? 'btn-check-out-active btn-shimmer'
              : isCompleted
              ? 'btn-check-out-completed'
              : 'btn-check-out-disabled'
          }`}
          onClick={handleCheckOutClick}
          disabled={!isCheckedIn || isCompleted || isProcessingCheckout}
          title={
            isCompleted
              ? 'Attendance completed for today'
              : !isCheckedIn
              ? 'Check in first to enable check out'
              : 'Click to confirm check-out'
          }
        >
          {isProcessingCheckout ? 'PROCESSING...' : 'CHECK OUT'}
        </button>
      </div>

      {/* Late Check-in Reason Submitted Card (Section 6) */}
      {(isCheckedIn || isCompleted) && isLate && lateReason && (
        <div className="attendance-late-reason-card animate-fade-in">
          <div className="attendance-late-reason-header">
            <span className="attendance-late-reason-title">
              <AlertCircle size={15} color="#b45309" />
              Late Check-in Reason
            </span>
            <span className="attendance-late-reason-tag">Submitted</span>
          </div>
          <p className="attendance-late-reason-text">"{lateReason}"</p>
          {lateReasonSubmittedAt && (
            <span className="attendance-late-reason-time">
              Recorded at: {new Date(lateReasonSubmittedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
            </span>
          )}
        </div>
      )}

      {/* Late Check-in Reason Pending Prompt (Section 6) */}
      {(isCheckedIn || isCompleted) && isLate && !lateReason && (
        <div className="attendance-late-pending-card animate-fade-in">
          <div className="attendance-late-pending-content">
            <div className="attendance-late-pending-title">
              <AlertCircle size={15} color="#c2410c" />
              <span>Late Reason Required</span>
            </div>
            <p className="attendance-late-pending-desc">
              Your check-in was recorded after 9:30 AM IST. Please provide your reason.
            </p>
          </div>
          <button
            type="button"
            className="btn-submit-reason-pill"
            onClick={() => setIsLateModalOpen(true)}
          >
            Submit Reason
          </button>
        </div>
      )}

      {/* Compact Check-In Confirmation Banner hidden per user request */}

      {/* Daily Lock Message */}
      {isCompleted && (
        <div className="attendance-completed-banner animate-fade-in">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle size={16} />
            <span>You have completed your attendance for today.</span>
          </div>
          {hasCheckInPhoto && recordId && (
            <button
              type="button"
              className="btn-view-verification-text"
              onClick={() => setIsEvidenceModalOpen(true)}
              title="View verification evidence"
            >
              View Verification
            </button>
          )}
        </div>
      )}

      {/* Interactive Toast notification */}
      {toastMessage && (
        <div
          style={{
            marginTop: '12px',
            padding: '8px 12px',
            backgroundColor: isError ? '#fef2f2' : '#ecfdf5',
            color: isError ? '#dc2626' : '#047857',
            borderRadius: '10px',
            fontSize: '0.8rem',
            fontWeight: '600',
            textAlign: 'center',
            border: `1px solid ${isError ? '#fecaca' : '#a7f3d0'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          {isError ? <AlertCircle size={14} /> : <CheckCircle size={14} />}
          <span>{toastMessage}</span>
        </div>
      )}

      {/* On-Demand Verification Evidence Modal (Accessible when needed without cluttering dashboard) */}
      {isEvidenceModalOpen && recordId && (
        <div className="attendance-modal-overlay" onClick={() => setIsEvidenceModalOpen(false)}>
          <div
            className="attendance-modal-container animate-fade-in"
            style={{ maxWidth: '480px', width: '92%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="attendance-modal-header" style={{ justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldCheck size={18} color="#059669" />
                <h3 className="attendance-modal-title" style={{ fontSize: '1rem', margin: 0, color: '#0b3d2b', fontWeight: 700 }}>
                  Verification Evidence
                </h3>
              </div>
              <button
                type="button"
                className="lightbox-close-btn"
                onClick={() => setIsEvidenceModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center' }}
              >
                <X size={18} />
              </button>
            </div>
            <div className="attendance-modal-body" style={{ padding: '16px' }}>
              <AttendancePhotoDisplay
                attendanceId={recordId}
                checkInTime={checkInTime}
                checkInLatitude={gpsLatitude}
                checkInLongitude={gpsLongitude}
                checkInAccuracy={gpsAccuracy}
                workMode={workMode}
                status={status}
              />
            </div>
            <div className="modal-actions-footer" style={{ padding: '12px 16px', justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0' }}>
              <button
                type="button"
                className="btn-modal-cancel"
                onClick={() => setIsEvidenceModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Check-In Modal: GPS Location & Live Camera Capture */}
      <AttendanceCheckInModal
        isOpen={isCheckInModalOpen}
        onClose={() => setIsCheckInModalOpen(false)}
        onCheckInSuccess={handleCheckInSuccess}
        workMode={workMode}
      />

      {/* Check-Out Confirmation Modal (Rendered via portal to prevent parent transforms/clipping) */}
      {isCheckOutModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="attendance-modal-overlay checkout-modal-overlay"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isProcessingCheckout) {
                setIsCheckOutModalOpen(false);
              }
            }}
          >
            <div
              className="attendance-modal-container checkout-modal animate-fade-in"
              style={{ maxWidth: '420px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="attendance-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <LogOut size={18} color="#0b3d2b" />
                  <h3 className="attendance-modal-title" style={{ fontSize: '1rem' }}>
                    Confirm Check-Out
                  </h3>
                </div>
              </div>

              <div className="attendance-modal-body" style={{ textAlign: 'center', padding: '24px 20px' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.5, margin: 0 }}>
                  Are you sure you want to <strong>Check Out</strong>?
                </p>
                <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '8px', lineHeight: 1.4 }}>
                  This will record your authoritative check-out timestamp and <strong>lock attendance for the remainder of today</strong>.
                </p>

                <div className="modal-actions-footer" style={{ marginTop: '22px' }}>
                  <button
                    type="button"
                    className="btn-modal-cancel"
                    onClick={() => setIsCheckOutModalOpen(false)}
                    disabled={isProcessingCheckout}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-modal-primary"
                    onClick={handleConfirmCheckOut}
                    disabled={isProcessingCheckout}
                    style={{ backgroundColor: '#0b3d2b' }}
                  >
                    {isProcessingCheckout ? 'Recording...' : 'Confirm Check-Out'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Late Check-in Reason Modal (Section 4) */}
      <LateCheckInModal
        isOpen={isLateModalOpen}
        onClose={() => setIsLateModalOpen(false)}
        recordId={recordId}
        employeeName={currentUser?.fullName || currentUser?.name || 'Employee'}
        employeeId={currentUser?.employeeId || currentUser?.id || '--'}
        attendanceDate={formattedDate}
        checkInTime={checkInTime}
        onSuccess={() => {
          fetchTodayStatus();
          setToastMessage('Late check-in reason recorded successfully');
          setTimeout(() => setToastMessage(''), 4500);
        }}
      />

      {/* Check-In & Check-Out Celebration Animation Modal */}
      <AttendanceCelebrationModal
        isOpen={celebrationState.isOpen}
        type={celebrationState.type}
        data={celebrationState.data}
        onClose={() => setCelebrationState((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
