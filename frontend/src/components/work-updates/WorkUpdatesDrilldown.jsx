import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  ArrowLeft, Search, RefreshCw, Calendar, Download, 
  ChevronRight, AlertCircle, FileText, CheckCircle2, User, Clock,
  Grid, List
} from 'lucide-react';
import { workUpdateService } from '../../services/workUpdateService';

/**
 * WorkUpdatesDrilldown Component
 * Clean, professional horizontal layouts for all 3 screens:
 * 1. Employee Reports Screen: Compact horizontal cards with name, email, stats, and 'View Work History' on right.
 * 2. Daily Work History Screen: Horizontal date cards with date, submitted sections badge, and 'View Details' action.
 * 3. Daily Work Updates Details Screen: Horizontal cards for Sections 1-4 with schedule, window, description, timestamp, and aligned Download PDF.
 */
export default function WorkUpdatesDrilldown({ onExit, initialEmployee = null }) {
  // Navigation level: 'employees' | 'dates' | 'day_details'
  const [viewLevel, setViewLevel] = useState(initialEmployee ? 'dates' : 'employees');
  const [selectedEmployee, setSelectedEmployee] = useState(initialEmployee);
  const [selectedDate, setSelectedDate] = useState(null);

  // View mode for Screen 3: 'horizontal_rows' | 'horizontal_grid'
  const [detailsViewMode, setDetailsViewMode] = useState('horizontal_rows');

  // Data states
  const [employees, setEmployees] = useState([]);
  const [historyData, setHistoryData] = useState(null);
  const [dayData, setDayData] = useState(null);

  // Loading & error states
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // 1. Fetch Tier 1: Employees Summary
  const fetchEmployeesSummary = useCallback(async (silent = false) => {
    try {
      if (!silent) setIsLoading(true);
      else setIsRefreshing(true);
      setErrorMessage('');
      const data = await workUpdateService.getEmployeesSummary();
      setEmployees(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Failed to fetch work updates summary:', err);
      setErrorMessage(err.message || 'Could not load employees work updates summary');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // 2. Fetch Tier 2: Selected Employee History
  const fetchEmployeeHistory = useCallback(async (emp, silent = false) => {
    if (!emp) return;
    try {
      if (!silent) setIsLoading(true);
      else setIsRefreshing(true);
      setErrorMessage('');
      const identifier = emp.uid || emp.employeeId || emp.email;
      const data = await workUpdateService.getEmployeeHistory(identifier);
      setHistoryData(data);
    } catch (err) {
      console.warn('Failed to fetch employee history:', err);
      setErrorMessage(err.message || 'Could not load work history for employee');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // 3. Fetch Tier 3: Selected Day Updates
  const fetchDayUpdates = useCallback(async (emp, day, silent = false) => {
    if (!emp || !day) return;
    try {
      if (!silent) setIsLoading(true);
      else setIsRefreshing(true);
      setErrorMessage('');
      const identifier = emp.uid || emp.employeeId || emp.email;
      const dateStr = day.date || day;
      const data = await workUpdateService.getEmployeeDayUpdates(identifier, dateStr);
      setDayData(data);
    } catch (err) {
      console.warn('Failed to fetch day updates:', err);
      setErrorMessage(err.message || 'Could not load work updates for this day');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (initialEmployee) {
      setSelectedEmployee(initialEmployee);
      setViewLevel('dates');
      fetchEmployeeHistory(initialEmployee);
    } else {
      fetchEmployeesSummary();
    }
  }, [initialEmployee, fetchEmployeesSummary, fetchEmployeeHistory]);

  // Handle drill down to dates
  const handleSelectEmployee = (emp) => {
    setSelectedEmployee(emp);
    setViewLevel('dates');
    fetchEmployeeHistory(emp);
  };

  // Handle drill down to day details
  const handleSelectDate = (day) => {
    setSelectedDate(day);
    setViewLevel('day_details');
    fetchDayUpdates(selectedEmployee, day);
  };

  // Handle back navigation
  const handleBack = () => {
    if (viewLevel === 'day_details') {
      setViewLevel('dates');
      setDayData(null);
    } else if (viewLevel === 'dates') {
      if (initialEmployee && onExit) {
        onExit();
      } else {
        setViewLevel('employees');
        setSelectedEmployee(null);
        setHistoryData(null);
        fetchEmployeesSummary(true);
      }
    } else if (onExit) {
      onExit();
    }
  };

  // Filtered employees for Tier 1 search
  const filteredEmployees = useMemo(() => {
    if (!searchQuery.trim()) return employees;
    const q = searchQuery.toLowerCase().trim();
    return employees.filter(
      (e) =>
        (e.name || '').toLowerCase().includes(q) ||
        (e.email || '').toLowerCase().includes(q)
    );
  }, [employees, searchQuery]);

  // Handle Download PDF
  const handleDownloadPdf = () => {
    if (!dayData) return;
    const emp = dayData.employee || selectedEmployee || {};
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to download or print the PDF report.');
      return;
    }

    const sectionsHtml = (dayData.sections || [])
      .map(
        (sec) => `
        <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px 20px; margin-bottom: 16px; background-color: #ffffff; page-break-inside: avoid;">
          <div style="font-size: 16px; font-weight: 800; color: #004d40; margin-bottom: 6px;">
            Section: ${sec.section}
          </div>
          <div style="font-size: 13px; color: #64748b; line-height: 1.4;">
            Work Schedule: ${sec.workSchedule || '-'}
          </div>
          <div style="font-size: 13px; color: #64748b; margin-bottom: 12px; line-height: 1.4;">
            Submission Window: ${sec.submissionWindow || '-'}
          </div>
          <div style="font-size: 14px; font-weight: 800; color: #004d40; margin-bottom: 6px;">
            Work Update
          </div>
          <div style="font-size: 14px; color: #334155; line-height: 1.5; white-space: pre-wrap; background-color: #f8fafc; padding: 12px; border-radius: 8px;">
            ${sec.update || '-'}
          </div>
          <div style="font-size: 12px; color: #94a3b8; margin-top: 10px;">
            Submitted: ${sec.formattedSubmitted || sec.submittedTime || '-'}
          </div>
        </div>
      `
      )
      .join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Work Updates Report - ${emp.name || 'Employee'} - ${dayData.formattedDate || dayData.date}</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              margin: 32px;
              color: #1e293b;
              background-color: #ffffff;
            }
            .header-banner {
              background: linear-gradient(135deg, #004d40 0%, #00796b 100%);
              color: #ffffff;
              padding: 24px;
              border-radius: 14px;
              margin-bottom: 24px;
            }
            .emp-name {
              font-size: 24px;
              font-weight: 800;
              margin: 0;
            }
            .emp-email {
              font-size: 14px;
              color: rgba(255, 255, 255, 0.85);
              margin-top: 4px;
            }
            .report-info {
              display: flex;
              justify-content: space-between;
              align-items: center;
              border-bottom: 2px solid #00796b;
              padding-bottom: 12px;
              margin-bottom: 20px;
            }
            .date-title {
              font-size: 18px;
              font-weight: 800;
              color: #004d40;
            }
            .badge {
              background-color: #00796b;
              color: #ffffff;
              padding: 4px 12px;
              border-radius: 12px;
              font-size: 12px;
              font-weight: 700;
            }
            @media print {
              body { margin: 10mm; }
            }
          </style>
        </head>
        <body>
          <div class="header-banner">
            <div class="emp-name">${emp.name || 'Employee'}</div>
            <div class="emp-email">${emp.email || ''}</div>
          </div>
          <div class="report-info">
            <div class="date-title">${dayData.formattedDate || dayData.date}</div>
            <span class="badge">${dayData.sectionCount || 0} Sections Submitted</span>
          </div>
          ${sectionsHtml}
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div
      style={{
        maxWidth: '1160px',
        margin: '0 auto',
        backgroundColor: '#f8fafc',
        minHeight: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        paddingBottom: '48px',
      }}
    >
      {/* ========================================================================= */}
      {/* TOP HEADER BANNER (Widescreen Horizontal Responsive Design)               */}
      {/* ========================================================================= */}
      <div
        style={{
          background: 'linear-gradient(135deg, #00594C 0%, #00796B 50%, #004D40 100%)',
          color: '#ffffff',
          padding: '24px 28px 28px',
          borderBottomLeftRadius: '24px',
          borderBottomRightRadius: '24px',
          boxShadow: '0 8px 24px rgba(0, 77, 64, 0.22)',
          marginBottom: '24px',
        }}
      >
        {/* Navigation & Controls Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <button
            type="button"
            onClick={handleBack}
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* View level breadcrumb badge */}
            <span
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.22)',
                color: '#ffffff',
                borderRadius: '16px',
                padding: '6px 16px',
                fontSize: '0.725rem',
                fontWeight: '700',
                letterSpacing: '0.6px',
                textTransform: 'uppercase',
              }}
            >
              {viewLevel === 'employees' && 'EMPLOYEE REPORTS'}
              {viewLevel === 'dates' && 'DAILY WORK HISTORY'}
              {viewLevel === 'day_details' && 'DAILY WORK UPDATE DETAILS'}
            </span>

            {/* Refresh button */}
            <button
              type="button"
              onClick={() => {
                if (viewLevel === 'employees') fetchEmployeesSummary(true);
                else if (viewLevel === 'dates') fetchEmployeeHistory(selectedEmployee, true);
                else if (viewLevel === 'day_details') fetchDayUpdates(selectedEmployee, selectedDate, true);
              }}
              title="Refresh Data"
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
                transition: 'background-color 0.2s',
              }}
            >
              <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Dynamic Title and Subtitle */}
        {viewLevel === 'employees' ? (
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: '800', margin: '0 0 4px', letterSpacing: '-0.3px' }}>
              Work Updates Dashboard
            </h1>
            <p style={{ fontSize: '0.9rem', color: 'rgba(255, 255, 255, 0.88)', margin: 0, fontWeight: '400' }}>
              Employee work reports, submission progress and daily standup history
            </p>
          </div>
        ) : (
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: '800', margin: '0 0 4px', letterSpacing: '-0.3px' }}>
              {selectedEmployee?.name || 'Employee'}
            </h1>
            <p style={{ fontSize: '0.9rem', color: 'rgba(255, 255, 255, 0.88)', margin: 0, fontWeight: '400' }}>
              {selectedEmployee?.email || ''}
            </p>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div style={{ padding: 0 }}>
        {/* Error notification if any */}
        {errorMessage && (
          <div
            style={{
              backgroundColor: '#fee2e2',
              color: '#991b1b',
              padding: '12px 18px',
              borderRadius: '12px',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '20px',
            }}
          >
            <AlertCircle size={16} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Loading Spinner */}
        {isLoading && (
          <div style={{ textAlign: 'center', padding: '64px 0', color: '#00796B' }}>
            <RefreshCw size={32} className="animate-spin" style={{ margin: '0 auto 12px' }} />
            <div style={{ fontSize: '0.95rem', fontWeight: '600', color: '#475569' }}>Loading work updates...</div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SCREEN 1: EMPLOYEE REPORTS (Clean Horizontal Cards)                      */}
        {/* ========================================================================= */}
        {!isLoading && viewLevel === 'employees' && (
          <div className="animate-fade-in">
            {/* Header Toolbar: Employee Updates Title + Search Bar + Pill Badge */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '16px',
                marginBottom: '18px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h2 style={{ fontSize: '1.35rem', fontWeight: '800', color: '#0f2922', margin: 0 }}>
                  Employee Updates
                </h2>
                <span
                  style={{
                    backgroundColor: '#00796B',
                    color: '#ffffff',
                    borderRadius: '16px',
                    padding: '4px 14px',
                    fontSize: '0.78rem',
                    fontWeight: '700',
                  }}
                >
                  {employees.length} Employees
                </span>
              </div>

              {/* Quick Search */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '10px',
                  padding: '8px 16px',
                  minWidth: 'min(100%, 280px)',
                  maxWidth: '100%',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                }}
              >
                <Search size={16} color="#94a3b8" />
                <input
                  type="text"
                  placeholder="Search by employee name or email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    border: 'none',
                    outline: 'none',
                    fontSize: '0.875rem',
                    width: '100%',
                    color: '#1e293b',
                    backgroundColor: 'transparent',
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem' }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Employee Cards List - Professional Compact Horizontal Layout */}
            {filteredEmployees.length === 0 ? (
              <div
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '16px',
                  padding: '48px 24px',
                  textAlign: 'center',
                  color: '#64748b',
                  fontSize: '0.95rem',
                  border: '1px solid #e2e8f0',
                }}
              >
                No employees matching "{searchQuery}"
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {filteredEmployees.map((emp) => (
                  <div
                    key={emp.uid || emp.email}
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: '14px',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                      padding: '16px 22px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '20px',
                      flexWrap: 'wrap',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#00796B';
                      e.currentTarget.style.boxShadow = '0 6px 18px rgba(0, 121, 107, 0.08)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#e2e8f0';
                      e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.03)';
                    }}
                  >
                    {/* Left: Avatar Badge & Employee Name/Email */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: '1 1 260px', minWidth: 'min(100%, 220px)' }}>
                      <div
                        style={{
                          width: '44px',
                          height: '44px',
                          borderRadius: '12px',
                          backgroundColor: '#e6f4ea',
                          color: '#00594C',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1.15rem',
                          fontWeight: '800',
                          flexShrink: 0,
                        }}
                      >
                        {(emp.name || 'E').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontSize: '1.05rem', fontWeight: '800', color: '#004d40', lineHeight: 1.25 }}>
                          {emp.name || emp.employeeName}
                        </div>
                        <div style={{ fontSize: '0.825rem', color: '#64748b', marginTop: '2px' }}>
                          {emp.email || emp.employeeEmail}
                        </div>
                      </div>
                    </div>

                    {/* Middle: Horizontal Arrangement for Updates & Latest Date */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '28px',
                        flex: '1 1 300px',
                        minWidth: 'min(100%, 240px)',
                      }}
                    >
                      {/* Total Submitted Updates */}
                      <div>
                        <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Total Submitted
                        </div>
                        <div style={{ fontSize: '0.925rem', fontWeight: '800', color: '#0f172a', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ color: '#00796B' }}>●</span>
                          <span>{emp.totalSubmittedUpdates || 0} Updates</span>
                        </div>
                      </div>

                      {/* Latest Update */}
                      <div>
                        <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Latest Update
                        </div>
                        <div style={{ fontSize: '0.9rem', fontWeight: '700', color: '#334155', marginTop: '2px' }}>
                          {emp.latestUpdate || 'No updates yet'}
                        </div>
                      </div>

                      {/* Work Days Count */}
                      <div>
                        <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Work Days
                        </div>
                        <div style={{ fontSize: '0.9rem', fontWeight: '700', color: '#334155', marginTop: '2px' }}>
                          {emp.workDaysCount || 0} Days
                        </div>
                      </div>
                    </div>

                    {/* Right: View Work History Button */}
                    <div style={{ flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => handleSelectEmployee(emp)}
                        style={{
                          backgroundColor: '#00796B',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '10px 20px',
                          fontWeight: '700',
                          fontSize: '0.85rem',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          boxShadow: '0 2px 6px rgba(0, 121, 107, 0.2)',
                          transition: 'all 0.2s',
                          whiteSpace: 'nowrap',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#00594C')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#00796B')}
                      >
                        <span>View Work History</span>
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* SCREEN 2: DAILY WORK HISTORY (Horizontal Date Cards)                     */}
        {/* ========================================================================= */}
        {!isLoading && viewLevel === 'dates' && (
          <div className="animate-fade-in">
            {/* Section Header Row */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '18px',
              }}
            >
              <h2 style={{ fontSize: '1.35rem', fontWeight: '800', color: '#0f2922', margin: 0 }}>
                Select Work Date
              </h2>
              <span
                style={{
                  backgroundColor: '#00796B',
                  color: '#ffffff',
                  borderRadius: '16px',
                  padding: '5px 16px',
                  fontSize: '0.78rem',
                  fontWeight: '700',
                }}
              >
                {historyData?.totalWorkDays || (historyData?.workDays || []).length} Work Days
              </span>
            </div>

            {/* Horizontal Date Cards Arrangement */}
            {(!historyData?.workDays || historyData.workDays.length === 0) ? (
              <div
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '16px',
                  padding: '48px 24px',
                  textAlign: 'center',
                  color: '#64748b',
                  fontSize: '0.95rem',
                  border: '1px solid #e2e8f0',
                }}
              >
                No work updates submitted yet for {selectedEmployee?.name || 'this employee'}.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {historyData.workDays.map((day) => (
                  <div
                    key={day.date}
                    onClick={() => handleSelectDate(day)}
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: '14px',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                      padding: '16px 22px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '20px',
                      flexWrap: 'wrap',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#00796B';
                      e.currentTarget.style.boxShadow = '0 6px 18px rgba(0, 121, 107, 0.08)';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#e2e8f0';
                      e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.03)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    {/* Left: Calendar Icon + Date */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div
                        style={{
                          width: '42px',
                          height: '42px',
                          borderRadius: '10px',
                          backgroundColor: '#e6f4ea',
                          color: '#00796B',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <Calendar size={18} />
                      </div>
                      <div>
                        <div style={{ fontSize: '1.08rem', fontWeight: '800', color: '#00796B' }}>
                          {day.formattedDate || day.date}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                          {day.date}
                        </div>
                      </div>
                    </div>

                    {/* Middle: Submitted Sections Badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          backgroundColor: '#e6f4ea',
                          color: '#00594C',
                          borderRadius: '14px',
                          padding: '6px 16px',
                          fontSize: '0.825rem',
                          fontWeight: '700',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <CheckCircle2 size={14} color="#00796B" />
                        <span>{day.sectionCount || day.sectionsSubmitted || 0} submitted sections</span>
                      </span>
                    </div>

                    {/* Right: View Updates Action Button */}
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '0.85rem',
                        fontWeight: '700',
                        color: '#00796B',
                        backgroundColor: '#f0fdf9',
                        border: '1px solid rgba(0, 121, 107, 0.25)',
                        borderRadius: '8px',
                        padding: '9px 18px',
                        transition: 'all 0.2s',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span>View Updates</span>
                      <ChevronRight size={15} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* SCREEN 3: DAILY WORK UPDATES DETAILS (Horizontal Section Cards)          */}
        {/* ========================================================================= */}
        {!isLoading && viewLevel === 'day_details' && (
          <div className="animate-fade-in">
            {/* Header: Date Title, Sections Count, View Mode Switcher & Download PDF Button */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '16px',
                marginBottom: '20px',
                padding: '0 4px',
              }}
            >
              <div>
                <h2 style={{ fontSize: '1.35rem', fontWeight: '800', color: '#00796B', margin: '0 0 4px' }}>
                  {dayData?.formattedDate || dayData?.date || selectedDate?.formattedDate || selectedDate?.date}
                </h2>
                <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  {dayData?.sectionCount || (dayData?.sections || []).length || 0} Sections Submitted for this Day
                </div>
              </div>

              {/* Action Toolbar: View Mode Toggle & Properly Aligned Download PDF */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* View Mode Toggle: Row vs Grid */}
                <div style={{ display: 'flex', backgroundColor: '#e2e8f0', borderRadius: '8px', padding: '2px' }}>
                  <button
                    type="button"
                    onClick={() => setDetailsViewMode('horizontal_rows')}
                    title="Horizontal Row Cards"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '0.75rem',
                      fontWeight: '700',
                      backgroundColor: detailsViewMode === 'horizontal_rows' ? '#ffffff' : 'transparent',
                      color: detailsViewMode === 'horizontal_rows' ? '#004d40' : '#64748b',
                      cursor: 'pointer',
                    }}
                  >
                    <List size={14} />
                    <span>Rows</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailsViewMode('horizontal_grid')}
                    title="Horizontal 4-Column Grid Cards"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '0.75rem',
                      fontWeight: '700',
                      backgroundColor: detailsViewMode === 'horizontal_grid' ? '#ffffff' : 'transparent',
                      color: detailsViewMode === 'horizontal_grid' ? '#004d40' : '#64748b',
                      cursor: 'pointer',
                    }}
                  >
                    <Grid size={14} />
                    <span>Grid</span>
                  </button>
                </div>

                {/* Download PDF Button */}
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  style={{
                    backgroundColor: '#00796B',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '9px 18px',
                    fontSize: '0.85rem',
                    fontWeight: '700',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 2px 6px rgba(0, 121, 107, 0.25)',
                    transition: 'background-color 0.2s',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#00594C')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#00796B')}
                >
                  <Download size={15} />
                  Download PDF
                </button>
              </div>
            </div>

            {/* Individual Section Cards - Clean Responsive Horizontal Arrangement */}
            {(!dayData?.sections || dayData.sections.length === 0) ? (
              <div
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '16px',
                  padding: '48px 24px',
                  textAlign: 'center',
                  color: '#64748b',
                  fontSize: '0.95rem',
                  border: '1px solid #e2e8f0',
                }}
              >
                No sections recorded for this date.
              </div>
            ) : detailsViewMode === 'horizontal_rows' ? (
              /* Style A: Wide Horizontal Row Cards */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {dayData.sections.map((sec, idx) => (
                  <div
                    key={sec.id || idx}
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: '14px',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                      padding: '18px 22px',
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: '24px',
                      flexWrap: 'wrap',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#00796B';
                      e.currentTarget.style.boxShadow = '0 6px 18px rgba(0, 121, 107, 0.08)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#e2e8f0';
                      e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.03)';
                    }}
                  >
                    {/* Left Column: Section Badge, Schedule & Submission Window */}
                    <div style={{ flex: '0 1 240px', minWidth: 'min(100%, 200px)' }}>
                      <div
                        style={{
                          display: 'inline-block',
                          backgroundColor: '#e6f4ea',
                          color: '#00594C',
                          borderRadius: '8px',
                          padding: '4px 12px',
                          fontSize: '0.85rem',
                          fontWeight: '800',
                          marginBottom: '10px',
                        }}
                      >
                        Section: {sec.section || idx + 1}
                      </div>
                      <div style={{ fontSize: '0.825rem', color: '#64748b', lineHeight: 1.5 }}>
                        <div><strong style={{ color: '#334155' }}>Work Schedule:</strong> {sec.workSchedule || '-'}</div>
                        <div><strong style={{ color: '#334155' }}>Window:</strong> {sec.submissionWindow || '-'}</div>
                      </div>
                    </div>

                    {/* Middle Column: Work Update Description */}
                    <div style={{ flex: '1 1 340px', minWidth: 'min(100%, 260px)' }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: '800', color: '#004d40', marginBottom: '6px' }}>
                        Work Update
                      </div>
                      <div
                        style={{
                          fontSize: '0.875rem',
                          color: '#1e293b',
                          lineHeight: 1.5,
                          whiteSpace: 'pre-wrap',
                          backgroundColor: '#f8fafc',
                          border: '1px solid #f1f5f9',
                          borderRadius: '10px',
                          padding: '12px 14px',
                        }}
                      >
                        {sec.update || '-'}
                      </div>
                    </div>

                    {/* Right Column: Submitted Timestamp */}
                    <div style={{ flex: '1 1 160px', textAlign: 'right', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <span style={{ fontSize: '0.725rem', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Submitted At
                      </span>
                      <span style={{ fontSize: '0.825rem', fontWeight: '600', color: '#475569', marginTop: '2px' }}>
                        {sec.formattedSubmitted || sec.submittedTime || 'Today'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Style B: Horizontal 4-Column Responsive Grid (Section 1 to 4 Side-by-Side) */
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                  gap: '16px',
                }}
              >
                {dayData.sections.map((sec, idx) => (
                  <div
                    key={sec.id || idx}
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: '14px',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                      padding: '18px 20px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#00796B';
                      e.currentTarget.style.boxShadow = '0 6px 18px rgba(0, 121, 107, 0.08)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#e2e8f0';
                      e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.03)';
                    }}
                  >
                    <div>
                      {/* Section Number Header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span
                          style={{
                            backgroundColor: '#e6f4ea',
                            color: '#00594C',
                            borderRadius: '6px',
                            padding: '3px 10px',
                            fontSize: '0.825rem',
                            fontWeight: '800',
                          }}
                        >
                          Section: {sec.section || idx + 1}
                        </span>
                      </div>

                      {/* Schedule & Window */}
                      <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '10px', lineHeight: 1.4 }}>
                        <div><strong>Schedule:</strong> {sec.workSchedule || '-'}</div>
                        <div><strong>Window:</strong> {sec.submissionWindow || '-'}</div>
                      </div>

                      {/* Work Update Text */}
                      <div style={{ fontSize: '0.85rem', fontWeight: '800', color: '#004d40', marginBottom: '4px' }}>
                        Work Update
                      </div>
                      <div
                        style={{
                          fontSize: '0.85rem',
                          color: '#334155',
                          lineHeight: 1.45,
                          whiteSpace: 'pre-wrap',
                          backgroundColor: '#f8fafc',
                          padding: '10px 12px',
                          borderRadius: '8px',
                          border: '1px solid #f1f5f9',
                          minHeight: '80px',
                        }}
                      >
                        {sec.update || '-'}
                      </div>
                    </div>

                    {/* Timestamp Footer */}
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '12px', borderTop: '1px solid #f1f5f9', paddingTop: '8px' }}>
                      Submitted: {sec.formattedSubmitted || sec.submittedTime || 'Today'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
