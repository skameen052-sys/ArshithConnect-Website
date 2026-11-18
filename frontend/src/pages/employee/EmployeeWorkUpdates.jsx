import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  RefreshCw, CheckCircle2, Clock, AlertCircle, Send, X, 
  Calendar, User, Lock, Check, ChevronRight, FileText, Eye,
  Grid, List
} from 'lucide-react';
import { workUpdateService } from '../../services/workUpdateService';
import WorkUpdatesDrilldown from '../../components/work-updates/WorkUpdatesDrilldown';

/**
 * EmployeeWorkUpdates Page
 * Professional horizontal layouts for website & mobile:
 * - Top Status Banner with next window opening countdown
 * - Responsive horizontal card strips and 4-column side-by-side grid
 * - Node indicators with green checkmarks for submitted and dotted circles for pending
 * - Badges: "✓ Submitted", "Window closed", "Opens {time}", "Open Now"
 * - Action buttons: "View ›" for submitted, unlocked "Submit" for open, "🔒 Submit" for locked
 * - Tab switcher to view past Daily Work History & download PDF reports
 */
export default function EmployeeWorkUpdates() {
  const navigate = useNavigate();

  // Active view tab: 'today' | 'history'
  const [activeTab, setActiveTab] = useState('today');

  // Schedule view mode: 'horizontal_rows' | 'horizontal_grid'
  const [scheduleViewMode, setScheduleViewMode] = useState('horizontal_rows');

  // Schedules state
  const [schedulesData, setSchedulesData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Submission modal state
  const [activeSchedule, setActiveSchedule] = useState(null);
  const [updateText, setUpdateText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  // View submitted update modal state
  const [viewingSchedule, setViewingSchedule] = useState(null);

  // Fetch today's schedules
  const fetchTodaySchedules = useCallback(async (isSilent = false) => {
    try {
      if (!isSilent) setIsLoading(true);
      else setIsRefreshing(true);
      setErrorMessage('');

      const data = await workUpdateService.getTodaySchedules();
      setSchedulesData(data);
    } catch (err) {
      console.warn('Failed to fetch today work schedules:', err);
      setErrorMessage(err.message || 'Could not load today work schedules');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchTodaySchedules();
    const interval = setInterval(() => {
      fetchTodaySchedules(true);
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchTodaySchedules]);

  // Open submission modal
  const handleOpenSubmitModal = (sch) => {
    if (!sch.is_open || sch.has_submitted) return;
    setActiveSchedule(sch);
    setUpdateText('');
    setModalError('');
  };

  const handleCloseSubmitModal = (force = false) => {
    if (isSubmitting && force !== true) return;
    setActiveSchedule(null);
    setUpdateText('');
    setModalError('');
  };

  // Submit work update
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!updateText.trim()) {
      setModalError('Enter your work update before submitting.');
      return;
    }

    if (!activeSchedule) return;

    try {
      setIsSubmitting(true);
      setModalError('');

      await workUpdateService.submitWorkUpdate({
        scheduleId: activeSchedule.schedule_id,
        section: activeSchedule.section,
        workSchedule: activeSchedule.work_schedule_str,
        submissionWindow: activeSchedule.submission_window_str,
        scheduleName: activeSchedule.name,
        updateText: updateText.trim(),
        date: schedulesData?.date,
      });

      const submittedName = activeSchedule.name;
      handleCloseSubmitModal(true);
      setSuccessMessage(`Work update for ${submittedName} submitted successfully!`);
      setTimeout(() => setSuccessMessage(''), 4500);

      // Refresh today schedules
      await fetchTodaySchedules(true);
    } catch (err) {
      const msg = err.message || 'Failed to submit work update';
      setModalError(msg);
      if (msg.toLowerCase().includes('already been submitted')) {
        fetchTodaySchedules(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const employee = schedulesData?.employee || {};
  const schedules = schedulesData?.schedules || [];
  const nextWindowText = schedulesData?.nextWindowText || 'Next window opens soon';
  const totalUpdates = schedulesData?.totalUpdatesToday || schedules.length || 4;

  return (
    <div
      style={{
        maxWidth: '1160px',
        margin: '0 auto',
        padding: '0 20px 48px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Top Banner / Navigation Bar */}
      <div
        style={{
          background: 'linear-gradient(135deg, #00594C 0%, #00796B 50%, #004D40 100%)',
          color: '#ffffff',
          margin: '-16px -20px 24px',
          padding: '22px 28px 26px',
          borderBottomLeftRadius: '24px',
          borderBottomRightRadius: '24px',
          boxShadow: '0 6px 20px rgba(0, 77, 64, 0.22)',
        }}
      >
        {/* Top Controls Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <button
            type="button"
            onClick={() => navigate('/employee/dashboard')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.18)',
              border: 'none',
              color: '#ffffff',
              borderRadius: '8px',
              padding: '7px 16px',
              fontSize: '0.85rem',
              fontWeight: '700',
              cursor: 'pointer',
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.28)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.18)')}
          >
            ‹ Back
          </button>

          {/* Tab Switcher: Today's Schedule vs My History */}
          <div style={{ display: 'flex', backgroundColor: 'rgba(0, 0, 0, 0.22)', borderRadius: '10px', padding: '3px', gap: '3px' }}>
            <button
              type="button"
              onClick={() => setActiveTab('today')}
              style={{
                padding: '6px 16px',
                borderRadius: '8px',
                border: 'none',
                fontSize: '0.825rem',
                fontWeight: '700',
                backgroundColor: activeTab === 'today' ? '#ffffff' : 'transparent',
                color: activeTab === 'today' ? '#004d40' : '#ffffff',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              Today's Schedule
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              style={{
                padding: '6px 16px',
                borderRadius: '8px',
                border: 'none',
                fontSize: '0.825rem',
                fontWeight: '700',
                backgroundColor: activeTab === 'history' ? '#ffffff' : 'transparent',
                color: activeTab === 'history' ? '#004d40' : '#ffffff',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              My History & Reports
            </button>
          </div>

          <button
            type="button"
            onClick={() => fetchTodaySchedules(true)}
            title="Refresh"
            disabled={isRefreshing}
            style={{
              background: 'rgba(255, 255, 255, 0.16)',
              border: 'none',
              color: '#ffffff',
              borderRadius: '50%',
              width: '34px',
              height: '34px',
              cursor: isRefreshing ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Live Window Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <Clock size={18} color="#a7f3d0" />
          <span style={{ fontSize: '1.05rem', fontWeight: '800', color: '#f0fdf4', letterSpacing: '-0.2px' }}>
            {nextWindowText}
          </span>
        </div>

        <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.85)' }}>
          {employee?.name ? `Logged in as ${employee.name} (${employee.email || ''})` : 'Arshith Connect Daily Work Portal'}
        </div>
      </div>

      {/* Success Notification */}
      {successMessage && (
        <div
          style={{
            backgroundColor: '#ecfdf5',
            border: '1px solid #a7f3d0',
            color: '#065f46',
            borderRadius: '12px',
            padding: '12px 18px',
            fontSize: '0.875rem',
            fontWeight: '600',
            marginBottom: '18px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <CheckCircle2 size={18} />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Error Notification */}
      {errorMessage && (
        <div
          style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            borderRadius: '12px',
            padding: '12px 18px',
            fontSize: '0.875rem',
            fontWeight: '600',
            marginBottom: '18px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertCircle size={18} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: TODAY'S SCHEDULE (Horizontal Widescreen Layout)                    */}
      {/* ========================================================================= */}
      {activeTab === 'today' && (
        <div className="animate-fade-in">
          {/* Header Row: Today's schedule | 4 updates today & View Switcher */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '14px',
              marginBottom: '20px',
              padding: '0 4px',
            }}
          >
            <div>
              <h1 style={{ fontSize: '1.45rem', fontWeight: '800', color: '#0f172a', margin: '0 0 2px', letterSpacing: '-0.3px' }}>
                Today's schedule
              </h1>
              <span style={{ fontSize: '0.875rem', color: '#64748b', fontWeight: '500' }}>
                {totalUpdates} updates today &bull; Date: {schedulesData?.date || 'Today'}
              </span>
            </div>

            {/* Row vs Grid Switcher */}
            <div style={{ display: 'flex', backgroundColor: '#e2e8f0', borderRadius: '8px', padding: '2px' }}>
              <button
                type="button"
                onClick={() => setScheduleViewMode('horizontal_rows')}
                title="Horizontal Rows"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  fontSize: '0.75rem',
                  fontWeight: '700',
                  backgroundColor: scheduleViewMode === 'horizontal_rows' ? '#ffffff' : 'transparent',
                  color: scheduleViewMode === 'horizontal_rows' ? '#004d40' : '#64748b',
                  cursor: 'pointer',
                }}
              >
                <List size={14} />
                <span>Rows</span>
              </button>
              <button
                type="button"
                onClick={() => setScheduleViewMode('horizontal_grid')}
                title="4-Column Horizontal Grid"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  fontSize: '0.75rem',
                  fontWeight: '700',
                  backgroundColor: scheduleViewMode === 'horizontal_grid' ? '#ffffff' : 'transparent',
                  color: scheduleViewMode === 'horizontal_grid' ? '#004d40' : '#64748b',
                  cursor: 'pointer',
                }}
              >
                <Grid size={14} />
                <span>Grid</span>
              </button>
            </div>
          </div>

          {/* Loading state */}
          {isLoading && (
            <div style={{ textAlign: 'center', padding: '64px 0', color: '#00796B' }}>
              <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 10px' }} />
              <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#64748b' }}>
                Loading today's schedules...
              </div>
            </div>
          )}

          {/* Schedule Cards Layout */}
          {!isLoading && scheduleViewMode === 'horizontal_rows' ? (
            /* Style A: Professional Horizontal Strip Cards */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {schedules.map((sch, index) => {
                const isSubmitted = sch.has_submitted;
                const isOpen = sch.is_open;

                return (
                  <div
                    key={sch.id || index}
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: '16px',
                      border: '1.5px dashed #cbd5e1',
                      padding: '16px 22px',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '20px',
                      flexWrap: 'wrap',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#00796B')}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#cbd5e1')}
                  >
                    {/* Left: Indicator node + Update # + Name */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: '1 1 260px', minWidth: 'min(100%, 220px)' }}>
                      <div
                        style={{
                          width: '34px',
                          height: '34px',
                          borderRadius: '50%',
                          backgroundColor: isSubmitted ? '#00594C' : '#ffffff',
                          border: isSubmitted ? 'none' : '2px solid #00796B',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                        }}
                      >
                        {isSubmitted ? (
                          <Check size={16} color="#ffffff" strokeWidth={3} />
                        ) : (
                          <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#00796B' }} />
                        )}
                      </div>
                      <div>
                        <span style={{ fontSize: '0.725rem', fontWeight: '800', color: '#64748b', letterSpacing: '0.5px' }}>
                          {sch.section_label || `UPDATE 0${sch.section || index + 1}`}
                        </span>
                        <div style={{ fontSize: '1.08rem', fontWeight: '800', color: '#0f172a', lineHeight: 1.25 }}>
                          {sch.name}
                        </div>
                      </div>
                    </div>

                    {/* Middle: Working Hours & Submission Window */}
                    <div style={{ flex: '1 1 280px', minWidth: 'min(100%, 220px)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ fontSize: '0.875rem', fontWeight: '700', color: '#334155' }}>
                        {sch.work_schedule_str || `${sch.work_start_display} - ${sch.work_end_display}`}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                        Window: {sch.submission_window_str || `${sch.window_start_display} - ${sch.window_end_display}`}
                      </div>
                    </div>

                    {/* Right: Badge + Action Button */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                      {/* Badge Pill */}
                      {isSubmitted && (
                        <span style={{ backgroundColor: '#dcfce7', color: '#15803d', borderRadius: '14px', padding: '5px 14px', fontSize: '0.75rem', fontWeight: '700' }}>
                          ✓ Submitted
                        </span>
                      )}
                      {!isSubmitted && sch.badge_variant === 'closed' && (
                        <span style={{ backgroundColor: '#f1f5f9', color: '#64748b', borderRadius: '14px', padding: '5px 14px', fontSize: '0.75rem', fontWeight: '700' }}>
                          Window closed
                        </span>
                      )}
                      {!isSubmitted && sch.badge_variant === 'upcoming' && (
                        <span style={{ backgroundColor: '#fef3c7', color: '#b45309', borderRadius: '14px', padding: '5px 14px', fontSize: '0.75rem', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <Clock size={12} />
                          {sch.badge_text || 'Upcoming'}
                        </span>
                      )}
                      {!isSubmitted && sch.badge_variant === 'open' && (
                        <span style={{ backgroundColor: '#d1fae5', color: '#065f46', borderRadius: '14px', padding: '5px 14px', fontSize: '0.75rem', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#10b981' }} />
                          Open Now
                        </span>
                      )}

                      {/* Action Button */}
                      {isSubmitted ? (
                        <button
                          type="button"
                          onClick={() => setViewingSchedule(sch)}
                          style={{
                            background: '#f0fdf9',
                            border: '1px solid rgba(0, 121, 107, 0.25)',
                            borderRadius: '8px',
                            color: '#004d40',
                            fontSize: '0.85rem',
                            fontWeight: '700',
                            cursor: 'pointer',
                            padding: '8px 16px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            transition: 'all 0.2s',
                          }}
                        >
                          <span>View</span>
                          <ChevronRight size={15} />
                        </button>
                      ) : isOpen ? (
                        <button
                          type="button"
                          onClick={() => handleOpenSubmitModal(sch)}
                          style={{
                            backgroundColor: '#00796B',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '9px 20px',
                            fontSize: '0.85rem',
                            fontWeight: '700',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            boxShadow: '0 2px 6px rgba(0, 121, 107, 0.25)',
                            transition: 'all 0.2s',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#00594C')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#00796B')}
                        >
                          Submit
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled
                          style={{
                            backgroundColor: '#00796B',
                            color: '#ffffff',
                            opacity: 0.85,
                            border: 'none',
                            borderRadius: '8px',
                            padding: '9px 18px',
                            fontSize: '0.85rem',
                            fontWeight: '700',
                            cursor: 'not-allowed',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <Lock size={13} />
                          Submit
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : !isLoading ? (
            /* Style B: Horizontal 4-Column Grid */
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                gap: '16px',
              }}
            >
              {schedules.map((sch, index) => {
                const isSubmitted = sch.has_submitted;
                const isOpen = sch.is_open;

                return (
                  <div
                    key={sch.id || index}
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: '16px',
                      border: '1.5px dashed #cbd5e1',
                      padding: '18px 20px',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#00796B')}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#cbd5e1')}
                  >
                    <div>
                      {/* Top Row: UPDATE 01 & Badge */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontSize: '0.725rem', fontWeight: '800', color: '#64748b' }}>
                          {sch.section_label || `UPDATE 0${sch.section || index + 1}`}
                        </span>

                        {isSubmitted && (
                          <span style={{ backgroundColor: '#dcfce7', color: '#15803d', borderRadius: '12px', padding: '3px 10px', fontSize: '0.725rem', fontWeight: '700' }}>
                            ✓ Submitted
                          </span>
                        )}
                        {!isSubmitted && sch.badge_variant === 'closed' && (
                          <span style={{ backgroundColor: '#f1f5f9', color: '#64748b', borderRadius: '12px', padding: '3px 10px', fontSize: '0.725rem', fontWeight: '700' }}>
                            Window closed
                          </span>
                        )}
                        {!isSubmitted && sch.badge_variant === 'upcoming' && (
                          <span style={{ backgroundColor: '#fef3c7', color: '#b45309', borderRadius: '12px', padding: '3px 10px', fontSize: '0.725rem', fontWeight: '700' }}>
                            {sch.badge_text || 'Upcoming'}
                          </span>
                        )}
                        {!isSubmitted && sch.badge_variant === 'open' && (
                          <span style={{ backgroundColor: '#d1fae5', color: '#065f46', borderRadius: '12px', padding: '3px 10px', fontSize: '0.725rem', fontWeight: '700' }}>
                            Open Now
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: '1.05rem', fontWeight: '800', color: '#0f172a', marginBottom: '4px' }}>
                        {sch.name}
                      </div>

                      <div style={{ fontSize: '0.825rem', color: '#475569', marginBottom: '2px', fontWeight: '600' }}>
                        {sch.work_schedule_str}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '16px' }}>
                        Window: {sch.submission_window_str}
                      </div>
                    </div>

                    {/* Bottom Action */}
                    <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
                      {isSubmitted ? (
                        <button
                          type="button"
                          onClick={() => setViewingSchedule(sch)}
                          style={{
                            width: '100%',
                            background: '#f0fdf9',
                            border: '1px solid rgba(0, 121, 107, 0.25)',
                            borderRadius: '8px',
                            color: '#004d40',
                            fontSize: '0.85rem',
                            fontWeight: '700',
                            cursor: 'pointer',
                            padding: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px',
                          }}
                        >
                          <span>View Update</span>
                          <ChevronRight size={15} />
                        </button>
                      ) : isOpen ? (
                        <button
                          type="button"
                          onClick={() => handleOpenSubmitModal(sch)}
                          style={{
                            width: '100%',
                            backgroundColor: '#00796B',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '9px',
                            fontSize: '0.85rem',
                            fontWeight: '700',
                            cursor: 'pointer',
                          }}
                        >
                          Submit
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled
                          style={{
                            width: '100%',
                            backgroundColor: '#00796B',
                            color: '#ffffff',
                            opacity: 0.85,
                            border: 'none',
                            borderRadius: '8px',
                            padding: '9px',
                            fontSize: '0.85rem',
                            fontWeight: '700',
                            cursor: 'not-allowed',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                          }}
                        >
                          <Lock size={13} />
                          Submit
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Bottom helper text */}
          <div
            style={{
              textAlign: 'center',
              color: '#94a3b8',
              fontSize: '0.825rem',
              marginTop: '32px',
              padding: '0 12px',
            }}
          >
            You can submit each update only during its window
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: WORK UPDATES HISTORY & REPORT DOWNLOAD                            */}
      {/* ========================================================================= */}
      {activeTab === 'history' && (
        <div className="animate-fade-in" style={{ margin: '0 -20px' }}>
          <WorkUpdatesDrilldown
            initialEmployee={{
              uid: employee?.uid || employee?.id || 'me',
              name: employee?.name || 'My Work Updates',
              email: employee?.email || '',
            }}
            onExit={() => setActiveTab('today')}
          />
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: SUBMIT WORK UPDATE                                              */}
      {/* ========================================================================= */}
      {activeSchedule && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
            backdropFilter: 'blur(3px)',
          }}
          onClick={handleCloseSubmitModal}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '20px',
              maxWidth: '480px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: '800',
                    color: '#00796B',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Section {activeSchedule.section} &bull; {activeSchedule.submission_window_str}
                </span>
                <h3 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#0f172a', margin: '2px 0 0' }}>
                  {activeSchedule.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCloseSubmitModal}
                style={{
                  background: '#f1f5f9',
                  border: 'none',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#64748b',
                }}
              >
                <X size={18} />
              </button>
            </div>

            {modalError && (
              <div
                style={{
                  backgroundColor: '#fee2e2',
                  color: '#991b1b',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  marginBottom: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <AlertCircle size={16} />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: '16px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.85rem',
                    fontWeight: '700',
                    color: '#334155',
                    marginBottom: '6px',
                  }}
                >
                  Work Update Summary *
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="Describe the tasks, features or milestones completed during this period..."
                  value={updateText}
                  onChange={(e) => setUpdateText(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '10px',
                    border: '1.5px solid #cbd5e1',
                    fontSize: '0.9rem',
                    color: '#1e293b',
                    outline: 'none',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={handleCloseSubmitModal}
                  disabled={isSubmitting}
                  style={{
                    padding: '9px 18px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#475569',
                    fontSize: '0.85rem',
                    fontWeight: '700',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    padding: '9px 20px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#00796B',
                    color: '#ffffff',
                    fontSize: '0.85rem',
                    fontWeight: '700',
                    cursor: isSubmitting ? 'wait' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Send size={14} />
                      Submit Update
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: VIEW SUBMITTED UPDATE                                           */}
      {/* ========================================================================= */}
      {viewingSchedule && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
            backdropFilter: 'blur(3px)',
          }}
          onClick={() => setViewingSchedule(null)}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '20px',
              maxWidth: '480px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: '800',
                    color: '#15803d',
                    backgroundColor: '#dcfce7',
                    padding: '3px 10px',
                    borderRadius: '12px',
                  }}
                >
                  ✓ Submitted Today
                </span>
                <h3 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#0f172a', margin: '6px 0 0' }}>
                  {viewingSchedule.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setViewingSchedule(null)}
                style={{
                  background: '#f1f5f9',
                  border: 'none',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#64748b',
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '12px' }}>
              <div>Work Schedule: {viewingSchedule.work_schedule_str}</div>
              <div>Submission Window: {viewingSchedule.submission_window_str}</div>
            </div>

            <div
              style={{
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '14px 16px',
                marginBottom: '16px',
              }}
            >
              <div style={{ fontSize: '0.8rem', fontWeight: '800', color: '#004d40', marginBottom: '4px' }}>
                Your Submitted Update:
              </div>
              <div style={{ fontSize: '0.875rem', color: '#334155', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                {viewingSchedule.submission_details?.update ||
                  viewingSchedule.submission_details?.tasks_completed ||
                  viewingSchedule.submission_details?.tasksCompleted ||
                  'No update content recorded.'}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '10px' }}>
                Submitted: {viewingSchedule.submission_details?.submittedTime || 'Today'}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setViewingSchedule(null)}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#00796B',
                color: '#ffffff',
                fontWeight: '700',
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
