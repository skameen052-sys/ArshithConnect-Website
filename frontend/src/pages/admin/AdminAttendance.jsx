import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search,
  Filter,
  Edit2,
  Eye,
  Calendar,
  Users,
  Building2,
  Home,
  Clock,
  CheckCircle2,
  AlertCircle,
  UserX,
  RotateCcw,
  Download,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  Layers,
  MapPin,
  ExternalLink,
  Check,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import PageHeader from '../../components/common/PageHeader';
import EmptyState from '../../components/common/EmptyState';
import Modal from '../../components/common/Modal';
import { attendanceService } from '../../services/attendanceService';

// Timezone and Date Formatting Helpers (IST Asia/Kolkata)
const getTodayIST = () => {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date()); // YYYY-MM-DD
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
};

const getYesterdayIST = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
};

const getFirstDayOfMonthIST = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
};

const getLast7DaysIST = () => {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
};

// Formats YYYY-MM-DD to DD-MM-YYYY
const formatDisplayDate = (isoStr) => {
  if (!isoStr || isoStr === '--') return '--';
  const clean = String(isoStr).slice(0, 10);
  const parts = clean.split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return clean;
};

export default function AdminAttendance() {
  const todayIso = useMemo(() => getTodayIST(), []);

  // 1. Date Filter Controls State
  const [filterMode, setFilterMode] = useState('SINGLE'); // 'SINGLE' | 'RANGE'
  const [singleDate, setSingleDate] = useState(todayIso);
  const [fromDate, setFromDate] = useState(todayIso);
  const [toDate, setToDate] = useState(todayIso);

  // Active applied filter snapshot
  const [appliedFilter, setAppliedFilter] = useState({
    mode: 'SINGLE',
    singleDate: todayIso,
    fromDate: todayIso,
    toDate: todayIso,
  });

  // Table and filtering states
  const [records, setRecords] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [modeFilter, setModeFilter] = useState('ALL');
  const [isLoading, setIsLoading] = useState(false);

  // Range Report View Switch: 'LOGS' (detailed row by row) | 'EMPLOYEE_SUMMARY' (grouped)
  const [reportViewTab, setReportViewTab] = useState('LOGS');

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  // Edit / Adjust record modal state
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editStatus, setEditStatus] = useState('');
  const [editWorkMode, setEditWorkMode] = useState('');
  const [editCheckIn, setEditCheckIn] = useState('');
  const [editCheckOut, setEditCheckOut] = useState('');
  const [editLateReason, setEditLateReason] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // View verification details modal state
  const [viewRecord, setViewRecord] = useState(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [viewPhotoUrl, setViewPhotoUrl] = useState(null);
  const [isPhotoLoading, setIsPhotoLoading] = useState(false);

  // Load attendance records based on current applied filter
  const loadAttendanceRecords = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = {};
      if (appliedFilter.mode === 'SINGLE') {
        params.date = appliedFilter.singleDate;
      } else {
        params.start_date = appliedFilter.fromDate;
        params.end_date = appliedFilter.toDate;
        params.from_date = appliedFilter.fromDate;
        params.to_date = appliedFilter.toDate;
      }

      const data = await attendanceService.getRecords(params);
      setRecords(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load attendance records:', err);
      setRecords([]);
    } finally {
      setIsLoading(false);
    }
  }, [appliedFilter]);

  useEffect(() => {
    loadAttendanceRecords();
  }, [loadAttendanceRecords]);

  // Reset pagination whenever filters or search query change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, modeFilter, appliedFilter]);

  // Apply Filter Handler
  const handleApplyFilter = () => {
    // Validate end date not earlier than start date
    if (filterMode === 'RANGE' && toDate < fromDate) {
      alert('The "To Date" cannot be earlier than the "From Date". Please adjust your date range.');
      return;
    }

    setAppliedFilter({
      mode: filterMode,
      singleDate: singleDate || todayIso,
      fromDate: fromDate || todayIso,
      toDate: toDate || todayIso,
    });
  };

  // Reset to default (Today, Single Date)
  const handleResetFilter = () => {
    const today = getTodayIST();
    setFilterMode('SINGLE');
    setSingleDate(today);
    setFromDate(today);
    setToDate(today);
    setSearchQuery('');
    setStatusFilter('ALL');
    setModeFilter('ALL');
    setReportViewTab('LOGS');
    setAppliedFilter({
      mode: 'SINGLE',
      singleDate: today,
      fromDate: today,
      toDate: today,
    });
  };

  // Quick Date presets
  const handleQuickPreset = (preset) => {
    const today = getTodayIST();
    if (preset === 'TODAY') {
      setFilterMode('SINGLE');
      setSingleDate(today);
      setAppliedFilter({ mode: 'SINGLE', singleDate: today, fromDate: today, toDate: today });
    } else if (preset === 'YESTERDAY') {
      const yest = getYesterdayIST();
      setFilterMode('SINGLE');
      setSingleDate(yest);
      setAppliedFilter({ mode: 'SINGLE', singleDate: yest, fromDate: yest, toDate: yest });
    } else if (preset === 'LAST_7_DAYS') {
      const start = getLast7DaysIST();
      setFilterMode('RANGE');
      setFromDate(start);
      setToDate(today);
      setAppliedFilter({ mode: 'RANGE', singleDate: today, fromDate: start, toDate: today });
    } else if (preset === 'THIS_MONTH') {
      const start = getFirstDayOfMonthIST();
      setFilterMode('RANGE');
      setFromDate(start);
      setToDate(today);
      setAppliedFilter({ mode: 'RANGE', singleDate: today, fromDate: start, toDate: today });
    }
  };

  // Filtered records based on search, status, and work mode
  const filteredRecords = useMemo(() => {
    return records.filter((rec) => {
      const query = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !query ||
        (rec.employeeName || '').toLowerCase().includes(query) ||
        (rec.employeeId || '').toLowerCase().includes(query) ||
        (rec.department || '').toLowerCase().includes(query);

      const recStatus = (rec.status || '').toUpperCase();
      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'LATE'
          ? recStatus === 'LATE' || Boolean(rec.isLate)
          : recStatus === statusFilter);

      const recMode = (rec.workMode || '').toUpperCase();
      const matchesMode = modeFilter === 'ALL' || recMode === modeFilter;

      return matchesSearch && matchesStatus && matchesMode;
    });
  }, [records, searchQuery, statusFilter, modeFilter]);

  // Section 2: Summary Cards Calculations (Based dynamically on actual filtered dataset)
  const summaryMetrics = useMemo(() => {
    const totalAttendance = filteredRecords.length;
    const wfo = filteredRecords.filter((r) => (r.workMode || '').toUpperCase() === 'WFO').length;
    const wfh = filteredRecords.filter((r) => (r.workMode || '').toUpperCase() === 'WFH').length;
    const late = filteredRecords.filter(
      (r) => Boolean(r.isLate) || (r.status || '').toUpperCase() === 'LATE'
    ).length;
    const present = filteredRecords.filter((r) =>
      ['PRESENT', 'LATE', 'COMPLETED'].includes((r.status || '').toUpperCase())
    ).length;
    const absent = filteredRecords.filter(
      (r) => (r.status || '').toUpperCase() === 'ABSENT'
    ).length;

    return { totalAttendance, wfo, wfh, late, present, absent };
  }, [filteredRecords]);

  // Section 4: Employee-wise Aggregated Summary for Date Range Reports
  const employeeSummaries = useMemo(() => {
    if (appliedFilter.mode !== 'RANGE') return [];
    const map = {};
    filteredRecords.forEach((r) => {
      const empKey = r.employeeId || r.employeeName;
      if (!map[empKey]) {
        map[empKey] = {
          employeeId: r.employeeId || '--',
          employeeName: r.employeeName || 'Employee',
          department: r.department || 'Operations',
          totalEntries: 0,
          wfoDays: 0,
          wfhDays: 0,
          lateDays: 0,
          presentDays: 0,
          absentDays: 0,
          records: [],
        };
      }
      const item = map[empKey];
      item.totalEntries += 1;
      item.records.push(r);
      const m = (r.workMode || '').toUpperCase();
      const s = (r.status || '').toUpperCase();
      if (m === 'WFO') item.wfoDays += 1;
      if (m === 'WFH') item.wfhDays += 1;
      if (r.isLate || s === 'LATE') item.lateDays += 1;
      if (['PRESENT', 'LATE', 'COMPLETED'].includes(s)) item.presentDays += 1;
      if (s === 'ABSENT') item.absentDays += 1;
    });
    return Object.values(map);
  }, [filteredRecords, appliedFilter.mode]);

  // Pagination Slice
  const totalPages = Math.ceil(filteredRecords.length / rowsPerPage) || 1;
  const paginatedRecords = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return filteredRecords.slice(startIndex, startIndex + rowsPerPage);
  }, [filteredRecords, currentPage, rowsPerPage]);

  // Open Edit Modal
  const handleOpenEdit = (rec) => {
    setSelectedRecord(rec);
    setEditStatus(rec.status || 'Present');
    setEditWorkMode(rec.workMode || 'WFO');
    setEditCheckIn(rec.checkIn || '');
    setEditCheckOut(rec.checkOut || '');
    setEditLateReason(rec.lateReason || '');
    setIsEditModalOpen(true);
  };

  // Open View Modal (with Photo / GPS details)
  const handleOpenView = async (rec) => {
    setViewRecord(rec);
    setIsViewModalOpen(true);
    setViewPhotoUrl(rec.checkInPhotoUrl || null);
    setIsPhotoLoading(false);

    if (rec.hasCheckInPhoto && !rec.checkInPhotoUrl) {
      setIsPhotoLoading(true);
      try {
        const blob = await attendanceService.getPhotoBlob(rec.id, 'check-in');
        setViewPhotoUrl(URL.createObjectURL(blob));
      } catch (err) {
        console.warn('Could not fetch photo blob via API proxy:', err);
      } finally {
        setIsPhotoLoading(false);
      }
    }
  };

  // Save Record Adjustments
  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!selectedRecord) return;
    setIsSavingEdit(true);
    try {
      await attendanceService.updateRecord(selectedRecord.id, {
        status: editStatus,
        workMode: editWorkMode,
        checkIn: editCheckIn,
        checkOut: editCheckOut,
        lateReason: editLateReason,
      });
      await loadAttendanceRecords();
      setIsEditModalOpen(false);
    } catch (err) {
      console.error('Failed to update attendance record:', err);
      alert(err.message || 'Could not save attendance adjustments.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Formatted Excel (.xlsx) Export with Auto-Fitted Columns & Summary Sheets
  const handleExportExcel = () => {
    if (!filteredRecords.length) return;
    const isRange = appliedFilter.mode === 'RANGE';
    const reportDateLabel = isRange
      ? `${formatDisplayDate(appliedFilter.fromDate)}_to_${formatDisplayDate(appliedFilter.toDate)}`
      : formatDisplayDate(appliedFilter.singleDate);

    // 1. Sheet 1: Detailed Attendance Logs
    const attendanceData = filteredRecords.map((r, index) => {
      const isLate =
        r.isLate ||
        (r.status || '').toUpperCase() === 'LATE' ||
        Boolean(r.lateReason && String(r.lateReason).trim());
      const displayStatus = isLate ? 'Late' : (r.status || 'Present');
      const lateReasonText =
        r.lateReason && String(r.lateReason).trim()
          ? String(r.lateReason).trim()
          : isLate
          ? 'Reason Pending'
          : '--';

      return {
        'S.No': index + 1,
        'Attendance Date': formatDisplayDate(r.date),
        'Employee ID': r.employeeId || '',
        'Employee Name': r.employeeName || '',
        'Department': r.department || 'Operations',
        'Work Mode': (r.workMode || 'WFO').toUpperCase(),
        'Check-In Time': r.checkIn || '--',
        'Check-Out Time': r.checkOut || '--',
        'Working Duration': r.duration || '--',
        'Attendance Status': displayStatus,
        'Late Check-in Reason': lateReasonText,
        'GPS Latitude':
          r.checkInLatitude !== null && r.checkInLatitude !== undefined
            ? String(r.checkInLatitude)
            : '--',
        'GPS Longitude':
          r.checkInLongitude !== null && r.checkInLongitude !== undefined
            ? String(r.checkInLongitude)
            : '--',
      };
    });

    const wsRecords = XLSX.utils.json_to_sheet(attendanceData);
    // Explicit, generous column widths so no text is cut off and dates NEVER show as '########'
    wsRecords['!cols'] = [
      { wch: 8 },  // S.No
      { wch: 18 }, // Attendance Date (e.g. 17-11-2026)
      { wch: 16 }, // Employee ID (e.g. AFI-9076)
      { wch: 34 }, // Employee Name
      { wch: 20 }, // Department
      { wch: 14 }, // Work Mode
      { wch: 16 }, // Check-In Time
      { wch: 16 }, // Check-Out Time
      { wch: 18 }, // Working Duration
      { wch: 18 }, // Attendance Status
      { wch: 38 }, // Late Check-in Reason
      { wch: 15 }, // GPS Latitude
      { wch: 15 }, // GPS Longitude
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsRecords, 'Attendance Logs');

    // 2. Sheet 2: Employee Summary (for date range aggregations)
    if (employeeSummaries.length > 0) {
      const summaryData = employeeSummaries.map((emp, idx) => ({
        'S.No': idx + 1,
        'Employee ID': emp.employeeId,
        'Employee Name': emp.employeeName,
        'Department': emp.department,
        'Total Logged Days': emp.totalEntries,
        'Present Days': emp.presentDays,
        'WFO Days': emp.wfoDays,
        'WFH Days': emp.wfhDays,
        'Late Days': emp.lateDays,
        'Absent Days': emp.absentDays,
      }));
      const wsSummary = XLSX.utils.json_to_sheet(summaryData);
      wsSummary['!cols'] = [
        { wch: 8 },  // S.No
        { wch: 16 }, // Employee ID
        { wch: 34 }, // Employee Name
        { wch: 20 }, // Department
        { wch: 18 }, // Total Logged Days
        { wch: 14 }, // Present Days
        { wch: 14 }, // WFO Days
        { wch: 14 }, // WFH Days
        { wch: 14 }, // Late Days
        { wch: 14 }, // Absent Days
      ];
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Employee-Wise Summary');
    }

    // 3. Sheet 3: Report Overview
    const overviewData = [
      { Metric: 'Company Name', Value: 'Arshith Connect' },
      { Metric: 'Report Type', Value: 'Employee Attendance Management Report' },
      { Metric: 'Filter Mode', Value: isRange ? 'Date Range Period' : 'Single Date' },
      {
        Metric: 'From Date',
        Value: isRange
          ? formatDisplayDate(appliedFilter.fromDate)
          : formatDisplayDate(appliedFilter.singleDate),
      },
      {
        Metric: 'To Date',
        Value: isRange
          ? formatDisplayDate(appliedFilter.toDate)
          : formatDisplayDate(appliedFilter.singleDate),
      },
      { Metric: 'Total Attendance Entries', Value: summaryMetrics.totalAttendance },
      { Metric: 'Work From Office (WFO)', Value: summaryMetrics.wfo },
      { Metric: 'Work From Home (WFH)', Value: summaryMetrics.wfh },
      { Metric: 'Late Check-ins', Value: summaryMetrics.late },
      { Metric: 'Present Count', Value: summaryMetrics.present },
      { Metric: 'Absent Count', Value: summaryMetrics.absent },
      {
        Metric: 'Generated At',
        Value: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      },
    ];
    const wsOverview = XLSX.utils.json_to_sheet(overviewData);
    wsOverview['!cols'] = [{ wch: 28 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsOverview, 'Report Overview');

    XLSX.writeFile(wb, `Arshith_Attendance_Report_${reportDateLabel}.xlsx`);
  };

  // CSV Export with UTF-8 BOM for accurate character encoding and date formatting
  const handleExportCSV = () => {
    if (!filteredRecords.length) return;
    const isRange = appliedFilter.mode === 'RANGE';
    const reportDateLabel = isRange
      ? `${formatDisplayDate(appliedFilter.fromDate)}_to_${formatDisplayDate(appliedFilter.toDate)}`
      : formatDisplayDate(appliedFilter.singleDate);

    const headers = [
      'S.No',
      'Attendance Date',
      'Employee ID',
      'Employee Name',
      'Department',
      'Work Mode',
      'Check In',
      'Check Out',
      'Duration',
      'Status',
      'Late Reason',
      'Latitude',
      'Longitude',
    ];

    const rows = filteredRecords.map((r, index) => {
      const isLate =
        r.isLate ||
        (r.status || '').toUpperCase() === 'LATE' ||
        Boolean(r.lateReason && String(r.lateReason).trim());
      const displayStatus = isLate ? 'Late' : (r.status || 'Present');
      const lateReasonText =
        r.lateReason && String(r.lateReason).trim()
          ? String(r.lateReason).trim()
          : isLate
          ? 'Reason Pending'
          : '--';

      return [
        index + 1,
        `"${formatDisplayDate(r.date)}"`,
        `"${r.employeeId || ''}"`,
        `"${(r.employeeName || '').replace(/"/g, '""')}"`,
        `"${r.department || 'Operations'}"`,
        `"${r.workMode || 'WFO'}"`,
        `"${r.checkIn || '--'}"`,
        `"${r.checkOut || '--'}"`,
        `"${r.duration || '--'}"`,
        `"${displayStatus}"`,
        `"${lateReasonText.replace(/"/g, '""')}"`,
        r.checkInLatitude ?? '',
        r.checkInLongitude ?? '',
      ];
    });

    // \uFEFF ensures Excel treats CSV as UTF-8
    const csvContent =
      '\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Arshith_Attendance_Report_${reportDateLabel}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="attendance-management-view animate-fade-in" style={{ paddingBottom: '32px' }}>
      {/* 1. Header with Breadcrumbs & Export Action */}
      <PageHeader
        title="Attendance Management"
        subtitle="Monitor, verify and adjust daily employee attendance records"
        breadcrumb={[
          { label: 'Admin', path: '/admin/dashboard' },
          { label: 'Attendance' },
        ]}
        actionButton={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-export-excel"
              onClick={handleExportExcel}
              disabled={filteredRecords.length === 0}
              title="Download formatted Excel (.xlsx) report with auto-fitted columns and summaries"
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
                cursor: filteredRecords.length === 0 ? 'not-allowed' : 'pointer',
                opacity: filteredRecords.length === 0 ? 0.6 : 1,
                boxShadow: '0 1px 3px rgba(11, 61, 43, 0.25)',
              }}
            >
              <FileSpreadsheet size={16} />
              <span>Export Excel (.xlsx)</span>
            </button>
            <button
              type="button"
              className="btn-export-csv"
              onClick={handleExportCSV}
              disabled={filteredRecords.length === 0}
              title="Download standard CSV report"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                height: '38px',
                padding: '0 12px',
                borderRadius: '10px',
                backgroundColor: '#f0fdf4',
                color: '#166534',
                fontSize: '0.825rem',
                fontWeight: '600',
                border: '1px solid #bbf7d0',
                cursor: filteredRecords.length === 0 ? 'not-allowed' : 'pointer',
                opacity: filteredRecords.length === 0 ? 0.6 : 1,
              }}
            >
              <Download size={15} />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              className="table-action-btn"
              onClick={loadAttendanceRecords}
              disabled={isLoading}
              title="Refresh Attendance Records"
              style={{ height: '38px', padding: '0 12px' }}
            >
              <RotateCcw size={15} className={isLoading ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        }
      />

      {/* 2. Top Attendance Date Selection Section */}
      <div
        className="management-page-card"
        style={{
          borderLeft: '4px solid #10b981',
          marginBottom: '18px',
          boxShadow: '0 4px 15px -2px rgba(0, 0, 0, 0.04)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            paddingBottom: '14px',
            borderBottom: '1px solid #f1f5f9',
            marginBottom: '14px',
          }}
        >
          {/* Section Title & Active Indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                backgroundColor: '#f0fdf4',
                color: '#166534',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Calendar size={18} />
            </div>
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: '700', color: '#0b3d2b' }}>
                Attendance Date Filter
              </div>
              <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                Active Selection:{' '}
                <strong style={{ color: '#0f766e' }}>
                  {appliedFilter.mode === 'SINGLE'
                    ? formatDisplayDate(appliedFilter.singleDate)
                    : `${formatDisplayDate(appliedFilter.fromDate)} to ${formatDisplayDate(appliedFilter.toDate)}`}
                </strong>
              </div>
            </div>
          </div>

          {/* Single vs Range Mode Switcher */}
          <div
            style={{
              display: 'inline-flex',
              backgroundColor: '#f1f5f9',
              borderRadius: '10px',
              padding: '3px',
              gap: '4px',
            }}
          >
            <button
              type="button"
              onClick={() => setFilterMode('SINGLE')}
              style={{
                border: 'none',
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontWeight: '600',
                cursor: 'pointer',
                backgroundColor: filterMode === 'SINGLE' ? '#ffffff' : 'transparent',
                color: filterMode === 'SINGLE' ? '#0b3d2b' : '#64748b',
                boxShadow: filterMode === 'SINGLE' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              Single Date
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('RANGE')}
              style={{
                border: 'none',
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontWeight: '600',
                cursor: 'pointer',
                backgroundColor: filterMode === 'RANGE' ? '#ffffff' : 'transparent',
                color: filterMode === 'RANGE' ? '#0b3d2b' : '#64748b',
                boxShadow: filterMode === 'RANGE' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              Date Range (Date-to-Date)
            </button>
          </div>
        </div>

        {/* Date Controls Row */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: '14px',
          }}
        >
          {/* Date Input Pickers */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '14px', flex: '1 1 380px' }}>
            {filterMode === 'SINGLE' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: '700', color: '#334155' }}>
                  Select Date (DD-MM-YYYY)
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type="date"
                    value={singleDate}
                    max={todayIso}
                    onChange={(e) => setSingleDate(e.target.value)}
                    style={{
                      height: '38px',
                      padding: '0 12px',
                      borderRadius: '10px',
                      border: '1px solid #cbd5e1',
                      backgroundColor: '#f8fafc',
                      fontSize: '0.85rem',
                      color: '#0f172a',
                      fontWeight: '600',
                      outline: 'none',
                      cursor: 'pointer',
                    }}
                  />
                  <span style={{ marginLeft: '10px', fontSize: '0.8rem', color: '#64748b', fontWeight: '600' }}>
                    ({formatDisplayDate(singleDate)})
                  </span>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: '700', color: '#334155' }}>
                    From Date
                  </label>
                  <input
                    type="date"
                    value={fromDate}
                    max={toDate || todayIso}
                    onChange={(e) => setFromDate(e.target.value)}
                    style={{
                      height: '38px',
                      padding: '0 12px',
                      borderRadius: '10px',
                      border: '1px solid #cbd5e1',
                      backgroundColor: '#f8fafc',
                      fontSize: '0.85rem',
                      color: '#0f172a',
                      fontWeight: '600',
                      outline: 'none',
                    }}
                  />
                </div>
                <div style={{ paddingBottom: '8px', color: '#94a3b8', fontWeight: '700' }}>&rarr;</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: '700', color: '#334155' }}>
                    To Date
                  </label>
                  <input
                    type="date"
                    value={toDate}
                    min={fromDate}
                    max={todayIso}
                    onChange={(e) => setToDate(e.target.value)}
                    style={{
                      height: '38px',
                      padding: '0 12px',
                      borderRadius: '10px',
                      border: '1px solid #cbd5e1',
                      backgroundColor: '#f8fafc',
                      fontSize: '0.85rem',
                      color: '#0f172a',
                      fontWeight: '600',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Quick Filter Presets */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => handleQuickPreset('TODAY')}
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: '600',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  color: '#334155',
                  cursor: 'pointer',
                }}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => handleQuickPreset('YESTERDAY')}
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: '600',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  color: '#334155',
                  cursor: 'pointer',
                }}
              >
                Yesterday
              </button>
              <button
                type="button"
                onClick={() => handleQuickPreset('LAST_7_DAYS')}
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: '600',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  color: '#334155',
                  cursor: 'pointer',
                }}
              >
                Last 7 Days
              </button>
              <button
                type="button"
                onClick={() => handleQuickPreset('THIS_MONTH')}
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: '600',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  color: '#334155',
                  cursor: 'pointer',
                }}
              >
                This Month
              </button>
            </div>
          </div>

          {/* Action Buttons: Apply & Reset */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={handleResetFilter}
              style={{
                height: '38px',
                padding: '0 14px',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                color: '#475569',
                fontSize: '0.825rem',
                fontWeight: '600',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
              }}
            >
              <RotateCcw size={14} />
              <span>Reset</span>
            </button>
            <button
              type="button"
              onClick={handleApplyFilter}
              style={{
                height: '38px',
                padding: '0 18px',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: '#0b3d2b',
                color: '#ffffff',
                fontSize: '0.825rem',
                fontWeight: '700',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(11, 61, 43, 0.25)',
              }}
            >
              <Check size={16} />
              <span>Apply Filter</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3. Daily / Period Attendance Summary Cards (Section 2) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '12px',
          marginBottom: '20px',
        }}
      >
        {/* Card 1: Total Attendance - Dark Blue */}
        <div
          style={{
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '14px',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Total Attendance
            </span>
            <Users size={18} color="#1d4ed8" />
          </div>
          <div style={{ fontSize: '1.65rem', fontWeight: '800', color: '#1e3a8a', lineHeight: '1' }}>
            {summaryMetrics.totalAttendance}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#3b82f6', marginTop: '4px' }}>
            {appliedFilter.mode === 'SINGLE' ? 'Logged today' : 'Total logs in range'}
          </div>
        </div>

        {/* Card 2: Work From Office (WFO) - Green */}
        <div
          style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '14px',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              WFO (Office)
            </span>
            <Building2 size={18} color="#16a34a" />
          </div>
          <div style={{ fontSize: '1.65rem', fontWeight: '800', color: '#14532d', lineHeight: '1' }}>
            {summaryMetrics.wfo}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#16a34a', marginTop: '4px' }}>
            On-site attendance
          </div>
        </div>

        {/* Card 3: Work From Home (WFH) - Purple */}
        <div
          style={{
            backgroundColor: '#faf5ff',
            border: '1px solid #e9d5ff',
            borderRadius: '14px',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#7e22ce', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              WFH (Remote)
            </span>
            <Home size={18} color="#9333ea" />
          </div>
          <div style={{ fontSize: '1.65rem', fontWeight: '800', color: '#581c87', lineHeight: '1' }}>
            {summaryMetrics.wfh}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#9333ea', marginTop: '4px' }}>
            Remote attendance
          </div>
        </div>

        {/* Card 4: Late Check-ins - Orange */}
        <div
          style={{
            backgroundColor: '#fff7ed',
            border: '1px solid #fed7aa',
            borderRadius: '14px',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#c2410c', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Late Check-ins
            </span>
            <Clock size={18} color="#ea580c" />
          </div>
          <div style={{ fontSize: '1.65rem', fontWeight: '800', color: '#7c2d12', lineHeight: '1' }}>
            {summaryMetrics.late}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#ea580c', marginTop: '4px' }}>
            After 09:30 AM
          </div>
        </div>

        {/* Card 5: Present - Teal */}
        <div
          style={{
            backgroundColor: '#f0fdfa',
            border: '1px solid #99f6e4',
            borderRadius: '14px',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#0f766e', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Present
            </span>
            <CheckCircle2 size={18} color="#0d9488" />
          </div>
          <div style={{ fontSize: '1.65rem', fontWeight: '800', color: '#134e4a', lineHeight: '1' }}>
            {summaryMetrics.present}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#0d9488', marginTop: '4px' }}>
            Verified present
          </div>
        </div>

        {/* Card 6: Absent - Red */}
        <div
          style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '14px',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#b91c1c', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Absent
            </span>
            <UserX size={18} color="#dc2626" />
          </div>
          <div style={{ fontSize: '1.65rem', fontWeight: '800', color: '#7f1d1d', lineHeight: '1' }}>
            {summaryMetrics.absent}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#dc2626', marginTop: '4px' }}>
            Logged absent
          </div>
        </div>
      </div>

      {/* 4. Section 4: Date Range Report Period Banner & View Tabs */}
      {appliedFilter.mode === 'RANGE' && (
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '14px',
            padding: '12px 18px',
            border: '1px solid #e2e8f0',
            marginBottom: '16px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Layers size={18} color="#0b3d2b" />
            <div>
              <span style={{ fontWeight: '700', color: '#0b3d2b', fontSize: '0.875rem' }}>
                Period Report: {formatDisplayDate(appliedFilter.fromDate)} to {formatDisplayDate(appliedFilter.toDate)}
              </span>
              <span style={{ fontSize: '0.78rem', color: '#64748b', marginLeft: '8px' }}>
                ({filteredRecords.length} records across {employeeSummaries.length} employees)
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              onClick={() => setReportViewTab('LOGS')}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '0.78rem',
                fontWeight: '600',
                border: reportViewTab === 'LOGS' ? '1px solid #0b3d2b' : '1px solid #cbd5e1',
                backgroundColor: reportViewTab === 'LOGS' ? '#0b3d2b' : '#ffffff',
                color: reportViewTab === 'LOGS' ? '#ffffff' : '#475569',
                cursor: 'pointer',
              }}
            >
              Daily Attendance Logs
            </button>
            <button
              type="button"
              onClick={() => setReportViewTab('EMPLOYEE_SUMMARY')}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '0.78rem',
                fontWeight: '600',
                border: reportViewTab === 'EMPLOYEE_SUMMARY' ? '1px solid #0b3d2b' : '1px solid #cbd5e1',
                backgroundColor: reportViewTab === 'EMPLOYEE_SUMMARY' ? '#0b3d2b' : '#ffffff',
                color: reportViewTab === 'EMPLOYEE_SUMMARY' ? '#ffffff' : '#475569',
                cursor: 'pointer',
              }}
            >
              Employee-Wise Summary ({employeeSummaries.length})
            </button>
          </div>
        </div>
      )}

      {/* 5. Main Attendance Table Container */}
      <div className="management-page-card">
        {/* Filter Toolbar matching Screenshot 1 */}
        <div className="filter-toolbar">
          <div className="search-input-box">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search by Employee Name or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="filter-actions-group">
            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="PRESENT">Present</option>
              <option value="LATE">Late</option>
              <option value="ABSENT">Absent</option>
            </select>

            <select
              className="filter-select"
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value)}
            >
              <option value="ALL">All Work Modes</option>
              <option value="WFO">WFO</option>
              <option value="WFH">WFH</option>
            </select>
          </div>
        </div>

        {/* View Mode A: Employee-wise Aggregated Summary Table (When Range Selected & Tab Active) */}
        {appliedFilter.mode === 'RANGE' && reportViewTab === 'EMPLOYEE_SUMMARY' ? (
          employeeSummaries.length === 0 ? (
            <EmptyState
              title="No Summary Available"
              description="No employee attendance records found within the selected date range."
            />
          ) : (
            <div className="table-responsive-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Department</th>
                    <th>Present Days</th>
                    <th>WFO Days</th>
                    <th>WFH Days</th>
                    <th>Late Days</th>
                    <th>Absent Days</th>
                    <th>Total Logged Days</th>
                  </tr>
                </thead>
                <tbody>
                  {employeeSummaries.map((emp) => (
                    <tr key={emp.employeeId}>
                      <td>
                        <div style={{ fontWeight: '700', color: '#0b3d2b' }}>{emp.employeeName}</div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{emp.employeeId}</div>
                      </td>
                      <td>{emp.department}</td>
                      <td>
                        <span style={{ fontWeight: '700', color: '#0f766e' }}>{emp.presentDays}</span>
                      </td>
                      <td>
                        <span style={{ color: '#15803d', fontWeight: '600' }}>{emp.wfoDays}</span>
                      </td>
                      <td>
                        <span style={{ color: '#7e22ce', fontWeight: '600' }}>{emp.wfhDays}</span>
                      </td>
                      <td>
                        <span style={{ color: emp.lateDays > 0 ? '#ea580c' : '#64748b', fontWeight: '600' }}>
                          {emp.lateDays}
                        </span>
                      </td>
                      <td>
                        <span style={{ color: emp.absentDays > 0 ? '#dc2626' : '#64748b', fontWeight: '600' }}>
                          {emp.absentDays}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontWeight: '700', color: '#1e3a8a' }}>{emp.totalEntries}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          /* View Mode B: Detailed Row-by-Row Attendance Table (Matching Screenshot 1) */
          <>
            {filteredRecords.length === 0 ? (
              <EmptyState
                title="No Attendance Records Found"
                description={`No attendance records found for ${
                  appliedFilter.mode === 'SINGLE'
                    ? formatDisplayDate(appliedFilter.singleDate)
                    : `${formatDisplayDate(appliedFilter.fromDate)} to ${formatDisplayDate(appliedFilter.toDate)}`
                }.`}
              />
            ) : (
              <div className="table-responsive-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Department</th>
                      <th>Work Mode</th>
                      <th>Attendance Date</th>
                      <th>Check-In</th>
                      <th>Check-Out</th>
                      <th>Duration</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRecords.map((rec) => {
                      const isLate =
                        rec.isLate ||
                        (rec.status || '').toUpperCase() === 'LATE' ||
                        Boolean(rec.lateReason && String(rec.lateReason).trim());
                      let statusBadgeClass = 'badge-absent';
                      if ((rec.status || '').toUpperCase() === 'PRESENT') statusBadgeClass = 'badge-present';
                      if (isLate) statusBadgeClass = 'badge-late';

                      const isWFO = (rec.workMode || '').toUpperCase() === 'WFO';

                      return (
                        <tr key={rec.id}>
                          {/* Employee Name & ID */}
                          <td>
                            <div style={{ fontWeight: '700', color: '#0b3d2b' }}>
                              {rec.employeeName}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                              {rec.employeeId}
                            </div>
                          </td>

                          {/* Department */}
                          <td>{rec.department || 'Operations'}</td>

                          {/* Work Mode Badge */}
                          <td>
                            <span
                              style={{
                                fontSize: '0.78rem',
                                fontWeight: '700',
                                padding: '3px 10px',
                                borderRadius: '6px',
                                backgroundColor: isWFO ? '#f0fdf4' : '#eff6ff',
                                color: isWFO ? '#15803d' : '#1d4ed8',
                                border: isWFO ? '1px solid #bbf7d0' : '1px solid #bfdbfe',
                              }}
                            >
                              {rec.workMode || 'WFO'}
                            </span>
                          </td>

                          {/* Attendance Date */}
                          <td style={{ fontWeight: '600', color: '#334155' }}>
                            {formatDisplayDate(rec.date)}
                          </td>

                          {/* Check-In Time */}
                          <td style={{ fontWeight: '600', color: '#0f172a' }}>
                            {rec.checkIn || '--'}
                          </td>

                          {/* Check-Out Time */}
                          <td style={{ color: '#64748b', fontWeight: '500' }}>
                            {rec.checkOut || '--'}
                          </td>

                          {/* Working Duration */}
                          <td style={{ fontWeight: '700', color: '#0f766e' }}>
                            {rec.duration || '--'}
                          </td>

                          {/* Status & Late Reason */}
                          <td>
                            {isLate ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                                <span className="badge-status badge-late">Late</span>
                                {rec.lateReason && String(rec.lateReason).trim() ? (
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      fontSize: '0.72rem',
                                      color: '#065f46',
                                      backgroundColor: '#ecfdf5',
                                      border: '1px solid #a7f3d0',
                                      borderRadius: '6px',
                                      padding: '2px 8px',
                                      maxWidth: '200px',
                                      lineHeight: '1.25',
                                      fontWeight: '600',
                                      boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                                      cursor: 'default',
                                    }}
                                    title={`Late Reason: "${rec.lateReason}"`}
                                  >
                                    <span style={{ color: '#047857', fontWeight: '700' }}>Reason:</span>
                                    <span
                                      style={{
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        color: '#065f46',
                                      }}
                                    >
                                      "{rec.lateReason}"
                                    </span>
                                  </span>
                                ) : (
                                  <span
                                    style={{
                                      fontSize: '0.70rem',
                                      color: '#b91c1c',
                                      backgroundColor: '#fef2f2',
                                      border: '1px solid #fecaca',
                                      borderRadius: '6px',
                                      padding: '2px 7px',
                                      fontWeight: '600',
                                      whiteSpace: 'nowrap',
                                      lineHeight: '1.25',
                                    }}
                                    title="No late reason submitted yet"
                                  >
                                    Reason Pending
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className={`badge-status ${statusBadgeClass}`}>
                                {rec.status || 'Present'}
                              </span>
                            )}
                          </td>

                          {/* Action Buttons: View & Adjust */}
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <button
                                type="button"
                                className="table-action-btn"
                                onClick={() => handleOpenView(rec)}
                                title="View Attendance Verification Details"
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
                              <button
                                type="button"
                                className="table-action-btn"
                                onClick={() => handleOpenEdit(rec)}
                                title="Adjust Attendance Record"
                                style={{ cursor: 'pointer' }}
                              >
                                <Edit2 size={14} />
                                <span>Adjust</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {filteredRecords.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  marginTop: '16px',
                  paddingTop: '12px',
                  borderTop: '1px solid #f1f5f9',
                }}
              >
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  Showing{' '}
                  <strong style={{ color: '#0b3d2b' }}>
                    {(currentPage - 1) * rowsPerPage + 1}
                  </strong>{' '}
                  to{' '}
                  <strong style={{ color: '#0b3d2b' }}>
                    {Math.min(currentPage * rowsPerPage, filteredRecords.length)}
                  </strong>{' '}
                  of{' '}
                  <strong style={{ color: '#0b3d2b' }}>
                    {filteredRecords.length}
                  </strong>{' '}
                  records
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#64748b' }}>
                    <span>Rows per page:</span>
                    <select
                      value={rowsPerPage}
                      onChange={(e) => {
                        setRowsPerPage(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      style={{
                        padding: '3px 8px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        backgroundColor: '#f8fafc',
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                      }}
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                      type="button"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      style={{
                        padding: '6px 10px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        backgroundColor: currentPage === 1 ? '#f8fafc' : '#ffffff',
                        color: currentPage === 1 ? '#94a3b8' : '#334155',
                        cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span style={{ fontSize: '0.8rem', fontWeight: '600', padding: '0 8px', color: '#334155' }}>
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      style={{
                        padding: '6px 10px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        backgroundColor: currentPage === totalPages ? '#f8fafc' : '#ffffff',
                        color: currentPage === totalPages ? '#94a3b8' : '#334155',
                        cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 6. Section 5: View Attendance Details Modal */}
      <Modal
        isOpen={isViewModalOpen}
        onClose={() => setIsViewModalOpen(false)}
        title="Attendance Verification Details"
        subtitle={
          viewRecord
            ? `${viewRecord.employeeName} (${viewRecord.employeeId}) • ${formatDisplayDate(viewRecord.date)}`
            : ''
        }
      >
        {viewRecord && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Top Employee Profile Badge */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                backgroundColor: '#f8fafc',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
              }}
            >
              <div>
                <div style={{ fontSize: '1.05rem', fontWeight: '700', color: '#0b3d2b' }}>
                  {viewRecord.employeeName}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  ID: <span style={{ fontWeight: '600' }}>{viewRecord.employeeId}</span> • Dept:{' '}
                  <span style={{ fontWeight: '600' }}>{viewRecord.department}</span>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: '700',
                    padding: '3px 10px',
                    borderRadius: '6px',
                    backgroundColor:
                      (viewRecord.workMode || '').toUpperCase() === 'WFO' ? '#f0fdf4' : '#eff6ff',
                    color: (viewRecord.workMode || '').toUpperCase() === 'WFO' ? '#15803d' : '#1d4ed8',
                    border:
                      (viewRecord.workMode || '').toUpperCase() === 'WFO'
                        ? '1px solid #bbf7d0'
                        : '1px solid #bfdbfe',
                  }}
                >
                  {viewRecord.workMode || 'WFO'}
                </span>
              </div>
            </div>

            {/* Timings & Status Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              <div
                style={{
                  backgroundColor: '#ffffff',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>
                  Check-In Time
                </div>
                <div style={{ fontSize: '0.98rem', fontWeight: '700', color: '#0b3d2b', marginTop: '2px' }}>
                  {viewRecord.checkIn || '--'}
                </div>
              </div>
              <div
                style={{
                  backgroundColor: '#ffffff',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>
                  Check-Out Time
                </div>
                <div style={{ fontSize: '0.98rem', fontWeight: '700', color: '#0b3d2b', marginTop: '2px' }}>
                  {viewRecord.checkOut || '--'}
                </div>
              </div>
              <div
                style={{
                  backgroundColor: '#ffffff',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>
                  Working Duration
                </div>
                <div style={{ fontSize: '0.98rem', fontWeight: '700', color: '#0f766e', marginTop: '2px' }}>
                  {viewRecord.duration || '--'}
                </div>
              </div>
              <div
                style={{
                  backgroundColor: '#ffffff',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>
                  Attendance Status
                </div>
                <div style={{ fontSize: '0.98rem', fontWeight: '700', color: '#0b3d2b', marginTop: '2px' }}>
                  {viewRecord.status || 'Present'}
                </div>
              </div>
            </div>

            {/* Late Check-in Reason Highlight Card */}
            {(viewRecord.isLate ||
              (viewRecord.status || '').toUpperCase() === 'LATE' ||
              viewRecord.lateReason) && (
              <div
                style={{
                  backgroundColor: '#fffbeb',
                  border: '1px solid #fde68a',
                  padding: '12px 14px',
                  borderRadius: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <AlertCircle size={16} color="#b45309" />
                    <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#92400e' }}>
                      LATE CHECK-IN REASON
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: '700',
                      padding: '2px 8px',
                      borderRadius: '6px',
                      backgroundColor: viewRecord.lateReason ? '#ecfdf5' : '#fef2f2',
                      color: viewRecord.lateReason ? '#047857' : '#b91c1c',
                      border: `1px solid ${viewRecord.lateReason ? '#a7f3d0' : '#fecaca'}`,
                    }}
                  >
                    {viewRecord.lateReason ? 'Reason Submitted' : 'Reason Pending'}
                  </span>
                </div>
                {viewRecord.lateReason ? (
                  <div>
                    <p
                      style={{
                        fontSize: '0.85rem',
                        color: '#451a03',
                        margin: 0,
                        fontStyle: 'italic',
                        backgroundColor: '#ffffff',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: '1px solid #fef3c7',
                        lineHeight: 1.4,
                      }}
                    >
                      "{viewRecord.lateReason}"
                    </p>
                    {viewRecord.lateReasonSubmittedAt && (
                      <div style={{ fontSize: '0.7rem', color: '#b45309', marginTop: '6px' }}>
                        Recorded at:{' '}
                        {new Date(viewRecord.lateReasonSubmittedAt).toLocaleString('en-IN', {
                          timeZone: 'Asia/Kolkata',
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: '#b91c1c' }}>
                    No late check-in explanation has been provided by the employee yet.
                  </div>
                )}
              </div>
            )}

            {/* GPS Location Details (For WFO or when coordinates captured) */}
            {viewRecord.checkInLatitude !== null &&
              viewRecord.checkInLatitude !== undefined &&
              viewRecord.checkInLongitude !== null &&
              viewRecord.checkInLongitude !== undefined && (
                <div
                  style={{
                    backgroundColor: '#f0fdfa',
                    border: '1px solid #99f6e4',
                    padding: '12px 14px',
                    borderRadius: '12px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <MapPin size={15} color="#0f766e" />
                      <span style={{ fontSize: '0.78rem', fontWeight: '700', color: '#0f766e' }}>
                        GPS Location Captured:
                      </span>
                    </div>
                    <a
                      href={`https://www.google.com/maps?q=${viewRecord.checkInLatitude},${viewRecord.checkInLongitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: '0.72rem',
                        color: '#0d9488',
                        fontWeight: '700',
                        textDecoration: 'underline',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                      }}
                    >
                      <span>View on Google Maps</span>
                      <ExternalLink size={12} />
                    </a>
                  </div>
                  <div style={{ fontSize: '0.85rem', fontWeight: '700', color: '#134e4a' }}>
                    {Number(viewRecord.checkInLatitude).toFixed(6)}°,{' '}
                    {Number(viewRecord.checkInLongitude).toFixed(6)}°
                  </div>
                  {viewRecord.checkInLocationAccuracy && (
                    <div style={{ fontSize: '0.72rem', color: '#0d9488', marginTop: '2px' }}>
                      Accuracy Radius: ±{Math.round(viewRecord.checkInLocationAccuracy)} meters
                    </div>
                  )}
                </div>
              )}

            {/* Selfie / Image Verification */}
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: '700', color: '#0b3d2b', marginBottom: '8px' }}>
                Captured Attendance Photo Verification:
              </div>
              {isPhotoLoading ? (
                <div
                  style={{
                    padding: '24px',
                    textAlign: 'center',
                    color: '#64748b',
                    backgroundColor: '#f8fafc',
                    borderRadius: '12px',
                  }}
                >
                  Loading photo...
                </div>
              ) : viewPhotoUrl ? (
                <div
                  style={{
                    width: '100%',
                    maxHeight: '260px',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    backgroundColor: '#0f172a',
                    display: 'flex',
                    justifyContent: 'center',
                  }}
                >
                  <img
                    src={viewPhotoUrl}
                    alt="Employee Check-in Selfie"
                    style={{ maxHeight: '260px', maxWidth: '100%', objectFit: 'contain' }}
                  />
                </div>
              ) : (
                <div
                  style={{
                    padding: '20px',
                    textAlign: 'center',
                    color: '#94a3b8',
                    backgroundColor: '#f8fafc',
                    borderRadius: '12px',
                    fontSize: '0.85rem',
                  }}
                >
                  No photo stored for this attendance record.
                </div>
              )}
            </div>

            {/* Modal Bottom Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button
                type="button"
                className="btn-modal-cancel"
                onClick={() => setIsViewModalOpen(false)}
                style={{ width: 'auto', padding: '0 20px', height: '38px' }}
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsViewModalOpen(false);
                  handleOpenEdit(viewRecord);
                }}
                style={{
                  height: '38px',
                  padding: '0 18px',
                  borderRadius: '10px',
                  border: 'none',
                  backgroundColor: '#0b3d2b',
                  color: '#ffffff',
                  fontSize: '0.825rem',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Edit2 size={14} />
                <span>Adjust Record</span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* 7. Adjust Attendance Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="Adjust Attendance Record"
        subtitle={
          selectedRecord
            ? `Editing entry for ${selectedRecord.employeeName} (${selectedRecord.employeeId}) • ${formatDisplayDate(
                selectedRecord.date
              )}`
            : ''
        }
      >
        {selectedRecord && (
          <form onSubmit={handleSaveEdit}>
            <div className="form-group">
              <label className="form-label">Attendance Status</label>
              <select
                className="form-input-auth"
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
              >
                <option value="Present">Present</option>
                <option value="Late">Late</option>
                <option value="Absent">Absent</option>
                <option value="Half Day">Half Day</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Work Mode</label>
              <select
                className="form-input-auth"
                value={editWorkMode}
                onChange={(e) => setEditWorkMode(e.target.value)}
              >
                <option value="WFO">Work From Office (WFO)</option>
                <option value="WFH">Work From Home (WFH)</option>
                <option value="--">None / Absent</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Check-In Time</label>
              <input
                type="text"
                className="form-input-auth"
                placeholder="e.g. 09:15 AM"
                value={editCheckIn}
                onChange={(e) => setEditCheckIn(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Check-Out Time</label>
              <input
                type="text"
                className="form-input-auth"
                placeholder="e.g. 06:30 PM or --"
                value={editCheckOut}
                onChange={(e) => setEditCheckOut(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Late Arrival Reason</label>
              <textarea
                className="form-input-auth"
                rows={2}
                placeholder="Official reason for late check-in..."
                value={editLateReason}
                onChange={(e) => setEditLateReason(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button
                type="button"
                className="btn-secondary-gray"
                style={{ width: 'auto', padding: '0 16px', height: '38px' }}
                onClick={() => setIsEditModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSavingEdit}
                style={{
                  height: '38px',
                  padding: '0 20px',
                  borderRadius: '10px',
                  border: 'none',
                  backgroundColor: '#0b3d2b',
                  color: '#ffffff',
                  fontSize: '0.825rem',
                  fontWeight: '700',
                  cursor: isSavingEdit ? 'not-allowed' : 'pointer',
                  opacity: isSavingEdit ? 0.7 : 1,
                }}
              >
                {isSavingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
