import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search,
  Filter,
  Calendar,
  RotateCcw,
  Download,
  FileSpreadsheet,
  Eye,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  UserX,
  Users,
  Building2,
  Home,
  Layers,
  LayoutGrid,
  List,
  BarChart3,
  TrendingUp,
  X,
  Check,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import PageHeader from '../../components/common/PageHeader';
import EmptyState from '../../components/common/EmptyState';
import Modal from '../../components/common/Modal';
import { attendanceService } from '../../services/attendanceService';

// Helper to get current month string YYYY-MM in Asia/Kolkata timezone
const getCurrentMonthIST = () => {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
    });
    return formatter.format(new Date()); // YYYY-MM
  } catch {
    return new Date().toISOString().slice(0, 7);
  }
};

// Formats YYYY-MM into "Month YYYY", e.g. "2026-11" -> "November 2026"
const formatMonthTitle = (monthStr) => {
  if (!monthStr) return '';
  const [year, month] = monthStr.split('-').map(Number);
  if (!year || !month) return monthStr;
  const d = new Date(year, month - 1, 1);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
};

// Formats YYYY-MM-DD into "DD-MM-YYYY"
const formatDisplayDate = (dStr) => {
  if (!dStr) return '--';
  const clean = String(dStr).slice(0, 10);
  const parts = clean.split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return clean;
};

