import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  FolderKanban,
  Users,
  PlusCircle,
  UserCheck,
  Calendar,
  Activity,
  FileText,
  CheckCircle2,
  XCircle,
  RotateCcw,
  BarChart3,
  Search,
  Filter,
  Clock,
  AlertCircle,
  AlertTriangle,
  Check,
  X,
  RefreshCw,
  Send,
  ArrowRight,
  TrendingUp,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Plus,
  Eye,
  MessageSquare,
} from 'lucide-react';
import Modal from '../../components/common/Modal';
import { teamLeaderService } from '../../services/teamLeaderService';
import WorkUpdatesDrilldown from '../../components/work-updates/WorkUpdatesDrilldown';

// Arshith Connect - Team Leader Dashboard
export default function TeamLeaderDashboard({ activeTab = 'projects', onTabChange, openCreateTaskSignal }) {
  // Master state
  const [loading, setLoading] = useState(true);
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);
  const isFetchingRef = useRef(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successToast, setSuccessToast] = useState('');

  // Data states
  const [projects, setProjects] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [workUpdates, setWorkUpdates] = useState([]);
  const [performance, setPerformance] = useState(null);

  // Filters & search
  const [searchQuery, setSearchQuery] = useState('');
  const [taskStatusFilter, setTaskStatusFilter] = useState('ALL');
  const [selectedProjectId, setSelectedProjectId] = useState('ALL');
  const [expandedProjectId, setExpandedProjectId] = useState(null);

  // Modals state
  const [isCreateTaskModalOpen, setIsCreateTaskModalOpen] = useState(false);
  const [isDeadlineModalOpen, setIsDeadlineModalOpen] = useState(false);
  const [isReworkModalOpen, setIsReworkModalOpen] = useState(false);
  const [isWorkUpdateModalOpen, setIsWorkUpdateModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);

  // Form states
  const [taskForm, setTaskForm] = useState({
    project_id: '',
    title: '',
    description: '',
    assigned_to: '',
    deadline: '',
    priority: 'High',
    estimated_hours: 8.0,
  });

  const [deadlineForm, setDeadlineForm] = useState({
    deadline: '',
    priority: 'High',
    notes: '',
  });

  const [reworkForm, setReworkForm] = useState({
    rework_notes: '',
    revised_deadline: '',
  });

  const [updateForm, setUpdateForm] = useState({
    project_id: '',
    task_id: '',
    employee_name: '',
    hours_worked: 8,
    summary: '',
    blockers: 'None',
  });

  // Current logged in user info
  const storedUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('arshith_user')) || null;
    } catch {
      return null;
    }
  }, []);
  const leaderName = storedUser?.name || storedUser?.fullName || 'Arshith';
  const leaderEmail = storedUser?.email || 'teamlead@arshith.com';

  const showToast = (msg) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(''), 4000);
  };

  // Load all dashboard data
  const loadDashboardData = useCallback(async (silent = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (!silent) setLoading(true);
    setErrorMsg('');
    try {
      const [projData, teamData, taskData, updateData, perfData] = await Promise.all([
        teamLeaderService.getAssignedProjects(),
        teamLeaderService.getAssignedTeam(),
        teamLeaderService.getTasks(),
        teamLeaderService.getDailyWorkUpdates(),
        teamLeaderService.getTeamPerformance(),
      ]);

      setProjects(projData || []);
      setTeamMembers(teamData || []);
      setTasks(taskData || []);
      setWorkUpdates(updateData || []);
      setPerformance(perfData || null);

      if (projData && projData.length > 0) {
        setTaskForm((prev) => (prev.project_id ? prev : { ...prev, project_id: projData[0].id }));
        setUpdateForm((prev) => (prev.project_id ? prev : { ...prev, project_id: projData[0].id }));
      }
      if (teamData && teamData.length > 0) {
        setTaskForm((prev) => (prev.assigned_to ? prev : { ...prev, assigned_to: teamData[0].name }));
        setUpdateForm((prev) => (prev.employee_name ? prev : { ...prev, employee_name: teamData[0].name }));
      }
    } catch (err) {
      setErrorMsg(err.response?.data?.detail || err.message || 'Failed to fetch team leader data.');
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData(false);
    const handleFocus = () => loadDashboardData(true);
    window.addEventListener('focus', handleFocus);
    const interval = setInterval(() => {
      loadDashboardData(true);
    }, 12000);
    return () => {
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
    };
  }, [loadDashboardData]);

  // Handle opening the Create Task modal from sidebar or top navigation
  useEffect(() => {
    if (openCreateTaskSignal > 0) {
      openCreateTaskForProject(projects[0]);
    }
  }, [openCreateTaskSignal, projects]);

  useEffect(() => {
    if (activeTab === 'create-task') {
      openCreateTaskForProject(projects[0]);
      if (onTabChange) {
        onTabChange('tasks');
      }
    }
  }, [activeTab, projects, onTabChange]);

  // Derived filtered tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      const matchSearch =
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.assigned_to.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.project_name.toLowerCase().includes(searchQuery.toLowerCase());

      const matchStatus = taskStatusFilter === 'ALL' || t.status.toUpperCase() === taskStatusFilter.toUpperCase();
      const matchProj = selectedProjectId === 'ALL' || t.project_id === selectedProjectId;

      return matchSearch && matchStatus && matchProj;
    });
  }, [tasks, searchQuery, taskStatusFilter, selectedProjectId]);

  // Submitted tasks awaiting review
  const submittedTasks = useMemo(() => {
    return tasks.filter((t) => t.status === 'SUBMITTED' || t.status === 'In Review');
  }, [tasks]);

  // Active rework items
  const reworkTasks = useMemo(() => {
    return tasks.filter((t) => t.status === 'REWORK');
  }, [tasks]);

  // Project & employee filtering for task creation (includes project members and all team roster members)
  const selectedProjectForTask = useMemo(() => {
    return projects.find((p) => p.id === taskForm.project_id) || projects[0] || null;
  }, [projects, taskForm.project_id]);

  const availableEmployeesForTask = useMemo(() => {
    const list = [];
    const seenNames = new Set();

    // 1. Project-assigned employees first
    const rawAssigned = selectedProjectForTask?.assigned_employees || [];
    rawAssigned.forEach((empName) => {
      const cleanName = String(empName || '').trim();
      if (!cleanName || seenNames.has(cleanName.toLowerCase())) return;
      seenNames.add(cleanName.toLowerCase());
      const matched = teamMembers.find(
        (m) => String(m.name || '').toLowerCase().trim() === cleanName.toLowerCase()
      );
      list.push({
        id: matched?.id || cleanName,
        name: cleanName,
        email: matched?.email || '',
        department: matched?.department || selectedProjectForTask?.department || 'Operations',
        designation: matched?.designation || 'Project Member',
        isDirectProjectMember: true,
      });
    });

    // 2. All team roster members
    teamMembers.forEach((m) => {
      const cleanName = String(m.name || '').trim();
      if (!cleanName || seenNames.has(cleanName.toLowerCase())) return;
      seenNames.add(cleanName.toLowerCase());
      list.push({
        id: m.id || cleanName,
        name: cleanName,
        email: m.email || '',
        department: m.department || selectedProjectForTask?.department || 'Operations',
        designation: m.designation || 'Team Member',
        isDirectProjectMember: false,
      });
    });

    return list;
  }, [selectedProjectForTask, teamMembers]);

  // Ensure taskForm.assigned_to is always set to a valid employee name
  useEffect(() => {
    if (availableEmployeesForTask.length > 0) {
      if (!taskForm.assigned_to || !availableEmployeesForTask.some((m) => m.name === taskForm.assigned_to)) {
        setTaskForm((prev) => ({ ...prev, assigned_to: availableEmployeesForTask[0].name }));
      }
    }
  }, [availableEmployeesForTask, taskForm.assigned_to]);

  // Deadline urgency calculator helper
  const getDeadlineUrgency = useCallback((deadlineStr) => {
    if (!deadlineStr) return { status: 'none', label: 'No Deadline', color: '#64748b', bg: '#f1f5f9' };
    let targetDate = null;
    const partsHyphen = String(deadlineStr).split('-');
    if (partsHyphen.length === 3) {
      if (partsHyphen[0].length === 4) {
        targetDate = new Date(`${partsHyphen[0]}-${partsHyphen[1]}-${partsHyphen[2]}T23:59:59`);
      } else if (partsHyphen[2].length === 4) {
        targetDate = new Date(`${partsHyphen[2]}-${partsHyphen[1]}-${partsHyphen[0]}T23:59:59`);
      }
    }
    if (!targetDate || isNaN(targetDate.getTime())) {
      targetDate = new Date(deadlineStr);
    }
    if (isNaN(targetDate.getTime())) {
      return { status: 'set', label: deadlineStr, color: '#0b3d2b', bg: '#ecfdf5' };
    }
    const now = new Date();
    const diffMs = targetDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return {
        status: 'overdue',
        label: `Overdue by ${Math.abs(diffDays)}d`,
        color: '#dc2626',
        bg: '#fee2e2',
        border: '#fca5a5',
        days: diffDays,
      };
    } else if (diffDays === 0) {
      return {
        status: 'today',
        label: 'Due Today',
        color: '#d97706',
        bg: '#fef3c7',
        border: '#fde68a',
        days: 0,
      };
    } else if (diffDays <= 2) {
      return {
        status: 'urgent',
        label: `Due in ${diffDays}d`,
        color: '#d97706',
        bg: '#fef3c7',
        border: '#fde68a',
        days: diffDays,
      };
    } else {
      return {
        status: 'upcoming',
        label: `${diffDays} days left`,
        color: '#047857',
        bg: '#ecfdf5',
        border: '#a7f3d0',
        days: diffDays,
      };
    }
  }, []);

  // Quick deadline extension helper
  const handleQuickExtendDeadline = async (task, daysToAdd) => {
    try {
      let baseDate = new Date();
      if (task.deadline) {
        const parsed = new Date(task.deadline);
        if (!isNaN(parsed.getTime()) && parsed > baseDate) {
          baseDate = parsed;
        }
      }
      baseDate.setDate(baseDate.getDate() + daysToAdd);
      const newDeadlineIso = baseDate.toISOString().split('T')[0];
      const updated = await teamLeaderService.updateTaskDeadline(task.id, {
        deadline: newDeadlineIso,
        priority: task.priority || 'High',
        notes: `Quick deadline extension (+${daysToAdd} days) by Team Leader`,
      });
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      showToast(`Deadline for "${task.title}" extended by ${daysToAdd} days (${newDeadlineIso}).`);
    } catch (err) {
      alert(err.response?.data?.detail || err.message || 'Failed to extend deadline.');
    }
  };

  const toggleProjectEmployees = (projId) => {
    setExpandedProjectId((prev) => (prev === projId ? null : projId));
  };

  const openCreateTaskForProject = (proj, employeeName = '') => {
    const targetProj = proj || (projects && projects.length > 0 ? projects[0] : null);
    const rawAssigned = targetProj?.assigned_employees || [];
    let targetEmp = employeeName;
    if (!targetEmp) {
      if (rawAssigned.length > 0) {
        targetEmp = rawAssigned[0];
      } else if (teamMembers.length > 0) {
        targetEmp = teamMembers[0].name;
      }
    }
    setTaskForm({
      project_id: targetProj?.id || (projects[0]?.id || ''),
      title: '',
      description: '',
      assigned_to: targetEmp || '',
      deadline: targetProj?.deadline || '',
      priority: 'High',
      estimated_hours: 8.0,
    });
    setIsCreateTaskModalOpen(true);
  };

  const openWorkUpdateModal = (projectId = '', employeeName = '', taskId = '') => {
    const targetProjId = projectId || (projects && projects.length > 0 ? projects[0].id : '');
    let targetEmpName = employeeName;
    if (!targetEmpName && teamMembers && teamMembers.length > 0) {
      targetEmpName = teamMembers[0].name;
    }
    setUpdateForm({
      project_id: targetProjId,
      task_id: taskId || '',
      employee_name: targetEmpName || '',
      hours_worked: 8,
      summary: '',
      blockers: 'None',
    });
    setIsWorkUpdateModalOpen(true);
  };

  const openPdfViewer = (pdfData, pdfName = 'Project_Proposal.pdf') => {
    if (!pdfData) return;
    if (pdfData.startsWith('data:application/pdf') || pdfData.startsWith('data:')) {
      const pdfWindow = window.open('', '_blank');
      if (pdfWindow) {
        pdfWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>${pdfName}</title>
              <style>
                body, html { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #525659; font-family: system-ui, -apple-system, sans-serif; }
                .topbar { display: flex; align-items: center; justify-content: space-between; background: #0b3d2b; color: #ffffff; padding: 10px 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.25); }
                .topbar .title { font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
                .topbar a.download-btn { background: #0f766e; color: #ffffff; padding: 6px 14px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 700; transition: background 0.15s; }
                .topbar a.download-btn:hover { background: #14b8a6; }
                iframe { border: none; width: 100%; height: calc(100% - 48px); }
              </style>
            </head>
            <body>
              <div class="topbar">
                <div class="title">📄 ${pdfName}</div>
                <a class="download-btn" href="${pdfData}" download="${pdfName}">⬇ Download Proposal PDF</a>
              </div>
              <iframe src="${pdfData}" type="application/pdf"></iframe>
            </body>
          </html>
        `);
        pdfWindow.document.close();
      } else {
        window.open(pdfData, '_blank');
      }
    } else {
      window.open(pdfData, '_blank');
    }
  };

  const handleProjectSelectInTaskForm = (projId) => {
    const proj = projects.find((p) => p.id === projId);
    const assigned = proj?.assigned_employees || [];
    setTaskForm((prev) => ({
      ...prev,
      project_id: projId,
      assigned_to: assigned.length > 0 ? assigned[0] : (teamMembers[0]?.name || ''),
      deadline: proj?.deadline || prev.deadline,
    }));
  };

  // -------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------

  // Req 8 & 9: Create & Assign Task
  const handleCreateTask = async (e) => {
    e.preventDefault();
    if (isSubmittingTask) return;
    try {
      setIsSubmittingTask(true);
      const newTask = await teamLeaderService.createTask(taskForm);
      setTasks((prev) =>
        prev.some((t) => t.id === newTask.id)
          ? prev.map((t) => (t.id === newTask.id ? newTask : t))
          : [newTask, ...prev]
      );
      setIsCreateTaskModalOpen(false);
      showToast(`Task "${newTask.title}" created & assigned to ${newTask.assigned_to}!`);
      setTaskForm({
        project_id: projects[0]?.id || '',
        title: '',
        description: '',
        assigned_to: teamMembers[0]?.name || '',
        deadline: '',
        priority: 'High',
        estimated_hours: 8.0,
      });
      loadDashboardData(true);
    } catch (err) {
      alert(err.response?.data?.detail || err.message || 'Failed to create task.');
    } finally {
      setIsSubmittingTask(false);
    }
  };

  // Req 10: Set Task Deadline
  const handleOpenDeadlineModal = (task) => {
    setSelectedTask(task);
    setDeadlineForm({
      deadline: task.deadline || '',
      priority: task.priority || 'High',
      notes: '',
    });
    setIsDeadlineModalOpen(true);
  };

  const handleUpdateDeadline = async (e) => {
    e.preventDefault();
    if (!selectedTask) return;
    try {
      const updated = await teamLeaderService.updateTaskDeadline(selectedTask.id, deadlineForm);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setIsDeadlineModalOpen(false);
      showToast(`Deadline for "${updated.title}" updated to ${updated.deadline}.`);
    } catch (err) {
      alert(err.response?.data?.detail || err.message || 'Failed to update deadline.');
    }
  };

  // Req 14: Approve Task
  const handleApproveTask = async (task) => {
    if (!window.confirm(`Approve task "${task.title}" submitted by ${task.assigned_to}?`)) return;
    try {
      const updated = await teamLeaderService.reviewTask(task.id, {
        action: 'approve',
        feedback: 'Deliverable inspected and approved by Team Leader.',
      });
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      showToast(`Task "${task.title}" approved successfully!`);
      loadDashboardData(true);
    } catch (err) {
      alert(err.response?.data?.detail || err.message || 'Failed to approve task.');
    }
  };

  // Req 14: Reject Task
  const handleRejectTask = async (task) => {
    const reason = window.prompt(`Enter rejection reason for "${task.title}":`, 'Deliverables did not pass validation criteria.');
    if (!reason) return;
    try {
      const updated = await teamLeaderService.reviewTask(task.id, {
        action: 'reject',
        feedback: reason,
      });
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      showToast(`Task "${task.title}" marked as rejected.`);
      loadDashboardData(true);
    } catch (err) {
      alert(err.response?.data?.detail || err.message || 'Failed to reject task.');
    }
  };

  // Req 15: Assign Rework
  const handleOpenReworkModal = (task) => {
    setSelectedTask(task);
    setReworkForm({
      rework_notes: '',
      revised_deadline: task.deadline || '',
    });
    setIsReworkModalOpen(true);
  };

  const handleAssignRework = async (e) => {
    e.preventDefault();
    if (!selectedTask) return;
    try {
      const updated = await teamLeaderService.reviewTask(selectedTask.id, {
        action: 'rework',
        rework_notes: reworkForm.rework_notes,
        revised_deadline: reworkForm.revised_deadline,
      });
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setIsReworkModalOpen(false);
      showToast(`Rework assigned for "${selectedTask.title}". Feedback sent to ${selectedTask.assigned_to}.`);
      loadDashboardData(true);
    } catch (err) {
      alert(err.response?.data?.detail || err.message || 'Failed to assign rework.');
    }
  };

  // Req 12: Submit Daily Work Update
  const handleSubmitWorkUpdate = async (e) => {
    e.preventDefault();
    try {
      const newUpdate = await teamLeaderService.createDailyWorkUpdate(updateForm);
      setWorkUpdates((prev) => [newUpdate, ...prev]);
      setIsWorkUpdateModalOpen(false);
      showToast(`Daily work update recorded for ${newUpdate.employee_name}!`);
      setUpdateForm({
        project_id: projects[0]?.id || '',
        task_id: '',
        employee_name: teamMembers[0]?.name || '',
        hours_worked: 8,
        summary: '',
        blockers: 'None',
      });
    } catch (err) {
      alert(err.response?.data?.detail || err.message || 'Failed to log daily update.');
    }
  };

  return (
    <div className="admin-dashboard-view admin-main-page animate-fade-in" style={{ paddingBottom: '60px' }}>
      {/* Toast Notification */}
      {successToast && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '24px',
            zIndex: 3000,
            backgroundColor: '#0b3d2b',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: '10px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '0.875rem',
            fontWeight: '600',
            animation: 'modalBackdropIn 0.2s ease-out forwards',
          }}
        >
          <CheckCircle2 size={18} color="#4ade80" />
          <span>{successToast}</span>
        </div>
      )}

      {/* Hero Header Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0b3d2b 0%, #0f766e 100%)',
          borderRadius: '18px',
          padding: '24px 28px',
          color: '#ffffff',
          marginBottom: '24px',
          boxShadow: '0 10px 30px rgba(11, 61, 43, 0.15)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.2)',
                padding: '3px 10px',
                borderRadius: '999px',
                fontSize: '0.75rem',
                fontWeight: '700',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              Sprint Leadership Portal
            </span>
            <span style={{ fontSize: '0.8rem', opacity: 0.9 }}>
              Logged in as <strong>{leaderName}</strong> ({leaderEmail})
            </span>
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '800', margin: 0, letterSpacing: '-0.02em' }}>
            Team Leader Operations Dashboard
          </h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.88rem', opacity: 0.85 }}>
            Delegate sprint tasks, enforce quality control, review submissions & monitor team performance.
          </p>
        </div>

        {/* Quick Actions */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setIsCreateTaskModalOpen(true)}
            style={{
              padding: '10px 18px',
              borderRadius: '10px',
              border: 'none',
              backgroundColor: '#ffffff',
              color: '#0b3d2b',
              fontWeight: '800',
              fontSize: '0.875rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}
          >
            <PlusCircle size={16} />
            Create Task
          </button>
          <button
            type="button"
            onClick={() => setIsWorkUpdateModalOpen(true)}
            style={{
              padding: '10px 18px',
              borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.4)',
              backgroundColor: 'rgba(255,255,255,0.15)',
              color: '#ffffff',
              fontWeight: '700',
              fontSize: '0.875rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <FileText size={16} />
            Log Work Update
          </button>
        </div>
      </div>

      {/* Top 6 KPI Metric Cards - Interactive Navigation Boxes matching Screenshot 3 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '14px',
          marginBottom: '24px',
        }}
      >
        {/* KPI 1: Assigned Projects (Req 6) */}
        <div
          className="admin-stat-card"
          onClick={() => onTabChange && onTabChange('projects')}
          role="button"
          tabIndex={0}
          title="Click to view Assigned Projects"
          style={{
            padding: '16px 18px',
            borderLeft: '4px solid #0b3d2b',
            cursor: 'pointer',
            backgroundColor: (activeTab === 'projects' || activeTab === 'dashboard') ? '#ecfdf5' : '#ffffff',
            boxShadow: (activeTab === 'projects' || activeTab === 'dashboard') ? '0 6px 16px rgba(11,61,43,0.12)' : '0 2px 6px rgba(0,0,0,0.03)',
            borderRadius: '12px',
            borderTop: (activeTab === 'projects' || activeTab === 'dashboard') ? '2px solid #0b3d2b' : '1px solid #e2e8f0',
            borderRight: (activeTab === 'projects' || activeTab === 'dashboard') ? '2px solid #0b3d2b' : '1px solid #e2e8f0',
            borderBottom: (activeTab === 'projects' || activeTab === 'dashboard') ? '2px solid #0b3d2b' : '1px solid #e2e8f0',
            transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
            transform: (activeTab === 'projects' || activeTab === 'dashboard') ? 'translateY(-2px)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: '800', color: (activeTab === 'projects' || activeTab === 'dashboard') ? '#0b3d2b' : '#64748b', textTransform: 'uppercase' }}>
              ASSIGNED PROJECTS
            </span>
            <FolderKanban size={18} color="#0b3d2b" />
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#0b3d2b' }}>
            {projects.length}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
            Active lead projects
          </div>
        </div>

        {/* KPI 2: Assigned Team */}
        <div
          className="admin-stat-card"
          onClick={() => onTabChange && onTabChange('team')}
          role="button"
          tabIndex={0}
          title="Click to view Assigned Team"
          style={{
            padding: '16px 18px',
            borderLeft: '4px solid #0f766e',
            cursor: 'pointer',
            backgroundColor: activeTab === 'team' ? '#f0fdfa' : '#ffffff',
            boxShadow: activeTab === 'team' ? '0 6px 16px rgba(15,118,110,0.12)' : '0 2px 6px rgba(0,0,0,0.03)',
            borderRadius: '12px',
            borderTop: activeTab === 'team' ? '2px solid #0f766e' : '1px solid #e2e8f0',
            borderRight: activeTab === 'team' ? '2px solid #0f766e' : '1px solid #e2e8f0',
            borderBottom: activeTab === 'team' ? '2px solid #0f766e' : '1px solid #e2e8f0',
            transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
            transform: activeTab === 'team' ? 'translateY(-2px)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: '800', color: activeTab === 'team' ? '#0f766e' : '#64748b', textTransform: 'uppercase' }}>
              ASSIGNED TEAM
            </span>
            <Users size={18} color="#0f766e" />
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#0f766e' }}>
            {teamMembers.length}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
            Team members in roster
          </div>
        </div>

        {/* KPI 3: Total Tasks */}
        <div
          className="admin-stat-card"
          onClick={() => onTabChange && onTabChange('tasks')}
          role="button"
          tabIndex={0}
          title="Click to view Task Management"
          style={{
            padding: '16px 18px',
            borderLeft: '4px solid #3b82f6',
            cursor: 'pointer',
            backgroundColor: (activeTab === 'tasks' || activeTab === 'deadlines' || activeTab === 'monitor-work') ? '#eff6ff' : '#ffffff',
            boxShadow: (activeTab === 'tasks' || activeTab === 'deadlines' || activeTab === 'monitor-work') ? '0 6px 16px rgba(59,130,246,0.12)' : '0 2px 6px rgba(0,0,0,0.03)',
            borderRadius: '12px',
            borderTop: (activeTab === 'tasks' || activeTab === 'deadlines' || activeTab === 'monitor-work') ? '2px solid #3b82f6' : '1px solid #e2e8f0',
            borderRight: (activeTab === 'tasks' || activeTab === 'deadlines' || activeTab === 'monitor-work') ? '2px solid #3b82f6' : '1px solid #e2e8f0',
            borderBottom: (activeTab === 'tasks' || activeTab === 'deadlines' || activeTab === 'monitor-work') ? '2px solid #3b82f6' : '1px solid #e2e8f0',
            transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
            transform: (activeTab === 'tasks' || activeTab === 'deadlines' || activeTab === 'monitor-work') ? 'translateY(-2px)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: '800', color: (activeTab === 'tasks' || activeTab === 'deadlines' || activeTab === 'monitor-work') ? '#1d4ed8' : '#64748b', textTransform: 'uppercase' }}>
              TOTAL TASKS
            </span>
            <Activity size={18} color="#3b82f6" />
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#1e40af' }}>
            {tasks.length}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
            Delegated deliverables
          </div>
        </div>

        {/* KPI 4: Submitted for Review */}
        <div
          className="admin-stat-card"
          onClick={() => onTabChange && onTabChange('task-review')}
          role="button"
          tabIndex={0}
          title="Click to view Review Queue"
          style={{
            padding: '16px 18px',
            borderLeft: '4px solid #f59e0b',
            cursor: 'pointer',
            backgroundColor: (activeTab === 'task-review' || activeTab === 'submitted-tasks') ? '#fffbeb' : '#ffffff',
            boxShadow: (activeTab === 'task-review' || activeTab === 'submitted-tasks') ? '0 6px 16px rgba(245,158,11,0.12)' : '0 2px 6px rgba(0,0,0,0.03)',
            borderRadius: '12px',
            borderTop: (activeTab === 'task-review' || activeTab === 'submitted-tasks') ? '2px solid #f59e0b' : '1px solid #e2e8f0',
            borderRight: (activeTab === 'task-review' || activeTab === 'submitted-tasks') ? '2px solid #f59e0b' : '1px solid #e2e8f0',
            borderBottom: (activeTab === 'task-review' || activeTab === 'submitted-tasks') ? '2px solid #f59e0b' : '1px solid #e2e8f0',
            transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
            transform: (activeTab === 'task-review' || activeTab === 'submitted-tasks') ? 'translateY(-2px)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: '800', color: (activeTab === 'task-review' || activeTab === 'submitted-tasks') ? '#b45309' : '#64748b', textTransform: 'uppercase' }}>
              REVIEW QUEUE
            </span>
            <CheckCircle2 size={18} color="#f59e0b" />
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#b45309' }}>
            {submittedTasks.length}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
            Awaiting TL decision
          </div>
        </div>

        {/* KPI 5: Active Rework */}
        <div
          className="admin-stat-card"
          onClick={() => onTabChange && onTabChange('rework')}
          role="button"
          tabIndex={0}
          title="Click to view Active Rework"
          style={{
            padding: '16px 18px',
            borderLeft: '4px solid #ef4444',
            cursor: 'pointer',
            backgroundColor: activeTab === 'rework' ? '#fef2f2' : '#ffffff',
            boxShadow: activeTab === 'rework' ? '0 6px 16px rgba(239,68,68,0.12)' : '0 2px 6px rgba(0,0,0,0.03)',
            borderRadius: '12px',
            borderTop: activeTab === 'rework' ? '2px solid #ef4444' : '1px solid #e2e8f0',
            borderRight: activeTab === 'rework' ? '2px solid #ef4444' : '1px solid #e2e8f0',
            borderBottom: activeTab === 'rework' ? '2px solid #ef4444' : '1px solid #e2e8f0',
            transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
            transform: activeTab === 'rework' ? 'translateY(-2px)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: '800', color: activeTab === 'rework' ? '#b91c1c' : '#64748b', textTransform: 'uppercase' }}>
              ACTIVE REWORK
            </span>
            <RotateCcw size={18} color="#ef4444" />
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#b91c1c' }}>
            {reworkTasks.length}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
            Tasks under revision
          </div>
        </div>

        {/* KPI 6: Team Velocity */}
        <div
          className="admin-stat-card"
          onClick={() => onTabChange && onTabChange('performance')}
          role="button"
          tabIndex={0}
          title="Click to view Team Performance"
          style={{
            padding: '16px 18px',
            borderLeft: '4px solid #10b981',
            cursor: 'pointer',
            backgroundColor: activeTab === 'performance' ? '#ecfdf5' : '#ffffff',
            boxShadow: activeTab === 'performance' ? '0 6px 16px rgba(16,185,129,0.12)' : '0 2px 6px rgba(0,0,0,0.03)',
            borderRadius: '12px',
            borderTop: activeTab === 'performance' ? '2px solid #10b981' : '1px solid #e2e8f0',
            borderRight: activeTab === 'performance' ? '2px solid #10b981' : '1px solid #e2e8f0',
            borderBottom: activeTab === 'performance' ? '2px solid #10b981' : '1px solid #e2e8f0',
            transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
            transform: activeTab === 'performance' ? 'translateY(-2px)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: '800', color: activeTab === 'performance' ? '#047857' : '#64748b', textTransform: 'uppercase' }}>
              COMPLETION RATE
            </span>
            <TrendingUp size={18} color="#10b981" />
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#047857' }}>
            {performance?.completion_rate_percentage || 0}%
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
            Team delivery velocity
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '2px solid #e2e8f0',
          marginBottom: '20px',
          overflowX: 'auto',
          paddingBottom: '2px',
        }}
      >
        {[
          { key: 'projects', label: 'Assigned Projects', icon: FolderKanban },
          { key: 'team', label: 'Assigned Team', icon: Users },
          { key: 'create-task', label: '+ Create Tasks', icon: PlusCircle, isAction: true },
          { key: 'tasks', label: 'Task Management', icon: UserCheck },
          { key: 'deadlines', label: 'Set Deadlines', icon: Calendar },
          { key: 'monitor-work', label: 'Monitor Work', icon: Activity },
          { key: 'task-review', label: `Approve / Reject (${submittedTasks.length})`, icon: CheckCircle2 },
          { key: 'work-updates', label: 'Daily Work Updates', icon: FileText },
          { key: 'rework', label: `Assign Rework (${reworkTasks.length})`, icon: RotateCcw },
          { key: 'performance', label: 'Team Performance', icon: BarChart3 },
        ].map((tab) => {
          const isActive =
            activeTab === tab.key ||
            (tab.key === 'task-review' && activeTab === 'submitted-tasks') ||
            (tab.key === 'submitted-tasks' && activeTab === 'task-review') ||
            (tab.key === 'projects' && activeTab === 'dashboard');
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                if (tab.key === 'create-task') {
                  openCreateTaskForProject(projects[0]);
                } else if (onTabChange) {
                  onTabChange(tab.key);
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 16px',
                fontSize: '0.85rem',
                fontWeight: isActive ? '800' : '600',
                color: isActive ? '#0b3d2b' : (tab.key === 'create-task' ? '#047857' : '#64748b'),
                backgroundColor: isActive ? '#ecfdf5' : (tab.key === 'create-task' ? '#f0fdf4' : 'transparent'),
                border: tab.key === 'create-task' ? '1px dashed #059669' : 'none',
                borderBottom: isActive ? '3px solid #0b3d2b' : (tab.key === 'create-task' ? '1px dashed #059669' : '3px solid transparent'),
                borderRadius: tab.key === 'create-task' ? '8px' : '8px 8px 0 0',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ========================================================= */}
      {/* TAB 1: ASSIGNED PROJECTS (REQ 6)                          */}
      {/* ========================================================= */}
      {(activeTab === 'projects' || activeTab === 'dashboard') && (
        <section className="animate-fade-in" style={{ marginBottom: '28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div>
              <h2 style={{ fontSize: '1.2rem', fontWeight: '800', color: '#0b3d2b', margin: 0 }}>
                Assigned Projects Roster
              </h2>
              <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                Projects delegated to you as Team Leader by Project HR
              </div>
            </div>
            <button
              type="button"
              onClick={loadDashboardData}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#fff',
                fontSize: '0.8rem',
                color: '#475569',
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={13} />
              Refresh
            </button>
          </div>

          {projects.length === 0 ? (
            <div className="travel-border-card" style={{ padding: '40px', textAlign: 'center', backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
              <FolderKanban size={36} color="#94a3b8" style={{ margin: '0 auto 10px auto' }} />
              <div style={{ fontSize: '0.95rem', fontWeight: '700', color: '#475569' }}>No Projects Currently Assigned</div>
              <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '4px 0 0 0' }}>
                Project HR will assign new deliverables and teams to your profile.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '16px', alignItems: 'start' }}>
              {projects.map((proj) => {
                const projTasks = tasks.filter(
                  (t) =>
                    (t.project_id && proj.id && String(t.project_id).trim() === String(proj.id).trim()) ||
                    (t.project_name && proj.name && String(t.project_name).trim().toLowerCase() === String(proj.name).trim().toLowerCase())
                );
                const computedProgress = projTasks.length > 0
                  ? Math.round(projTasks.reduce((acc, t) => acc + (Number(t.progress) || 0), 0) / projTasks.length)
                  : parseInt(proj.progress || 0, 10);
                const progress = isNaN(computedProgress) ? 0 : computedProgress;
                const isExpanded = expandedProjectId === proj.id;
                return (
                  <div
                    key={proj.id}
                    className="admin-stat-card"
                    style={{
                      padding: '20px',
                      borderRadius: '16px',
                      backgroundColor: '#ffffff',
                      border: isExpanded ? '1.5px solid #0f766e' : '1px solid #e2e8f0',
                      display: 'flex',
                      flexDirection: 'column',
                      boxShadow: isExpanded ? '0 6px 20px rgba(15, 118, 110, 0.08)' : '0 2px 6px rgba(0,0,0,0.03)',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: '4px',
                            backgroundColor: '#f1f5f9',
                            color: '#475569',
                            fontSize: '0.72rem',
                            fontWeight: '700',
                          }}
                        >
                          {proj.id} &bull; {proj.department || 'Operations'}
                        </span>
                        <span
                          style={{
                            padding: '3px 10px',
                            borderRadius: '999px',
                            fontSize: '0.72rem',
                            fontWeight: '800',
                            backgroundColor:
                              proj.status === 'Completed'
                                ? '#ecfdf5'
                                : proj.status === 'At Risk'
                                ? '#fef2f2'
                                : '#f0fdf4',
                            color:
                              proj.status === 'Completed'
                                ? '#059669'
                                : proj.status === 'At Risk'
                                ? '#dc2626'
                                : '#0b3d2b',
                          }}
                        >
                          {proj.status || 'In Progress'}
                        </span>
                      </div>

                      <h3 style={{ fontSize: '1.05rem', fontWeight: '800', color: '#0b3d2b', margin: '0 0 6px 0' }}>
                        {proj.name}
                      </h3>

                      <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 14px 0', lineHeight: '1.4' }}>
                        {proj.description || 'Sprint deliverables and team execution pipeline.'}
                      </p>

                      {/* Progress Bar */}
                      <div style={{ marginBottom: '14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', fontWeight: '700', color: '#334155', marginBottom: '4px' }}>
                          <span>Sprint Progress</span>
                          <span>{progress}%</span>
                        </div>
                        <div style={{ width: '100%', height: '8px', backgroundColor: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${progress}%`,
                              height: '100%',
                              backgroundColor: progress >= 100 ? '#10b981' : '#0b3d2b',
                              transition: 'width 0.3s ease',
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Proposal PDF View Button */}
                    {proj.proposal_pdf && (
                      <div style={{ marginBottom: '12px' }}>
                        <button
                          type="button"
                          onClick={() => openPdfViewer(proj.proposal_pdf, proj.proposal_pdf_name || `${proj.name} - Proposal.pdf`)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid #fecdd3',
                            backgroundColor: '#fff1f2',
                            color: '#be123c',
                            fontSize: '0.78rem',
                            fontWeight: '700',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            boxShadow: '0 1px 2px rgba(225, 29, 72, 0.06)',
                          }}
                          title={`Open ${proj.proposal_pdf_name || 'Project Proposal PDF'}`}
                        >
                          <FileText size={15} color="#e11d48" />
                          <span>View Proposal PDF</span>
                          {proj.proposal_pdf_name && (
                            <span style={{ fontSize: '0.7rem', color: '#9f1239', maxWidth: '170px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              ({proj.proposal_pdf_name})
                            </span>
                          )}
                        </button>
                      </div>
                    )}

                    {/* Footer Info */}
                    <div
                      style={{
                        paddingTop: '12px',
                        borderTop: '1px solid #f1f5f9',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '0.78rem',
                        color: '#64748b',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Calendar size={13} />
                        <span>Deadline: <strong>{proj.deadline}</strong></span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Users size={13} />
                        <span>{proj.assigned_employees?.length || 0} Staff</span>
                      </div>
                    </div>

                    {/* Action Bar on Each Project Card: View Assigned Employees & + Add Task */}
                    <div
                      style={{
                        paddingTop: '12px',
                        marginTop: '12px',
                        borderTop: '1px solid #f1f5f9',
                        display: 'flex',
                        gap: '8px',
                        alignItems: 'center',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleProjectEmployees(proj.id)}
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          border: '1px solid #cbd5e1',
                          backgroundColor: isExpanded ? '#f1f5f9' : '#ffffff',
                          color: '#334155',
                          fontSize: '0.78rem',
                          fontWeight: '700',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <Users size={14} color="#0f766e" />
                        <span>{isExpanded ? 'Hide Team' : 'View Assigned Employees'}</span>
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>

                      <button
                        type="button"
                        onClick={() => openCreateTaskForProject(proj)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          padding: '8px 14px',
                          borderRadius: '8px',
                          border: 'none',
                          backgroundColor: '#0b3d2b',
                          color: '#ffffff',
                          fontSize: '0.78rem',
                          fontWeight: '800',
                          cursor: 'pointer',
                          boxShadow: '0 2px 6px rgba(11,61,43,0.2)',
                          transition: 'all 0.15s ease',
                        }}
                        title={`Create task directly for project "${proj.name}"`}
                      >
                        <Plus size={14} />
                        <span>+ Add Task</span>
                      </button>
                    </div>

                    {/* Expandable Assigned Employees Tray */}
                    {isExpanded && (
                      <div
                        className="animate-fade-in"
                        style={{
                          marginTop: '12px',
                          padding: '12px',
                          borderRadius: '10px',
                          backgroundColor: '#f8fafc',
                          border: '1px solid #e2e8f0',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: '800',
                            color: '#0b3d2b',
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            marginBottom: '8px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span>Assigned Staff ({proj.assigned_employees?.length || 0})</span>
                          <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: '500', textTransform: 'none' }}>
                            Click Assign Task to delegate work
                          </span>
                        </div>

                        {(!proj.assigned_employees || proj.assigned_employees.length === 0) ? (
                          <div style={{ padding: '10px', fontSize: '0.78rem', color: '#94a3b8', textAlign: 'center' }}>
                            No employees allocated to this project yet.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {proj.assigned_employees.map((empName, eIdx) => {
                              const memberDetails = teamMembers.find(
                                (m) => String(m.name).toLowerCase().trim() === String(empName).toLowerCase().trim()
                              );
                              const empTasks = projTasks.filter(
                                (t) => String(t.assigned_to || '').trim().toLowerCase() === String(empName || '').trim().toLowerCase()
                              );
                              return (
                                <div
                                  key={eIdx}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '7px 10px',
                                    backgroundColor: '#ffffff',
                                    borderRadius: '8px',
                                    border: '1px solid #e2e8f0',
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <div
                                      style={{
                                        width: '24px',
                                        height: '24px',
                                        borderRadius: '50%',
                                        backgroundColor: '#ecfdf5',
                                        color: '#047857',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '0.72rem',
                                        fontWeight: '800',
                                      }}
                                    >
                                      {empName.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '0.8rem', fontWeight: '700', color: '#1e293b' }}>
                                        {empName}
                                      </div>
                                      <div style={{ fontSize: '0.68rem', color: '#64748b' }}>
                                        {memberDetails?.designation || 'Staff'} &bull; {memberDetails?.department || proj.department || 'Operations'}
                                        {empTasks.length > 0 && (
                                          <span style={{ marginLeft: '6px', color: '#047857', fontWeight: '700' }}>
                                            &bull; {empTasks[0].title} ({empTasks[0].progress || 0}%)
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => openCreateTaskForProject(proj, empName)}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      padding: '4px 10px',
                                      borderRadius: '6px',
                                      border: '1px solid #0b3d2b',
                                      backgroundColor: '#0b3d2b',
                                      color: '#ffffff',
                                      fontSize: '0.72rem',
                                      fontWeight: '700',
                                      cursor: 'pointer',
                                    }}
                                    title={`Assign task specifically to ${empName}`}
                                  >
                                    <Plus size={11} />
                                    <span>Assign Task</span>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ========================================================= */}
      {/* TAB 2: ASSIGNED TEAM (REQ 7)                              */}
      {/* ========================================================= */}
      {activeTab === 'team' && (
        <section className="animate-fade-in" style={{ marginBottom: '28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div>
              <h2 style={{ fontSize: '1.2rem', fontWeight: '800', color: '#0b3d2b', margin: 0 }}>
                Assigned Team Roster
              </h2>
              <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                Employees working on deliverables under your leadership
              </div>
            </div>
            <span style={{ fontSize: '0.82rem', fontWeight: '700', color: '#0f766e' }}>
              {teamMembers.length} Active Staff Members
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
            {teamMembers.map((emp) => (
              <div
                key={emp.id}
                style={{
                  padding: '16px',
                  backgroundColor: '#fff',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                }}
              >
                <div
                  style={{
                    width: '46px',
                    height: '46px',
                    borderRadius: '12px',
                    backgroundColor: '#ecfdf5',
                    color: '#0b3d2b',
                    fontSize: '1.1rem',
                    fontWeight: '800',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid #a7f3d0',
                    flexShrink: 0,
                  }}
                >
                  {emp.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: '800', color: '#1e293b', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {emp.name}
                    </h4>
                    <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#f0fdf4', color: '#166534', fontWeight: '700' }}>
                      Active
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                    {emp.designation} &bull; {emp.department}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: '4px', display: 'flex', gap: '12px' }}>
                    <span>Active Tasks: <strong>{emp.active_tasks || 0}</strong></span>
                    <span>Completed: <strong>{emp.completed_tasks || 0}</strong></span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ========================================================= */}
      {/* TAB 3: TASK MANAGEMENT (REQ 8, 9, 10, 11)                 */}
      {/* ========================================================= */}
      {(activeTab === 'tasks' || activeTab === 'create-task') && (
        <section className="animate-fade-in" style={{ marginBottom: '28px' }}>
          {/* Controls Bar */}
          <div
            style={{
              padding: '16px',
              backgroundColor: '#fff',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              marginBottom: '16px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '12px',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            {/* Search */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 240px', backgroundColor: '#f8fafc', padding: '6px 12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
              <Search size={16} color="#64748b" />
              <input
                type="text"
                placeholder="Search tasks by title, employee, or project..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '0.85rem', width: '100%' }}
              />
            </div>

            {/* Status Filter */}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <Filter size={15} color="#64748b" />
              {['ALL', 'TODO', 'IN_PROGRESS', 'SUBMITTED', 'REWORK', 'APPROVED'].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setTaskStatusFilter(st)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '6px',
                    fontSize: '0.74rem',
                    fontWeight: '700',
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: taskStatusFilter === st ? '#0b3d2b' : '#f1f5f9',
                    color: taskStatusFilter === st ? '#fff' : '#475569',
                  }}
                >
                  {st.replace('_', ' ')}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setIsCreateTaskModalOpen(true)}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#0b3d2b',
                color: '#fff',
                fontWeight: '700',
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <PlusCircle size={15} />
              + Create Task
            </button>
          </div>

          {/* Tasks Table */}
          <div className="travel-border-card" style={{ backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '12px 16px', fontWeight: '700', color: '#475569' }}>Task & Project</th>
                    <th style={{ padding: '12px 16px', fontWeight: '700', color: '#475569' }}>Assigned Employee</th>
                    <th style={{ padding: '12px 16px', fontWeight: '700', color: '#475569' }}>Deadline</th>
                    <th style={{ padding: '12px 16px', fontWeight: '700', color: '#475569' }}>Priority</th>
                    <th style={{ padding: '12px 16px', fontWeight: '700', color: '#475569' }}>Progress</th>
                    <th style={{ padding: '12px 16px', fontWeight: '700', color: '#475569' }}>Status</th>
                    <th style={{ padding: '12px 16px', fontWeight: '700', color: '#475569', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
                        No tasks match the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredTasks.map((t) => (
                      <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ fontWeight: '700', color: '#1e293b' }}>{t.title}</div>
                          <div style={{ fontSize: '0.74rem', color: '#64748b' }}>{t.project_name}</div>
                          {t.rework_notes && (
                            <div style={{ fontSize: '0.72rem', color: '#dc2626', marginTop: '2px', fontWeight: '600' }}>
                              Rework: {t.rework_notes}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ fontWeight: '600', color: '#334155' }}>{t.assigned_to}</div>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Calendar size={13} color="#64748b" />
                            <span>{t.deadline}</span>
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '0.72rem',
                              fontWeight: '700',
                              backgroundColor: t.priority === 'High' ? '#fee2e2' : '#fef3c7',
                              color: t.priority === 'High' ? '#b91c1c' : '#b45309',
                            }}
                          >
                            {t.priority}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ flex: 1, minWidth: '60px', maxWidth: '85px', height: '7px', backgroundColor: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                              <div
                                style={{
                                  width: `${Math.min(100, Math.max(0, Number(t.progress) || 0))}%`,
                                  height: '100%',
                                  backgroundColor: (Number(t.progress) || 0) >= 100 ? '#10b981' : '#0b3d2b',
                                  transition: 'width 0.3s ease',
                                }}
                              />
                            </div>
                            <span style={{ fontSize: '0.78rem', fontWeight: '800', color: (Number(t.progress) || 0) >= 100 ? '#10b981' : '#0b3d2b', minWidth: '32px' }}>
                              {t.progress || 0}%
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span
                            style={{
                              padding: '3px 10px',
                              borderRadius: '999px',
                              fontSize: '0.74rem',
                              fontWeight: '800',
                              backgroundColor:
                                t.status === 'APPROVED'
                                  ? '#dcfce7'
                                  : t.status === 'SUBMITTED'
                                  ? '#fef3c7'
                                  : t.status === 'REWORK'
                                  ? '#fee2e2'
                                  : '#f1f5f9',
                              color:
                                t.status === 'APPROVED'
                                  ? '#15803d'
                                  : t.status === 'SUBMITTED'
                                  ? '#b45309'
                                  : t.status === 'REWORK'
                                  ? '#b91c1c'
                                  : '#475569',
                            }}
                          >
                            {t.status}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                            <button
                              type="button"
                              onClick={() => handleOpenDeadlineModal(t)}
                              style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                border: '1px solid #cbd5e1',
                                backgroundColor: '#fff',
                                fontSize: '0.74rem',
                                color: '#475569',
                                cursor: 'pointer',
                              }}
                              title="Update deadline & priority"
                            >
                              Edit Deadline
                            </button>
                            {t.status === 'SUBMITTED' && (
                              <button
                                type="button"
                                onClick={() => handleApproveTask(t)}
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: '4px',
                                  border: 'none',
                                  backgroundColor: '#10b981',
                                  color: '#fff',
                                  fontSize: '0.74rem',
                                  fontWeight: '700',
                                  cursor: 'pointer',
                                }}
                              >
                                Approve
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ========================================================= */}
      {/* TAB: SET TASK DEADLINES (REQ 10)                          */}
      {/* ========================================================= */}
      {activeTab === 'deadlines' && (
        <section className="animate-fade-in" style={{ marginBottom: '28px' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#0b3d2b', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Calendar size={22} color="#047857" />
                Task Deadlines & Schedule Management
              </h2>
              <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '2px' }}>
                Track delivery timelines, adjust target completion dates, and manage sprint urgency
              </div>
            </div>
            <button
              type="button"
              onClick={() => onTabChange && onTabChange('create-task')}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#0b3d2b',
                color: '#fff',
                fontWeight: '700',
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <PlusCircle size={15} />
              + Create New Task
            </button>
          </div>

          {/* Deadline KPI Metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            <div className="travel-border-card" style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', borderLeft: '4px solid #0284c7' }}>
              <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>Total Active Tasks</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#0b3d2b', marginTop: '4px' }}>{tasks.length}</div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>Across all assigned projects</div>
            </div>

            <div className="travel-border-card" style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', borderLeft: '4px solid #dc2626' }}>
              <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>Overdue Deadlines</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#dc2626', marginTop: '4px' }}>
                {tasks.filter((t) => t.status !== 'APPROVED' && getDeadlineUrgency(t.deadline).status === 'overdue').length}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>Requires immediate extension or rework</div>
            </div>

            <div className="travel-border-card" style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', borderLeft: '4px solid #f59e0b' }}>
              <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>Due Within 48 Hours</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#b45309', marginTop: '4px' }}>
                {tasks.filter((t) => t.status !== 'APPROVED' && ['today', 'urgent'].includes(getDeadlineUrgency(t.deadline).status)).length}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>Critical sprint focus</div>
            </div>

            <div className="travel-border-card" style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', borderLeft: '4px solid #10b981' }}>
              <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>Completed On Time</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#047857', marginTop: '4px' }}>
                {tasks.filter((t) => t.status === 'APPROVED').length}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>Verified & completed deliverables</div>
            </div>
          </div>

          {/* Interactive Deadlines Table */}
          <div className="travel-border-card" style={{ backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '16px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 240px', backgroundColor: '#f8fafc', padding: '6px 12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                <Search size={16} color="#64748b" />
                <input
                  type="text"
                  placeholder="Filter tasks by name, assignee, or deadline..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '0.85rem', width: '100%' }}
                />
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '12px 16px', fontWeight: '700', color: '#475569' }}>Task & Project</th>
                    <th style={{ padding: '12px 16px', fontWeight: '700', color: '#475569' }}>Assigned Employee</th>
                    <th style={{ padding: '12px 16px', fontWeight: '700', color: '#475569' }}>Current Deadline</th>
                    <th style={{ padding: '12px 16px', fontWeight: '700', color: '#475569' }}>Timeline Status</th>
                    <th style={{ padding: '12px 16px', fontWeight: '700', color: '#475569' }}>Priority</th>
                    <th style={{ padding: '12px 16px', fontWeight: '700', color: '#475569' }}>Task Status</th>
                    <th style={{ padding: '12px 16px', fontWeight: '700', color: '#475569', textAlign: 'right' }}>Update Deadline</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
                        No tasks found matching your filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredTasks.map((t) => {
                      const urgency = getDeadlineUrgency(t.deadline);
                      return (
                        <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ fontWeight: '700', color: '#0b3d2b', fontSize: '0.9rem' }}>{t.title}</div>
                            <div style={{ fontSize: '0.74rem', color: '#64748b' }}>Project: {t.project_name}</div>
                            <div style={{ fontSize: '0.72rem', color: (Number(t.progress) || 0) >= 100 ? '#15803d' : '#0284c7', fontWeight: '700', marginTop: '2px' }}>
                              Progress: {t.progress || 0}%
                            </div>
                          </td>
                          <td style={{ padding: '12px 16px', color: '#1e293b', fontWeight: '600' }}>
                            {t.assigned_to}
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ fontWeight: '700', color: '#1e293b' }}>{t.deadline || 'No date set'}</div>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontSize: '0.74rem',
                                fontWeight: '700',
                                backgroundColor: urgency.bg,
                                color: urgency.color,
                                border: `1px solid ${urgency.border || 'transparent'}`,
                              }}
                            >
                              <Clock size={12} />
                              {urgency.label}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <span
                              style={{
                                padding: '3px 8px',
                                borderRadius: '4px',
                                fontSize: '0.74rem',
                                fontWeight: '700',
                                backgroundColor: t.priority === 'Critical' ? '#fee2e2' : t.priority === 'High' ? '#fef3c7' : '#f1f5f9',
                                color: t.priority === 'Critical' ? '#dc2626' : t.priority === 'High' ? '#b45309' : '#475569',
                              }}
                            >
                              {t.priority}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{ fontSize: '0.74rem', fontWeight: '700', color: t.status === 'APPROVED' ? '#047857' : t.status === 'REWORK' ? '#dc2626' : '#1e293b' }}>
                              {t.status}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center' }}>
                              <button
                                type="button"
                                onClick={() => handleOpenDeadlineModal(t)}
                                style={{
                                  padding: '6px 12px',
                                  borderRadius: '6px',
                                  border: '1px solid #0b3d2b',
                                  backgroundColor: '#ecfdf5',
                                  color: '#0b3d2b',
                                  fontWeight: '700',
                                  fontSize: '0.78rem',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                <Calendar size={13} />
                                Set Deadline
                              </button>
                              <button
                                type="button"
                                onClick={() => handleQuickExtendDeadline(t, 2)}
                                title="Quick extension +2 days"
                                style={{
                                  padding: '6px 8px',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                  backgroundColor: '#fff',
                                  color: '#475569',
                                  fontWeight: '700',
                                  fontSize: '0.74rem',
                                  cursor: 'pointer',
                                }}
                              >
                                +2d
                              </button>
                              <button
                                type="button"
                                onClick={() => handleQuickExtendDeadline(t, 7)}
                                title="Quick extension +7 days"
                                style={{
                                  padding: '6px 8px',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                  backgroundColor: '#fff',
                                  color: '#475569',
                                  fontWeight: '700',
                                  fontSize: '0.74rem',
                                  cursor: 'pointer',
                                }}
                              >
                                +7d
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ========================================================= */}
      {/* TAB: MONITOR EMPLOYEE WORK (REQ 11)                       */}
      {/* ========================================================= */}
      {activeTab === 'monitor-work' && (
        <section className="animate-fade-in" style={{ marginBottom: '28px' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#0b3d2b', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Activity size={22} color="#047857" />
                Monitor Employee Work & Progress
              </h2>
              <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '2px' }}>
                Real-time visibility into team member workloads, daily deliverables, and sprint activity
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => onTabChange && onTabChange('work-updates')}
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  color: '#334155',
                  fontWeight: '700',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <FileText size={14} />
                View Daily Logs
              </button>
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            <div className="travel-border-card" style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>Active Team Members</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#0b3d2b', marginTop: '4px' }}>{teamMembers.length}</div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>Currently in roster</div>
            </div>

            <div className="travel-border-card" style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>Tasks In Progress</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#0284c7', marginTop: '4px' }}>
                {tasks.filter((t) => t.status === 'IN_PROGRESS' || t.status === 'In Progress').length}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>Active execution</div>
            </div>

            <div className="travel-border-card" style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>Awaiting Review</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#d97706', marginTop: '4px' }}>{submittedTasks.length}</div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>Deliverables ready for TL check</div>
            </div>

            <div className="travel-border-card" style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>Daily Updates Logged</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#047857', marginTop: '4px' }}>{workUpdates.length}</div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>Submitted work records</div>
            </div>
          </div>

          {/* Employee Workload Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '16px' }}>
            {teamMembers.length === 0 ? (
              <div className="travel-border-card" style={{ gridColumn: '1 / -1', padding: '40px', textAlign: 'center', backgroundColor: '#fff', borderRadius: '14px', color: '#94a3b8' }}>
                No active team members found in the current roster.
              </div>
            ) : (
              teamMembers.map((member) => {
                const memberTasks = tasks.filter(
                  (t) =>
                    String(t.assigned_to || '').trim().toLowerCase() === String(member.name || '').trim().toLowerCase()
                );
                const inProgressCount = memberTasks.filter((t) => t.status === 'IN_PROGRESS' || t.status === 'In Progress').length;
                const submittedCount = memberTasks.filter((t) => t.status === 'SUBMITTED' || t.status === 'In Review').length;
                const completedCount = memberTasks.filter((t) => t.status === 'APPROVED').length;
                const latestUpdate = workUpdates.find(
                  (u) => String(u.employee_name || '').trim().toLowerCase() === String(member.name || '').trim().toLowerCase()
                );

                return (
                  <div
                    key={member.id || member.email}
                    className="travel-border-card"
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: '14px',
                      border: '1px solid #e2e8f0',
                      padding: '18px',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      {/* Top profile row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                        <div
                          style={{
                            width: '42px',
                            height: '42px',
                            borderRadius: '10px',
                            backgroundColor: '#0b3d2b',
                            color: '#ffffff',
                            fontWeight: '800',
                            fontSize: '1.1rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            flexShrink: 0,
                          }}
                        >
                          {member.photoUrl || member.profile_photo || member.profilePhoto ? (
                            <img
                              src={member.photoUrl || member.profile_photo || member.profilePhoto}
                              alt={member.name}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            member.name?.charAt(0)?.toUpperCase() || 'E'
                          )}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: '800', color: '#0b3d2b', fontSize: '0.95rem' }}>{member.name}</div>
                          <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                            {member.employee_id || member.id} &bull; {member.designation || 'Staff'}
                          </div>
                        </div>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: '999px',
                            fontSize: '0.7rem',
                            fontWeight: '700',
                            backgroundColor: '#ecfdf5',
                            color: '#047857',
                          }}
                        >
                          {member.status || 'Active'}
                        </span>
                      </div>

                      {/* Workload badges */}
                      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.72rem', padding: '3px 8px', borderRadius: '4px', backgroundColor: '#f1f5f9', color: '#475569', fontWeight: '700' }}>
                          Total: {memberTasks.length}
                        </span>
                        <span style={{ fontSize: '0.72rem', padding: '3px 8px', borderRadius: '4px', backgroundColor: '#e0f2fe', color: '#0369a1', fontWeight: '700' }}>
                          In Progress: {inProgressCount}
                        </span>
                        <span style={{ fontSize: '0.72rem', padding: '3px 8px', borderRadius: '4px', backgroundColor: '#fef3c7', color: '#b45309', fontWeight: '700' }}>
                          Review: {submittedCount}
                        </span>
                        <span style={{ fontSize: '0.72rem', padding: '3px 8px', borderRadius: '4px', backgroundColor: '#ecfdf5', color: '#047857', fontWeight: '700' }}>
                          Done: {completedCount}
                        </span>
                      </div>

                      {/* Active Tasks snippet */}
                      <div style={{ backgroundColor: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '12px' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>
                          Active Tasks ({memberTasks.filter((t) => t.status !== 'APPROVED').length})
                        </div>
                        {memberTasks.filter((t) => t.status !== 'APPROVED').length === 0 ? (
                          <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>No pending tasks right now.</div>
                        ) : (
                          memberTasks
                            .filter((t) => t.status !== 'APPROVED')
                            .slice(0, 2)
                            .map((t) => (
                              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', marginBottom: '5px' }}>
                                <span style={{ fontWeight: '600', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '170px' }}>
                                  • {t.title}
                                </span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                  <span style={{ fontSize: '0.7rem', fontWeight: '800', color: (Number(t.progress) || 0) >= 100 ? '#15803d' : '#047857', backgroundColor: (Number(t.progress) || 0) >= 100 ? '#dcfce7' : '#ecfdf5', padding: '1px 6px', borderRadius: '4px' }}>
                                    {t.progress || 0}%
                                  </span>
                                  <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{t.deadline}</span>
                                </div>
                              </div>
                            ))
                        )}
                      </div>

                      {/* Latest Work Update */}
                      {latestUpdate && (
                        <div style={{ fontSize: '0.75rem', color: '#475569', marginBottom: '12px', fontStyle: 'italic' }}>
                          Latest log: "{latestUpdate.summary || latestUpdate.task_summary}" ({latestUpdate.hours_worked || 8}h)
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid #f1f5f9', paddingTop: '10px' }}>
                      <button
                        type="button"
                        onClick={() => openCreateTaskForProject(projects[0], member.name)}
                        style={{
                          flex: 1,
                          padding: '7px 10px',
                          borderRadius: '6px',
                          border: 'none',
                          backgroundColor: '#0b3d2b',
                          color: '#fff',
                          fontWeight: '700',
                          fontSize: '0.76rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                        }}
                      >
                        <PlusCircle size={13} />
                        Assign Task
                      </button>
                      <button
                        type="button"
                        onClick={() => openWorkUpdateModal(projects[0]?.id, member.name)}
                        style={{
                          padding: '7px 10px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          backgroundColor: '#fff',
                          color: '#334155',
                          fontWeight: '700',
                          fontSize: '0.76rem',
                          cursor: 'pointer',
                        }}
                      >
                        Log Update
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}

      {/* ========================================================= */}
      {/* TAB 4: REVIEW SUBMITTED TASKS & REWORK (REQ 13, 14, 15)   */}
      {/* ========================================================= */}
      {(activeTab === 'submitted-tasks' || activeTab === 'task-review') && (
        <section className="animate-fade-in" style={{ marginBottom: '28px' }}>
          <div style={{ marginBottom: '16px' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: '800', color: '#0b3d2b', margin: 0 }}>
              Submitted Tasks Verification Queue
            </h2>
            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
              Inspect deliverables submitted by team members, approve completion or assign rework notes
            </div>
          </div>

          {submittedTasks.length === 0 ? (
            <div className="travel-border-card" style={{ padding: '40px', textAlign: 'center', backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
              <CheckCircle2 size={36} color="#10b981" style={{ margin: '0 auto 10px auto' }} />
              <div style={{ fontSize: '0.95rem', fontWeight: '700', color: '#334155' }}>
                All Task Submissions Reviewed!
              </div>
              <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '4px 0 0 0' }}>
                There are currently no tasks waiting in the inspection queue.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '16px' }}>
              {submittedTasks.map((task) => (
                <div
                  key={task.id}
                  className="travel-border-card"
                  style={{
                    backgroundColor: '#fff',
                    borderRadius: '14px',
                    border: '2px solid #fef08a',
                    padding: '20px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '0.74rem', padding: '2px 8px', borderRadius: '4px', backgroundColor: '#fef9c3', color: '#854d0e', fontWeight: '800' }}>
                        READY FOR REVIEW
                      </span>
                      <span style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        Due: <strong>{task.deadline}</strong>
                      </span>
                    </div>

                    <h3 style={{ fontSize: '1.1rem', fontWeight: '800', color: '#1e293b', margin: '0 0 6px 0' }}>
                      {task.title}
                    </h3>

                    <div style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '8px' }}>
                      Project: <strong>{task.project_name}</strong>
                    </div>

                    <div
                      style={{
                        padding: '10px 12px',
                        backgroundColor: '#f8fafc',
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0',
                        fontSize: '0.8rem',
                        color: '#334155',
                        marginBottom: '16px',
                      }}
                    >
                      <div style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b', marginBottom: '2px' }}>
                        SUBMITTED BY: {task.assigned_to}
                      </div>
                      <div>{task.description || 'Sprint deliverable ready for code & quality inspection.'}</div>
                    </div>
                  </div>

                  {/* Action Buttons: Req 14 Approve / Reject, Req 15 Assign Rework */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => handleApproveTask(task)}
                      style={{
                        padding: '9px',
                        borderRadius: '8px',
                        border: 'none',
                        backgroundColor: '#10b981',
                        color: '#fff',
                        fontWeight: '700',
                        fontSize: '0.825rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                      }}
                    >
                      <Check size={14} />
                      Approve Task
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRejectTask(task)}
                      style={{
                        padding: '9px',
                        borderRadius: '8px',
                        border: '1px solid #dc2626',
                        backgroundColor: '#fef2f2',
                        color: '#dc2626',
                        fontWeight: '700',
                        fontSize: '0.825rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                      }}
                    >
                      <XCircle size={14} />
                      Reject Task
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenReworkModal(task)}
                      style={{
                        padding: '9px',
                        borderRadius: '8px',
                        border: '1px solid #ef4444',
                        backgroundColor: '#fff',
                        color: '#ef4444',
                        fontWeight: '700',
                        fontSize: '0.825rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                      }}
                    >
                      <RotateCcw size={14} />
                      Assign Rework
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ========================================================= */}
      {/* TAB 5: DAILY WORK UPDATES (Screenshots 1, 2, 3)             */}
      {/* ========================================================= */}
      {activeTab === 'work-updates' && (
        <section className="animate-fade-in" style={{ marginBottom: '28px' }}>
          <WorkUpdatesDrilldown onExit={() => onTabChange && onTabChange('projects')} />
        </section>
      )}

      {/* ========================================================= */}
      {/* TAB: ASSIGN & MONITOR REWORK (REQ 15)                     */}
      {/* ========================================================= */}
      {activeTab === 'rework' && (
        <section className="animate-fade-in" style={{ marginBottom: '28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#0b3d2b', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <RotateCcw size={22} color="#dc2626" />
                Assign & Monitor Rework Deliverables
              </h2>
              <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '2px' }}>
                Track rejected tasks, provide constructive revision notes, and enforce revised milestones
              </div>
            </div>
            <button
              type="button"
              onClick={() => onTabChange && onTabChange('task-review')}
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                color: '#334155',
                fontWeight: '700',
                fontSize: '0.82rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <CheckCircle2 size={14} />
              Open Review Queue ({submittedTasks.length})
            </button>
          </div>

          {/* Rework items grid */}
          {reworkTasks.length === 0 ? (
            <div className="travel-border-card" style={{ padding: '48px', textAlign: 'center', backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
              <CheckCircle2 size={40} color="#10b981" style={{ margin: '0 auto 12px auto' }} />
              <div style={{ fontSize: '1.05rem', fontWeight: '800', color: '#1e293b' }}>
                Zero Active Rework Items!
              </div>
              <p style={{ fontSize: '0.85rem', color: '#64748b', maxWidth: '420px', margin: '6px auto 0 auto' }}>
                All deliverables currently meet acceptance standards. When a submitted task is rejected with rework instructions, it will automatically appear here.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '16px' }}>
              {reworkTasks.map((t) => (
                <div
                  key={t.id}
                  className="travel-border-card"
                  style={{
                    backgroundColor: '#fff',
                    borderRadius: '14px',
                    border: '2px solid #fecaca',
                    padding: '20px',
                    boxShadow: '0 4px 12px rgba(220,38,38,0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px', backgroundColor: '#fee2e2', color: '#dc2626', fontWeight: '800' }}>
                        UNDER REVISION
                      </span>
                      <span style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        Revised Due: <strong>{t.revised_deadline || t.deadline}</strong>
                      </span>
                    </div>

                    <h3 style={{ fontSize: '1.05rem', fontWeight: '800', color: '#1e293b', margin: '0 0 6px 0' }}>
                      {t.title}
                    </h3>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '10px' }}>
                      Assignee: <strong style={{ color: '#0b3d2b' }}>{t.assigned_to}</strong> &bull; Project: {t.project_name}
                    </div>

                    {/* Rework instructions */}
                    <div style={{ padding: '12px', backgroundColor: '#fef2f2', borderRadius: '8px', border: '1px solid #fee2e2', marginBottom: '16px' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: '800', color: '#b91c1c', marginBottom: '4px' }}>
                        REWORK INSTRUCTIONS:
                      </div>
                      <div style={{ fontSize: '0.82rem', color: '#7f1d1d' }}>
                        {t.rework_notes || t.feedback || 'Please update code implementation according to team leader remarks.'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => handleApproveTask(t)}
                      style={{
                        flex: 1,
                        padding: '9px',
                        borderRadius: '8px',
                        border: 'none',
                        backgroundColor: '#10b981',
                        color: '#fff',
                        fontWeight: '700',
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                      }}
                    >
                      <Check size={14} />
                      Approve Revision
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenReworkModal(t)}
                      style={{
                        padding: '9px 12px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        backgroundColor: '#fff',
                        color: '#334155',
                        fontWeight: '700',
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                      }}
                    >
                      Update Notes
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ========================================================= */}
      {/* TAB 6: TEAM PERFORMANCE (REQ 16)                          */}
      {/* ========================================================= */}
      {activeTab === 'performance' && (
        <section className="animate-fade-in" style={{ marginBottom: '28px' }}>
          <div style={{ marginBottom: '16px' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: '800', color: '#0b3d2b', margin: 0 }}>
              Team Performance Scorecard
            </h2>
            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
              Employee task velocity, completion ratios, and rework frequency
            </div>
          </div>

          <div className="travel-border-card" style={{ backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '12px 18px', fontWeight: '700', color: '#475569' }}>Team Member</th>
                    <th style={{ padding: '12px 18px', fontWeight: '700', color: '#475569' }}>Department</th>
                    <th style={{ padding: '12px 18px', fontWeight: '700', color: '#475569' }}>Assigned Tasks</th>
                    <th style={{ padding: '12px 18px', fontWeight: '700', color: '#475569' }}>Completed</th>
                    <th style={{ padding: '12px 18px', fontWeight: '700', color: '#475569' }}>Rework Count</th>
                    <th style={{ padding: '12px 18px', fontWeight: '700', color: '#475569' }}>Velocity Score</th>
                  </tr>
                </thead>
                <tbody>
                  {!performance?.employee_scorecard || performance.employee_scorecard.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: '30px', textAlign: 'center', color: '#94a3b8' }}>
                        No performance telemetry gathered yet.
                      </td>
                    </tr>
                  ) : (
                    performance.employee_scorecard.map((item, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px 18px', fontWeight: '700', color: '#1e293b' }}>
                          {item.employee_name}
                        </td>
                        <td style={{ padding: '12px 18px', color: '#64748b' }}>
                          {item.department} &bull; {item.designation}
                        </td>
                        <td style={{ padding: '12px 18px', fontWeight: '700' }}>
                          {item.total_tasks}
                        </td>
                        <td style={{ padding: '12px 18px', fontWeight: '700', color: '#166534' }}>
                          {item.completed_tasks}
                        </td>
                        <td style={{ padding: '12px 18px', fontWeight: '700', color: item.rework_count > 0 ? '#dc2626' : '#64748b' }}>
                          {item.rework_count}
                        </td>
                        <td style={{ padding: '12px 18px' }}>
                          <span
                            style={{
                              padding: '3px 10px',
                              borderRadius: '999px',
                              fontSize: '0.74rem',
                              fontWeight: '800',
                              backgroundColor:
                                item.velocity_rating === 'Top Performer'
                                  ? '#dcfce7'
                                  : item.velocity_rating === 'On Track'
                                  ? '#e0f2fe'
                                  : '#fee2e2',
                              color:
                                item.velocity_rating === 'Top Performer'
                                  ? '#15803d'
                                  : item.velocity_rating === 'On Track'
                                  ? '#0369a1'
                                  : '#b91c1c',
                            }}
                          >
                            {item.velocity_rating} ({item.completion_rate}%)
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ========================================================= */}
      {/* MODAL 1: CREATE & ASSIGN TASK (REQ 8, 9, 10)              */}
      {/* ========================================================= */}
      <Modal
        isOpen={isCreateTaskModalOpen}
        onClose={() => setIsCreateTaskModalOpen(false)}
        title="Create & Assign New Task"
        subtitle="Req 8: Create Task &bull; Req 9: Assign Employee &bull; Req 10: Set Deadline"
        maxWidth="540px"
      >
        <form onSubmit={handleCreateTask}>
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '4px' }}>
              Project *
            </label>
            {projects.length > 1 ? (
              <div style={{ position: 'relative' }}>
                <select
                  value={taskForm.project_id}
                  onChange={(e) => handleProjectSelectInTaskForm(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 36px 10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.875rem',
                    fontWeight: '700',
                    color: '#0b3d2b',
                    backgroundColor: '#f8fafc',
                    cursor: 'pointer',
                    outline: 'none',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    MozAppearance: 'none',
                  }}
                  required
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || p.title} ({p.department || 'Operations'}) • {p.id}
                    </option>
                  ))}
                </select>
                <div
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    pointerEvents: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    color: '#047857',
                  }}
                >
                  <ChevronDown size={18} />
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: '9px 12px',
                  backgroundColor: '#f8fafc',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <span style={{ fontWeight: 800, color: '#0b3d2b', fontSize: '0.88rem' }}>
                    {selectedProjectForTask?.name || selectedProjectForTask?.title || projects[0]?.name || 'Assigned Project'}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '8px' }}>
                    ({selectedProjectForTask?.department || projects[0]?.department || 'Operations'})
                  </span>
                </div>
                {(selectedProjectForTask?.id || projects[0]?.id) && (
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      backgroundColor: '#ecfdf5',
                      color: '#065f46',
                      padding: '2px 8px',
                      borderRadius: '6px',
                      border: '1px solid #a7f3d0',
                    }}
                  >
                    {selectedProjectForTask?.id || projects[0]?.id}
                  </span>
                )}
              </div>
            )}
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '4px' }}>
              Task Title *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Implement Face Landmark Mesh Matching"
              value={taskForm.title}
              onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
              style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
            />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '4px' }}>
              Description & Acceptance Criteria
            </label>
            <textarea
              rows={3}
              placeholder="Detailed sprint expectations, test cases, and deliverables..."
              value={taskForm.description}
              onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
              style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '4px' }}>
                Assign to Employee *
              </label>
              <select
                value={taskForm.assigned_to}
                onChange={(e) => setTaskForm({ ...taskForm, assigned_to: e.target.value })}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
                required
              >
                {availableEmployeesForTask.length === 0 ? (
                  <option value="" disabled>
                    -- No employees found in roster --
                  </option>
                ) : (
                  availableEmployeesForTask.map((m) => (
                    <option key={m.id || m.name} value={m.name}>
                      {m.name} ({m.department || 'Operations'})
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '4px' }}>
                Task Deadline *
              </label>
              <input
                type="date"
                required
                value={taskForm.deadline}
                onChange={(e) => setTaskForm({ ...taskForm, deadline: e.target.value })}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '18px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '4px' }}>
                Priority
              </label>
              <select
                value={taskForm.priority}
                onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
              >
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '4px' }}>
                Estimated Effort (Hrs)
              </label>
              <input
                type="number"
                step="0.5"
                min="1"
                value={taskForm.estimated_hours}
                onChange={(e) => setTaskForm({ ...taskForm, estimated_hours: parseFloat(e.target.value) || 8 })}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setIsCreateTaskModalOpen(false)}
              style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#fff', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmittingTask}
              style={{
                padding: '8px 18px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#0b3d2b',
                color: '#fff',
                fontSize: '0.85rem',
                fontWeight: '700',
                cursor: isSubmittingTask ? 'not-allowed' : 'pointer',
                opacity: isSubmittingTask ? 0.7 : 1,
              }}
            >
              {isSubmittingTask ? 'Creating...' : 'Create & Assign Task'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ========================================================= */}
      {/* MODAL 2: SET / UPDATE DEADLINE (REQ 10)                   */}
      {/* ========================================================= */}
      <Modal
        isOpen={isDeadlineModalOpen}
        onClose={() => setIsDeadlineModalOpen(false)}
        title="Set Task Deadline & Priority"
        subtitle={`Task: ${selectedTask?.title || ''}`}
        maxWidth="460px"
      >
        <form onSubmit={handleUpdateDeadline}>
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '4px' }}>
              Target Deadline *
            </label>
            <input
              type="date"
              required
              value={deadlineForm.deadline}
              onChange={(e) => setDeadlineForm({ ...deadlineForm, deadline: e.target.value })}
              style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '4px' }}>
              Priority Level
            </label>
            <select
              value={deadlineForm.priority}
              onChange={(e) => setDeadlineForm({ ...deadlineForm, priority: e.target.value })}
              style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
            >
              <option value="High">High Urgency</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setIsDeadlineModalOpen(false)}
              style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#fff', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', backgroundColor: '#0b3d2b', color: '#fff', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer' }}
            >
              Save Deadline
            </button>
          </div>
        </form>
      </Modal>

      {/* ========================================================= */}
      {/* MODAL 3: ASSIGN REWORK (REQ 15)                           */}
      {/* ========================================================= */}
      <Modal
        isOpen={isReworkModalOpen}
        onClose={() => setIsReworkModalOpen(false)}
        title="Assign Rework to Employee"
        subtitle={`Task: ${selectedTask?.title || ''} &bull; Assigned: ${selectedTask?.assigned_to || ''}`}
        maxWidth="500px"
      >
        <form onSubmit={handleAssignRework}>
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '4px' }}>
              Rework Feedback & Required Revisions *
            </label>
            <textarea
              rows={4}
              required
              placeholder="State exactly what needs to be improved, refactored, or fixed..."
              value={reworkForm.rework_notes}
              onChange={(e) => setReworkForm({ ...reworkForm, rework_notes: e.target.value })}
              style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '4px' }}>
              Revised Deadline Date *
            </label>
            <input
              type="date"
              required
              value={reworkForm.revised_deadline}
              onChange={(e) => setReworkForm({ ...reworkForm, revised_deadline: e.target.value })}
              style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setIsReworkModalOpen(false)}
              style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#fff', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', backgroundColor: '#dc2626', color: '#fff', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer' }}
            >
              Confirm Rework
            </button>
          </div>
        </form>
      </Modal>

      {/* ========================================================= */}
      {/* MODAL 4: LOG DAILY WORK UPDATE (REQ 12)                   */}
      {/* ========================================================= */}
      <Modal
        isOpen={isWorkUpdateModalOpen}
        onClose={() => setIsWorkUpdateModalOpen(false)}
        title="Log Daily Work Update"
        subtitle="Record daily hours and work milestones for team members"
        maxWidth="500px"
      >
        <form onSubmit={handleSubmitWorkUpdate}>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '4px' }}>
              Project *
            </label>
            <select
              value={updateForm.project_id}
              onChange={(e) => setUpdateForm({ ...updateForm, project_id: e.target.value })}
              style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
              required
            >
              {projects.length === 0 && <option value="">No projects available</option>}
              {updateForm.project_id && !projects.some((p) => p.id === updateForm.project_id) && (
                <option value={updateForm.project_id}>{updateForm.project_id}</option>
              )}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '4px' }}>
                Employee Name *
              </label>
              <select
                value={updateForm.employee_name}
                onChange={(e) => setUpdateForm({ ...updateForm, employee_name: e.target.value })}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
                required
              >
                {teamMembers.length === 0 && updateForm.employee_name && (
                  <option value={updateForm.employee_name}>{updateForm.employee_name}</option>
                )}
                {updateForm.employee_name && !teamMembers.some((m) => m.name === updateForm.employee_name) && (
                  <option value={updateForm.employee_name}>{updateForm.employee_name}</option>
                )}
                {teamMembers.map((m) => (
                  <option key={m.id || m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '4px' }}>
                Hours Worked
              </label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="24"
                value={updateForm.hours_worked}
                onChange={(e) => setUpdateForm({ ...updateForm, hours_worked: parseFloat(e.target.value) || 8 })}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '4px' }}>
              Work Summary *
            </label>
            <textarea
              rows={3}
              required
              placeholder="What deliverables were implemented today? Any tests completed?"
              value={updateForm.summary}
              onChange={(e) => setUpdateForm({ ...updateForm, summary: e.target.value })}
              style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '4px' }}>
              Blockers / Impediments
            </label>
            <input
              type="text"
              placeholder="e.g. None or waiting for API endpoint"
              value={updateForm.blockers}
              onChange={(e) => setUpdateForm({ ...updateForm, blockers: e.target.value })}
              style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setIsWorkUpdateModalOpen(false)}
              style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#fff', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', backgroundColor: '#0b3d2b', color: '#fff', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer' }}
            >
              Save Update
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