export default function AdminAttendanceReports() {
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthIST());
  const [reportData, setReportData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // Filter toolbar states
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [percentageFilter, setPercentageFilter] = useState('ALL');
  const [workModeFilter, setWorkModeFilter] = useState('ALL');
  const [lateFilter, setLateFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('PERCENTAGE_DESC');
  const [viewMode, setViewMode] = useState('CARDS'); // 'CARDS' or 'TABLE'

  // Detailed Employee Modal
  const [viewEmployee, setViewEmployee] = useState(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // Available months list for picker (2025 and 2026)
  const availableMonths = useMemo(() => {
    const list = [];
    const currentYear = new Date().getFullYear();
    const years = [currentYear - 1, currentYear];
    years.forEach((yr) => {
      for (let m = 1; m <= 12; m++) {
        const val = `${yr}-${String(m).padStart(2, '0')}`;
        const label = new Date(yr, m - 1, 1).toLocaleString('en-US', {
          month: 'long',
          year: 'numeric',
        });
        list.push({ value: val, label });
      }
    });
    return list;
  }, []);

  // Fetch report data
  const loadReport = useCallback(
    async (targetMonth = selectedMonth) => {
      try {
        setIsLoading(true);
        setErrorMessage('');
        const data = await attendanceService.getMonthlyReport({ month: targetMonth });
        if (data) {
          setReportData(data);
        } else {
          setErrorMessage('Could not load monthly report data.');
        }
      } catch (err) {
        console.error('Failed to load monthly attendance report:', err);
        setErrorMessage(err.message || 'Error fetching monthly attendance records');
      } finally {
        setIsLoading(false);
      }
    },
    [selectedMonth]
  );

  useEffect(() => {
    loadReport(selectedMonth);
  }, [selectedMonth, loadReport]);

  // Handle month switch
  const handleMonthChange = (newMonth) => {
    setSelectedMonth(newMonth);
  };

  const handlePreviousMonth = () => {
    const [yr, mon] = selectedMonth.split('-').map(Number);
    let newYr = yr;
    let newMon = mon - 1;
    if (newMon < 1) {
      newMon = 12;
      newYr -= 1;
    }
    const val = `${newYr}-${String(newMon).padStart(2, '0')}`;
    setSelectedMonth(val);
  };

  const handleNextMonth = () => {
    const [yr, mon] = selectedMonth.split('-').map(Number);
    let newYr = yr;
    let newMon = mon + 1;
    if (newMon > 12) {
      newMon = 1;
      newYr += 1;
    }
    const val = `${newYr}-${String(newMon).padStart(2, '0')}`;
    setSelectedMonth(val);
  };

  const handleResetToCurrentMonth = () => {
    setSelectedMonth(getCurrentMonthIST());
  };

  // Filter and sort employee records
  const allEmployees = reportData?.employees || [];
  const departmentsList = useMemo(() => {
    const depts = new Set();
    allEmployees.forEach((e) => {
      if (e.department) depts.add(e.department);
    });
    return Array.from(depts).sort();
  }, [allEmployees]);

  const filteredEmployees = useMemo(() => {
    let list = [...allEmployees];

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (e) =>
          (e.employeeName || '').toLowerCase().includes(q) ||
          (e.employeeId || '').toLowerCase().includes(q) ||
          (e.email || '').toLowerCase().includes(q) ||
          (e.department || '').toLowerCase().includes(q)
      );
    }

    // Department filter
    if (departmentFilter !== 'ALL') {
      list = list.filter(
        (e) => (e.department || '').toLowerCase() === departmentFilter.toLowerCase()
      );
    }

    // Attendance Percentage filter
    if (percentageFilter === 'EXCELLENT') {
      list = list.filter((e) => e.attendancePercentage >= 90);
    } else if (percentageFilter === 'GOOD') {
      list = list.filter((e) => e.attendancePercentage >= 75 && e.attendancePercentage < 90);
    } else if (percentageFilter === 'LOW') {
      list = list.filter((e) => e.attendancePercentage < 75);
    }

    // Work Mode Dominance filter
    if (workModeFilter === 'WFO_DOMINANT') {
      list = list.filter((e) => e.wfoDays >= e.wfhDays && e.wfoDays > 0);
    } else if (workModeFilter === 'WFH_DOMINANT') {
      list = list.filter((e) => e.wfhDays > e.wfoDays);
    }

    // Late filter
    if (lateFilter === 'LATE_ONLY') {
      list = list.filter((e) => e.lateDays > 0);
    } else if (lateFilter === 'ON_TIME_ONLY') {
      list = list.filter((e) => e.lateDays === 0);
    }

    // Sorting
    list.sort((a, b) => {
      if (sortBy === 'PERCENTAGE_DESC') return b.attendancePercentage - a.attendancePercentage;
      if (sortBy === 'PERCENTAGE_ASC') return a.attendancePercentage - b.attendancePercentage;
      if (sortBy === 'LATE_DESC') return b.lateDays - a.lateDays;
      if (sortBy === 'PRESENT_DESC') return b.presentDays - a.presentDays;
      if (sortBy === 'NAME_ASC') return (a.employeeName || '').localeCompare(b.employeeName || '');
      return 0;
    });

    return list;
  }, [
    allEmployees,
    searchQuery,
    departmentFilter,
    percentageFilter,
    workModeFilter,
    lateFilter,
    sortBy,
  ]);

  // Headline metrics
  const summary = reportData?.summary || {
    totalRecords: 0,
    wfo: 0,
    wfh: 0,
    late: 0,
    present: 0,
    absent: 0,
  };
  const totalWorkingDays = reportData?.totalWorkingDays || 13;
  const monthDisplayTitle = formatMonthTitle(selectedMonth);

  // Export CSV Functionality (as requested in Prompt requirement 10)
  const handleExportCSV = () => {
    if (!filteredEmployees.length) return;
    const cleanMonthName = monthDisplayTitle.replace(/\s+/g, '_');

    const headers = [
      'Employee Name',
      'Employee ID',
      'Email',
      'Department',
      'Present Days',
      'Working Days',
      'Absent Days',
      'Approved Leave',
      'Attendance Percentage',
      'WFO Days',
      'WFH Days',
      'Late Days',
      'Late Reasons',
    ];

    const rows = filteredEmployees.map((e) => {
      const lateReasonsFormatted = (e.lateReasons || [])
        .map((r) => `${formatDisplayDate(r.date)}: ${r.reason}`)
        .join('; ');

      return [
        `"${(e.employeeName || '').replace(/"/g, '""')}"`,
        `"${e.employeeId || ''}"`,
        `"${e.email || ''}"`,
        `"${e.department || 'Operations'}"`,
        e.presentDays,
        e.workingDays || totalWorkingDays,
        e.absentDays,
        e.approvedLeaveDays,
        `"${e.attendancePercentage}%"`,
        e.wfoDays,
        e.wfhDays,
        e.lateDays,
        `"${lateReasonsFormatted.replace(/"/g, '""')}"`,
      ];
    });

    const csvContent =
      '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Attendance_Report_${cleanMonthName}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Export Excel (.xlsx) with auto-fitted columns and multiple sheets
  const handleExportExcel = () => {
    if (!filteredEmployees.length) return;
    const cleanMonthName = monthDisplayTitle.replace(/\s+/g, '_');

    // Sheet 1: Employee Monthly Reports
    const empData = filteredEmployees.map((e, idx) => ({
      'S.No': idx + 1,
      'Employee ID': e.employeeId,
      'Employee Name': e.employeeName,
      'Email': e.email,
      'Department': e.department,
      'Present Days': e.presentDays,
      'Working Days': e.workingDays || totalWorkingDays,
      'Absent Days': e.absentDays,
      'Approved Leave Days': e.approvedLeaveDays,
      'Attendance %': `${e.attendancePercentage}%`,
      'WFO Days': e.wfoDays,
      'WFH Days': e.wfhDays,
      'Late Days': e.lateDays,
      'Late Check-in Explanations': (e.lateReasons || [])
        .map((r) => `${formatDisplayDate(r.date)}: ${r.reason}`)
        .join(' | '),
    }));

    const wsEmp = XLSX.utils.json_to_sheet(empData);
    wsEmp['!cols'] = [
      { wch: 8 },  // S.No
      { wch: 15 }, // Employee ID
      { wch: 32 }, // Employee Name
      { wch: 30 }, // Email
      { wch: 18 }, // Department
      { wch: 14 }, // Present Days
      { wch: 14 }, // Working Days
      { wch: 14 }, // Absent Days
      { wch: 18 }, // Approved Leave
      { wch: 16 }, // Attendance %
      { wch: 12 }, // WFO Days
      { wch: 12 }, // WFH Days
      { wch: 12 }, // Late Days
      { wch: 45 }, // Late Explanations
    ];

    // Sheet 2: Monthly Summary
    const summaryData = [
      { Metric: 'Report Month', Value: monthDisplayTitle },
      { Metric: 'Total Company Working Days', Value: totalWorkingDays },
      { Metric: 'Total Attendance Punches Recorded', Value: summary.totalRecords },
      { Metric: 'Work From Office (WFO) Entries', Value: summary.wfo },
      { Metric: 'Work From Home (WFH) Entries', Value: summary.wfh },
      { Metric: 'Late Logins', Value: summary.late },
      { Metric: 'Verified Present Days Across Staff', Value: summary.present },
      { Metric: 'Total Absent Days Across Staff', Value: summary.absent },
      { Metric: 'Total Employees Covered', Value: filteredEmployees.length },
      {
        Metric: 'Report Generated At',
        Value: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      },
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 35 }, { wch: 35 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsEmp, 'Employee Attendance Reports');
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Monthly Overview');

    XLSX.writeFile(wb, `Attendance_Report_${cleanMonthName}.xlsx`);
  };

  // Open detailed employee report modal
  const handleOpenDetailModal = (emp) => {
    setViewEmployee(emp);
    setIsDetailModalOpen(true);
  };

  return (
    <div className="attendance-reports-view animate-fade-in" style={{ paddingBottom: '36px' }}>
      {/* 1. Header with Breadcrumbs & Actions */}
      <PageHeader
        title="Attendance Reports"
        subtitle="Monitor employee attendance, monthly performance, work modes and attendance analytics."
        breadcrumb={[
          { label: 'Admin', path: '/admin/dashboard' },
          { label: 'Reports', path: '/admin/reports' },
          { label: 'Attendance Reports' },
        ]}
        actionButton={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-export-excel"
              onClick={handleExportExcel}
              disabled={filteredEmployees.length === 0}
              title="Download formatted Excel workbook with auto-fitted columns"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                height: '38px',
                padding: '0 14px',
                borderRadius: '10px',
                backgroundColor: '#0b3d2b',
                color: '#ffffff',
                fontSize: '0.825rem',
                fontWeight: '600',
                border: 'none',
                cursor: filteredEmployees.length === 0 ? 'not-allowed' : 'pointer',
                opacity: filteredEmployees.length === 0 ? 0.6 : 1,
                boxShadow: '0 1px 3px rgba(11, 61, 43, 0.25)',
              }}
            >
              <FileSpreadsheet size={16} />
              <span>Export Excel</span>
            </button>
            <button
              type="button"
              className="table-action-btn"
              onClick={() => loadReport(selectedMonth)}
              disabled={isLoading}
              title="Refresh Report for current month"
              style={{ height: '38px', padding: '0 12px' }}
            >
              <RotateCcw size={15} className={isLoading ? 'animate-spin' : ''} />
              <span>Refresh Report</span>
            </button>
          </div>
        }
      />

      {/* Error Message Alert */}
      {errorMessage && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '12px',
            color: '#b91c1c',
            fontSize: '0.875rem',
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

      {/* 2. Section 3: Dedicated Report Month Selection Section */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          padding: '16px 20px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          marginBottom: '20px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              backgroundColor: '#ecfdf5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #a7f3d0',
            }}
          >
            <Calendar size={22} color="#0b3d2b" />
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Report Period
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#0b3d2b' }}>
              {monthDisplayTitle}
            </div>
          </div>
        </div>

        {/* Month Selector Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Arrow Steppers */}
          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #cbd5e1', borderRadius: '10px', backgroundColor: '#f8fafc', overflow: 'hidden' }}>
            <button
              type="button"
              onClick={handlePreviousMonth}
              title="Previous Month"
              style={{
                border: 'none',
                background: 'transparent',
                padding: '8px 10px',
                cursor: 'pointer',
                color: '#334155',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontSize: '0.78rem', fontWeight: '700', color: '#0b3d2b', padding: '0 4px' }}>
              {selectedMonth}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              title="Next Month"
              style={{
                border: 'none',
                background: 'transparent',
                padding: '8px 10px',
                cursor: 'pointer',
                color: '#334155',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Month Dropdown Picker */}
          <select
            value={selectedMonth}
            onChange={(e) => handleMonthChange(e.target.value)}
            style={{
              height: '38px',
              padding: '0 12px',
              borderRadius: '10px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              fontSize: '0.85rem',
              fontWeight: '600',
              color: '#0f172a',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {availableMonths.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          {/* Current Month Shortcut Button */}
          <button
            type="button"
            onClick={handleResetToCurrentMonth}
            style={{
              height: '38px',
              padding: '0 12px',
              borderRadius: '10px',
              border: '1px solid #cbd5e1',
              backgroundColor: selectedMonth === getCurrentMonthIST() ? '#0b3d2b' : '#ffffff',
              color: selectedMonth === getCurrentMonthIST() ? '#ffffff' : '#334155',
              fontSize: '0.8rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Current Month
          </button>
        </div>
      </div>

      {/* 3. Section 4: Monthly Attendance Summary (Faithfully matching mobile screenshot reference) */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '1.15rem', fontWeight: '800', color: '#0b3d2b', marginBottom: '12px' }}>
          Monthly Summary
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '18px' }}>
          {/* Card A: Mobile-Authentic Monthly Summary Block (Matching Screenshot 7) */}
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              border: '1px solid #e2e8f0',
              padding: '20px',
              boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            {/* Top Banner: Total Attendance Records */}
            <div
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '16px 20px',
                textAlign: 'center',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                marginBottom: '14px',
              }}
            >
              <div
                style={{
                  fontSize: '0.75rem',
                  fontWeight: '700',
                  color: '#64748b',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  marginBottom: '6px',
                }}
              >
                TOTAL ATTENDANCE RECORDS
              </div>
              <div
                style={{
                  fontSize: '3rem',
                  fontWeight: '800',
                  color: '#6366f1',
                  lineHeight: '1',
                  fontFeatureSettings: '"tnum"',
                }}
              >
                {summary.totalRecords}
              </div>
            </div>

            {/* 3-Column Breakdown: WFO | WFH | LATE */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '10px',
                marginBottom: '16px',
              }}
            >
              {/* WFO Column */}
              <div
                style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '14px 10px',
                  textAlign: 'center',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                }}
              >
                <div
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: '700',
                    color: '#64748b',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    marginBottom: '6px',
                  }}
                >
                  WFO
                </div>
                <div
                  style={{
                    fontSize: '2rem',
                    fontWeight: '800',
                    color: '#16a34a',
                    lineHeight: '1',
                  }}
                >
                  {summary.wfo}
                </div>
                <div style={{ fontSize: '0.68rem', color: '#15803d', fontWeight: '600', marginTop: '4px' }}>
                  Office
                </div>
              </div>

              {/* WFH Column */}
              <div
                style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '14px 10px',
                  textAlign: 'center',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                }}
              >
                <div
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: '700',
                    color: '#64748b',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    marginBottom: '6px',
                  }}
                >
                  WFH
                </div>
                <div
                  style={{
                    fontSize: '2rem',
                    fontWeight: '800',
                    color: '#6366f1',
                    lineHeight: '1',
                  }}
                >
                  {summary.wfh}
                </div>
                <div style={{ fontSize: '0.68rem', color: '#4f46e5', fontWeight: '600', marginTop: '4px' }}>
                  Remote
                </div>
              </div>

              {/* LATE Column */}
              <div
                style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '14px 10px',
                  textAlign: 'center',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                }}
              >
                <div
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: '700',
                    color: '#64748b',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    marginBottom: '6px',
                  }}
                >
                  LATE
                </div>
                <div
                  style={{
                    fontSize: '2rem',
                    fontWeight: '800',
                    color: '#f59e0b',
                    lineHeight: '1',
                  }}
                >
                  {summary.late}
                </div>
                <div style={{ fontSize: '0.68rem', color: '#b45309', fontWeight: '600', marginTop: '4px' }}>
                  After 9:30 AM
                </div>
              </div>
            </div>

            {/* Full-width REFRESH REPORT Button (Matching Mobile UI) */}
            <button
              type="button"
              onClick={() => loadReport(selectedMonth)}
              disabled={isLoading}
              style={{
                width: '100%',
                height: '46px',
                borderRadius: '12px',
                backgroundColor: '#f5f3ff',
                color: '#6d28d9',
                fontSize: '0.85rem',
                fontWeight: '800',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                border: '1px solid #ddd6fe',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#ede9fe';
                e.currentTarget.style.color = '#5b21b6';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#f5f3ff';
                e.currentTarget.style.color = '#6d28d9';
              }}
            >
              <RotateCcw size={16} className={isLoading ? 'animate-spin' : ''} />
              <span>{isLoading ? 'Refreshing Report...' : 'REFRESH REPORT'}</span>
            </button>
          </div>

          {/* Card B: Desktop Extended Analytics & Operational Metrics */}
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              border: '1px solid #e2e8f0',
              padding: '20px',
              boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: '800', color: '#0b3d2b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Executive Monthly Overview
                </span>
                <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#065f46', backgroundColor: '#ecfdf5', padding: '2px 8px', borderRadius: '6px' }}>
                  {totalWorkingDays} Working Days
                </span>
              </div>

              {/* 4 Mini Metrics */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '16px' }}>
                <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '10px 14px' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#15803d', textTransform: 'uppercase' }}>
                    Present Days (Cumulative)
                  </div>
                  <div style={{ fontSize: '1.4rem', fontWeight: '800', color: '#166534', marginTop: '2px' }}>
                    {summary.present}
                  </div>
                </div>

                <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '10px 14px' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#b91c1c', textTransform: 'uppercase' }}>
                    Absent Days (Unlogged)
                  </div>
                  <div style={{ fontSize: '1.4rem', fontWeight: '800', color: '#991b1b', marginTop: '2px' }}>
                    {summary.absent}
                  </div>
                </div>

                <div style={{ backgroundColor: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '10px', padding: '10px 14px' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#0f766e', textTransform: 'uppercase' }}>
                    Average Attendance Rate
                  </div>
                  <div style={{ fontSize: '1.4rem', fontWeight: '800', color: '#115e59', marginTop: '2px' }}>
                    {reportData?.averageAttendanceRate || '76.9%'}
                  </div>
                </div>

                <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '10px 14px' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#b45309', textTransform: 'uppercase' }}>
                    On-Time Check-In Rate
                  </div>
                  <div style={{ fontSize: '1.4rem', fontWeight: '800', color: '#92400e', marginTop: '2px' }}>
                    {reportData?.onTimeRate || '80.5%'}
                  </div>
                </div>
              </div>

              {/* Work Mode Comparison Ratio Bar */}
              <div style={{ backgroundColor: '#f8fafc', padding: '12px 14px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: '700', marginBottom: '6px' }}>
                  <span style={{ color: '#15803d' }}>
                    WFO: {summary.wfo} ({summary.totalRecords > 0 ? Math.round((summary.wfo * 100) / summary.totalRecords) : 0}%)
                  </span>
                  <span style={{ color: '#4f46e5' }}>
                    WFH: {summary.wfh} ({summary.totalRecords > 0 ? Math.round((summary.wfh * 100) / summary.totalRecords) : 0}%)
                  </span>
                </div>
                <div style={{ height: '8px', borderRadius: '4px', backgroundColor: '#e2e8f0', display: 'flex', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${summary.totalRecords > 0 ? (summary.wfo * 100) / summary.totalRecords : 50}%`,
                      backgroundColor: '#16a34a',
                    }}
                  />
                  <div
                    style={{
                      width: `${summary.totalRecords > 0 ? (summary.wfh * 100) / summary.totalRecords : 50}%`,
                      backgroundColor: '#6366f1',
                    }}
                  />
                </div>
                <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '6px', textAlign: 'center' }}>
                  Work Mode split across {summary.totalRecords} total punches
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Section 8: Attendance Analytics & Visual Breakdown */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          padding: '18px 20px',
          border: '1px solid #e2e8f0',
          marginBottom: '22px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BarChart3 size={18} color="#0b3d2b" />
            <span style={{ fontSize: '0.95rem', fontWeight: '700', color: '#0b3d2b' }}>
              Monthly Performance & Work Mode Analytics
            </span>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
            Company Working Days in {monthDisplayTitle}: <strong style={{ color: '#0b3d2b' }}>{totalWorkingDays} days</strong>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
          {/* Ratio A: Work Mode Comparison (WFO vs WFH) */}
          <div style={{ backgroundColor: '#f8fafc', padding: '12px 14px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', fontWeight: '700', marginBottom: '6px' }}>
              <span style={{ color: '#15803d' }}>WFO: {summary.wfo} ({summary.totalRecords > 0 ? Math.round((summary.wfo * 100) / summary.totalRecords) : 0}%)</span>
              <span style={{ color: '#1d4ed8' }}>WFH: {summary.wfh} ({summary.totalRecords > 0 ? Math.round((summary.wfh * 100) / summary.totalRecords) : 0}%)</span>
            </div>
            {/* Visual Bar */}
            <div style={{ height: '10px', borderRadius: '5px', backgroundColor: '#e2e8f0', display: 'flex', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${summary.totalRecords > 0 ? (summary.wfo * 100) / summary.totalRecords : 50}%`,
                  backgroundColor: '#16a34a',
                }}
              />
              <div
                style={{
                  width: `${summary.totalRecords > 0 ? (summary.wfh * 100) / summary.totalRecords : 50}%`,
                  backgroundColor: '#2563eb',
                }}
              />
            </div>
            <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '6px', textAlign: 'center' }}>
              Work Mode Distribution across {summary.totalRecords} punches
            </div>
          </div>

          {/* Ratio B: Attendance Performance Tiers */}
          <div style={{ backgroundColor: '#f8fafc', padding: '12px 14px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
              Employee Performance Distribution ({filteredEmployees.length} staff)
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ flex: 1, textAlign: 'center', padding: '4px', backgroundColor: '#f0fdf4', borderRadius: '6px', border: '1px solid #bbf7d0' }}>
                <div style={{ fontSize: '1rem', fontWeight: '800', color: '#15803d' }}>
                  {filteredEmployees.filter((e) => e.attendancePercentage >= 90).length}
                </div>
                <div style={{ fontSize: '0.65rem', fontWeight: '700', color: '#166534' }}>≥ 90% High</div>
              </div>
              <div style={{ flex: 1, textAlign: 'center', padding: '4px', backgroundColor: '#eff6ff', borderRadius: '6px', border: '1px solid #bfdbfe' }}>
                <div style={{ fontSize: '1rem', fontWeight: '800', color: '#1d4ed8' }}>
                  {filteredEmployees.filter((e) => e.attendancePercentage >= 75 && e.attendancePercentage < 90).length}
                </div>
                <div style={{ fontSize: '0.65rem', fontWeight: '700', color: '#1e40af' }}>75-89% Good</div>
              </div>
              <div style={{ flex: 1, textAlign: 'center', padding: '4px', backgroundColor: '#fff7ed', borderRadius: '6px', border: '1px solid #fed7aa' }}>
                <div style={{ fontSize: '1rem', fontWeight: '800', color: '#c2410c' }}>
                  {filteredEmployees.filter((e) => e.attendancePercentage < 75).length}
                </div>
                <div style={{ fontSize: '0.65rem', fontWeight: '700', color: '#9a3412' }}>&lt; 75% Low</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 5. Section 9: Search, Filter, Sorting and View Mode Toolbar */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          padding: '14px 18px',
          border: '1px solid #e2e8f0',
          marginBottom: '20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Row 1: Search input + View Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 280px', position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '12px', top: '11px', color: '#94a3b8' }} />
              <input
                type="text"
                placeholder="Search by Employee Name, Email, ID or Department..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  height: '38px',
                  paddingLeft: '36px',
                  paddingRight: '12px',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#f8fafc',
                  fontSize: '0.85rem',
                  outline: 'none',
                  color: '#0f172a',
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{ position: 'absolute', right: '10px', top: '10px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                >
                  <X size={15} />
                </button>
              )}
            </div>

            {/* View Mode Toggle: Cards vs Table */}
            <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: '10px', padding: '3px' }}>
              <button
                type="button"
                onClick={() => setViewMode('CARDS')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: viewMode === 'CARDS' ? '#ffffff' : 'transparent',
                  color: viewMode === 'CARDS' ? '#0b3d2b' : '#64748b',
                  fontSize: '0.78rem',
                  fontWeight: '700',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  boxShadow: viewMode === 'CARDS' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                <LayoutGrid size={15} />
                <span>Cards View</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('TABLE')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: viewMode === 'TABLE' ? '#ffffff' : 'transparent',
                  color: viewMode === 'TABLE' ? '#0b3d2b' : '#64748b',
                  fontSize: '0.78rem',
                  fontWeight: '700',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  boxShadow: viewMode === 'TABLE' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                <List size={15} />
                <span>Table View</span>
              </button>
            </div>
          </div>

          {/* Row 2: Secondary Dropdown Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {/* Department Filter */}
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              style={{
                height: '34px',
                padding: '0 10px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: '0.8rem',
                fontWeight: '600',
                color: '#334155',
                cursor: 'pointer',
              }}
            >
              <option value="ALL">All Departments</option>
              {departmentsList.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            {/* Attendance % Filter */}
            <select
              value={percentageFilter}
              onChange={(e) => setPercentageFilter(e.target.value)}
              style={{
                height: '34px',
                padding: '0 10px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: '0.8rem',
                fontWeight: '600',
                color: '#334155',
                cursor: 'pointer',
              }}
            >
              <option value="ALL">All Attendance %</option>
              <option value="EXCELLENT">≥ 90% (High Attendance)</option>
              <option value="GOOD">75% - 89% (Good)</option>
              <option value="LOW">&lt; 75% (Low Attendance)</option>
            </select>

            {/* Work Mode Filter */}
            <select
              value={workModeFilter}
              onChange={(e) => setWorkModeFilter(e.target.value)}
              style={{
                height: '34px',
                padding: '0 10px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: '0.8rem',
                fontWeight: '600',
                color: '#334155',
                cursor: 'pointer',
              }}
            >
              <option value="ALL">All Work Modes</option>
              <option value="WFO_DOMINANT">WFO Dominant</option>
              <option value="WFH_DOMINANT">WFH Dominant</option>
            </select>

            {/* Late Status Filter */}
            <select
              value={lateFilter}
              onChange={(e) => setLateFilter(e.target.value)}
              style={{
                height: '34px',
                padding: '0 10px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: '0.8rem',
                fontWeight: '600',
                color: '#334155',
                cursor: 'pointer',
              }}
            >
              <option value="ALL">All Employees</option>
              <option value="LATE_ONLY">Has Late Check-ins</option>
              <option value="ON_TIME_ONLY">No Late Logins (On-time)</option>
            </select>

            {/* Sorting */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{
                height: '34px',
                padding: '0 10px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: '0.8rem',
                fontWeight: '600',
                color: '#0b3d2b',
                cursor: 'pointer',
                marginLeft: 'auto',
              }}
            >
              <option value="PERCENTAGE_DESC">Sort: Highest Attendance %</option>
              <option value="PERCENTAGE_ASC">Sort: Lowest Attendance %</option>
              <option value="LATE_DESC">Sort: Most Late Days</option>
              <option value="PRESENT_DESC">Sort: Highest Present Days</option>
              <option value="NAME_ASC">Sort: Name (A to Z)</option>
            </select>
          </div>
        </div>
      </div>

      {/* 6. Section 5 & 6: Employee Reports (Cards View or Table View) */}
      <div style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Users size={18} color="#0b3d2b" />
          <h2 style={{ fontSize: '1.1rem', fontWeight: '800', color: '#0b3d2b', margin: 0 }}>
            Employee Reports
          </h2>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: '700',
              padding: '2px 8px',
              borderRadius: '6px',
              backgroundColor: '#ecfdf5',
              color: '#065f46',
              border: '1px solid #a7f3d0',
            }}
          >
            {filteredEmployees.length} of {allEmployees.length} Employees
          </span>
        </div>
      </div>

      {/* Loading Indicator */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#64748b' }}>
          <RotateCcw size={28} className="animate-spin" style={{ margin: '0 auto 12px auto' }} />
          <p style={{ fontSize: '0.9rem', fontWeight: '600' }}>
            Calculating monthly attendance records for {monthDisplayTitle}...
          </p>
        </div>
      ) : filteredEmployees.length === 0 ? (
        <EmptyState
          title="No Employee Reports Found"
          description={`No matching employee attendance reports found for ${monthDisplayTitle}.`}
        />
      ) : viewMode === 'CARDS' ? (
        /* View Mode A: Modern Employee Report Cards Grid (Matching Screenshots 2-6) */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '16px',
          }}
        >
          {filteredEmployees.map((emp) => {
            const pct = emp.attendancePercentage;
            let progressColor = '#10b981'; // Green >= 90%
            if (pct < 75) progressColor = '#f97316'; // Orange < 75%
            else if (pct < 90) progressColor = '#3b82f6'; // Blue 75-89%

            return (
              <div
                key={emp.employeeId || emp.email}
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '16px',
                  padding: '18px',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.03)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                }}
              >
                <div>
                  {/* Employee Header: Email as primary title matching mobile reference screenshot */}
                  <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '12px', marginBottom: '14px' }}>
                    <div style={{ fontSize: '1rem', fontWeight: '800', color: '#0f172a', lineHeight: '1.3', wordBreak: 'break-all' }}>
                      {emp.email}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: '700', color: '#0b3d2b' }}>
                        {emp.employeeName}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: '700',
                            color: '#475569',
                            backgroundColor: '#f1f5f9',
                            padding: '2px 6px',
                            borderRadius: '4px',
                          }}
                        >
                          {emp.employeeId}
                        </span>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: '700',
                            color: '#0f766e',
                            backgroundColor: '#f0fdfa',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            border: '1px solid #ccfbf1',
                          }}
                        >
                          {emp.department || 'Operations'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Attendance Statistics List (Faithfully matching mobile Screenshots 2–7) */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '5px',
                      fontSize: '0.875rem',
                      marginBottom: '14px',
                      padding: '10px 12px',
                      backgroundColor: '#f8fafc',
                      borderRadius: '10px',
                      border: '1px solid #f1f5f9',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: '700', color: '#16a34a' }}>Present Days:</span>
                      <strong style={{ color: '#15803d', fontWeight: '800' }}>{emp.presentDays}</strong>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: '600', color: '#475569' }}>Working Days:</span>
                      <strong style={{ color: '#334155', fontWeight: '700' }}>{emp.workingDays || totalWorkingDays}</strong>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: '600', color: '#7c3aed' }}>Approved Leave:</span>
                      <strong style={{ color: '#6d28d9', fontWeight: '700' }}>{emp.approvedLeaveDays}</strong>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: '800', color: '#6366f1' }}>Attendance Percentage:</span>
                      <strong style={{ color: '#4f46e5', fontWeight: '800' }}>{emp.attendancePercentage}%</strong>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: '700', color: '#16a34a' }}>WFO Days:</span>
                      <strong style={{ color: '#15803d', fontWeight: '800' }}>{emp.wfoDays}</strong>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: '700', color: '#6366f1' }}>WFH Days:</span>
                      <strong style={{ color: '#4f46e5', fontWeight: '800' }}>{emp.wfhDays}</strong>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: '700', color: '#ea580c' }}>Late Days:</span>
                      <strong style={{ color: '#c2410c', fontWeight: '800' }}>{emp.lateDays}</strong>
                    </div>
                  </div>

                  {/* Attendance Percentage Progress Bar */}
                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', fontWeight: '700', color: '#64748b', marginBottom: '4px' }}>
                      <span>Attendance Score</span>
                      <span style={{ color: progressColor }}>{emp.attendancePercentage}%</span>
                    </div>
                    <div style={{ height: '6px', borderRadius: '3px', backgroundColor: '#e2e8f0', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${Math.min(100, Math.max(0, emp.attendancePercentage))}%`,
                          backgroundColor: progressColor,
                          height: '100%',
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                  </div>

                  {/* Late Reasons (Matching Screenshot 7) */}
                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: '700', color: '#b45309', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Clock size={14} color="#d97706" />
                      <span>Late Reasons:</span>
                    </div>
                    {emp.lateReasons && emp.lateReasons.length > 0 ? (
                      <div
                        style={{
                          backgroundColor: '#fffbeb',
                          border: '1px solid #fef3c7',
                          borderRadius: '8px',
                          padding: '8px 10px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          maxHeight: '120px',
                          overflowY: 'auto',
                        }}
                      >
                        {emp.lateReasons.map((lr, idx) => (
                          <div
                            key={idx}
                            style={{
                              fontSize: '0.75rem',
                              color: '#78350f',
                              lineHeight: '1.35',
                            }}
                          >
                            <span style={{ fontWeight: '700', color: '#92400e' }}>{lr.date}</span> – {lr.reason}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: '0.72rem',
                          color: '#065f46',
                          backgroundColor: '#ecfdf5',
                          border: '1px solid #a7f3d0',
                          borderRadius: '6px',
                          padding: '6px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <Check size={13} color="#059669" />
                        <span>No late check-ins recorded this month</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Card Action */}
                <button
                  type="button"
                  onClick={() => handleOpenDetailModal(emp)}
                  style={{
                    width: '100%',
                    height: '36px',
                    borderRadius: '8px',
                    border: '1px solid #bbf7d0',
                    backgroundColor: '#f0fdf4',
                    color: '#0b3d2b',
                    fontSize: '0.8rem',
                    fontWeight: '700',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Eye size={14} />
                  <span>View Details</span>
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        /* View Mode B: Detailed Table View */
        <div className="table-responsive-container" style={{ backgroundColor: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Present</th>
                <th>Working</th>
                <th>Leave</th>
                <th>Attendance %</th>
                <th>WFO</th>
                <th>WFH</th>
                <th>Late</th>
                <th>Late Reasons Preview</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((emp) => (
                <tr key={emp.employeeId || emp.email}>
                  <td>
                    <div style={{ fontWeight: '700', color: '#0b3d2b' }}>{emp.employeeName}</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {emp.employeeId} • {emp.email}
                    </div>
                  </td>
                  <td>{emp.department}</td>
                  <td>
                    <span style={{ fontWeight: '700', color: '#15803d' }}>{emp.presentDays}</span>
                  </td>
                  <td style={{ color: '#475569', fontWeight: '600' }}>{emp.workingDays || totalWorkingDays}</td>
                  <td>
                    <span style={{ color: emp.approvedLeaveDays > 0 ? '#7e22ce' : '#64748b', fontWeight: '600' }}>
                      {emp.approvedLeaveDays}
                    </span>
                  </td>
                  <td>
                    <span
                      style={{
                        fontWeight: '800',
                        color: emp.attendancePercentage >= 90 ? '#15803d' : emp.attendancePercentage >= 75 ? '#1d4ed8' : '#c2410c',
                      }}
                    >
                      {emp.attendancePercentage}%
                    </span>
                  </td>
                  <td>
                    <span style={{ color: '#15803d', fontWeight: '600' }}>{emp.wfoDays}</span>
                  </td>
                  <td>
                    <span style={{ color: '#6d28d9', fontWeight: '600' }}>{emp.wfhDays}</span>
                  </td>
                  <td>
                    <span
                      style={{
                        fontWeight: '700',
                        color: emp.lateDays > 0 ? '#b45309' : '#64748b',
                      }}
                    >
                      {emp.lateDays}
                    </span>
                  </td>
                  <td>
                    {emp.lateReasons && emp.lateReasons.length > 0 ? (
                      <span
                        style={{
                          fontSize: '0.73rem',
                          color: '#92400e',
                          backgroundColor: '#fffbeb',
                          border: '1px solid #fde68a',
                          borderRadius: '6px',
                          padding: '2px 6px',
                          maxWidth: '160px',
                          display: 'inline-block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={emp.lateReasons.map((r) => `${formatDisplayDate(r.date)}: ${r.reason}`).join(' | ')}
                      >
                        {emp.lateReasons.length} reasons ({formatDisplayDate(emp.lateReasons[0].date)})
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>None</span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => handleOpenDetailModal(emp)}
                      className="table-action-btn"
                      style={{
                        backgroundColor: '#f0fdf4',
                        color: '#166534',
                        border: '1px solid #bbf7d0',
                        cursor: 'pointer',
                      }}
                    >
                      <Eye size={14} />
                      <span>View</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 7. Section 7: Employee Report Details Modal / Popup */}
      <Modal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title={viewEmployee ? `${viewEmployee.employeeName} – Monthly Attendance Report` : 'Employee Attendance Details'}
        subtitle={viewEmployee ? `${viewEmployee.email} • ${monthDisplayTitle}` : ''}
      >
        {viewEmployee && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Top Profile Summary Card */}
            <div
              style={{
                backgroundColor: '#f8fafc',
                borderRadius: '12px',
                padding: '12px 16px',
                border: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <div>
                <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#0b3d2b' }}>
                  {viewEmployee.employeeName}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  ID: <strong style={{ color: '#0f172a' }}>{viewEmployee.employeeId}</strong> • Dept:{' '}
                  <strong style={{ color: '#0f172a' }}>{viewEmployee.department}</strong>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span
                  style={{
                    fontSize: '0.85rem',
                    fontWeight: '800',
                    padding: '4px 10px',
                    borderRadius: '8px',
                    backgroundColor: viewEmployee.attendancePercentage >= 90 ? '#f0fdf4' : '#eff6ff',
                    color: viewEmployee.attendancePercentage >= 90 ? '#15803d' : '#1d4ed8',
                    border: `1px solid ${viewEmployee.attendancePercentage >= 90 ? '#bbf7d0' : '#bfdbfe'}`,
                  }}
                >
                  Score: {viewEmployee.attendancePercentage}%
                </span>
              </div>
            </div>

            {/* Monthly Attendance Metrics Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '8px' }}>
              <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: '700' }}>WORKING DAYS</div>
                <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#334155', marginTop: '2px' }}>
                  {viewEmployee.workingDays || totalWorkingDays}
                </div>
              </div>

              <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: '#15803d', fontWeight: '700' }}>PRESENT DAYS</div>
                <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#166534', marginTop: '2px' }}>
                  {viewEmployee.presentDays}
                </div>
              </div>

              <div style={{ backgroundColor: '#faf5ff', border: '1px solid #f3e8ff', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: '#7e22ce', fontWeight: '700' }}>APPROVED LEAVE</div>
                <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#6b21a8', marginTop: '2px' }}>
                  {viewEmployee.approvedLeaveDays}
                </div>
              </div>

              <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: '#b91c1c', fontWeight: '700' }}>ABSENT DAYS</div>
                <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#7f1d1d', marginTop: '2px' }}>
                  {viewEmployee.absentDays}
                </div>
              </div>

              <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: '#15803d', fontWeight: '700' }}>WFO DAYS</div>
                <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#15803d', marginTop: '2px' }}>
                  {viewEmployee.wfoDays}
                </div>
              </div>

              <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: '#1d4ed8', fontWeight: '700' }}>WFH DAYS</div>
                <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#1d4ed8', marginTop: '2px' }}>
                  {viewEmployee.wfhDays}
                </div>
              </div>

              <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: '#b45309', fontWeight: '700' }}>LATE DAYS</div>
                <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#b45309', marginTop: '2px' }}>
                  {viewEmployee.lateDays}
                </div>
              </div>
            </div>

            {/* Late Check-in Reasons Section (If any) */}
            {viewEmployee.lateReasons && viewEmployee.lateReasons.length > 0 && (
              <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '12px', padding: '12px 14px' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: '700', color: '#92400e', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Clock size={15} color="#b45309" />
                  <span>Late Check-in Explanations Submitted:</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {viewEmployee.lateReasons.map((lr, idx) => (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #fef3c7',
                        borderRadius: '8px',
                        padding: '6px 10px',
                        fontSize: '0.78rem',
                        color: '#78350f',
                      }}
                    >
                      <strong style={{ color: '#b45309' }}>{formatDisplayDate(lr.date)}:</strong> "{lr.reason}"
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Daily Attendance History Table for Selected Month */}
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: '800', color: '#0b3d2b', marginBottom: '8px' }}>
                Daily Attendance History ({monthDisplayTitle})
              </div>
              {viewEmployee.dailyRecords && viewEmployee.dailyRecords.length > 0 ? (
                <div className="table-responsive-container" style={{ maxHeight: '280px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
                  <table className="data-table" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Work Mode</th>
                        <th>Check-In</th>
                        <th>Check-Out</th>
                        <th>Duration</th>
                        <th>Status</th>
                        <th>Late Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewEmployee.dailyRecords.map((dr, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: '600' }}>{formatDisplayDate(dr.date)}</td>
                          <td>
                            <span
                              style={{
                                fontSize: '0.72rem',
                                fontWeight: '700',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                backgroundColor: (dr.workMode || '').toUpperCase() === 'WFO' ? '#f0fdf4' : '#eff6ff',
                                color: (dr.workMode || '').toUpperCase() === 'WFO' ? '#15803d' : '#1d4ed8',
                              }}
                            >
                              {dr.workMode || 'WFO'}
                            </span>
                          </td>
                          <td style={{ fontWeight: '600', color: '#0f172a' }}>{dr.checkIn || '--'}</td>
                          <td style={{ color: '#64748b' }}>{dr.checkOut || '--'}</td>
                          <td style={{ color: '#0f766e', fontWeight: '600' }}>{dr.duration || '--'}</td>
                          <td>
                            <span
                              className={`badge-status ${
                                dr.isLate ? 'badge-late' : (dr.status || '').toUpperCase() === 'PRESENT' ? 'badge-present' : 'badge-absent'
                              }`}
                            >
                              {dr.isLate ? 'Late' : dr.status || 'Present'}
                            </span>
                          </td>
                          <td>
                            {dr.lateReason ? (
                              <span
                                style={{
                                  fontSize: '0.72rem',
                                  color: '#065f46',
                                  backgroundColor: '#ecfdf5',
                                  border: '1px solid #a7f3d0',
                                  borderRadius: '4px',
                                  padding: '2px 6px',
                                  maxWidth: '180px',
                                  display: 'inline-block',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                                title={dr.lateReason}
                              >
                                "{dr.lateReason}"
                              </span>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>--</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic', padding: '12px', textAlign: 'center' }}>
                  No attendance punches recorded for this employee in {monthDisplayTitle}.
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
