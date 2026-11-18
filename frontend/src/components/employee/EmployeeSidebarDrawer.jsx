import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  User,
  Bell,
  Calendar,
  Briefcase,
  FileText,
  Clock,
  Home,
  X,
  FileClock,
  Receipt,
  Coins,
  UserMinus,
  Award,
  MessageSquare,
  Users,
  RotateCcw,
  Send,
  CheckCircle2,
} from 'lucide-react';
import BrandLogo from '../common/BrandLogo';
import { chatService } from '../../services/chatService';
import api from '../../services/api';

/**
 * EmployeeSidebarDrawer - Left-side slide-over navigation drawer
 * Exactly matches the reference mobile design in Screenshot 3.
 */
export default function EmployeeSidebarDrawer({ isOpen, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [currentUser, setCurrentUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('arshith_user')) || null;
    } catch {
      return null;
    }
  });
  const [avatarImgError, setAvatarImgError] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Sync user from localStorage & fetch fresh profile from API
  useEffect(() => {
    let isMounted = true;
    const syncUser = () => {
      try {
        const u = JSON.parse(localStorage.getItem('arshith_user')) || null;
        if (isMounted) setCurrentUser(u);
      } catch {}
    };

    const fetchFreshProfile = async () => {
      try {
        const token = localStorage.getItem('arshith_auth_token');
        if (!token) return;
        const res = await api.get('/api/employees/me');
        if (res.data && isMounted) {
          setCurrentUser((prev) => {
            const merged = { ...(prev || {}), ...res.data };
            try {
              localStorage.setItem('arshith_user', JSON.stringify(merged));
            } catch {}
            return merged;
          });
        }
      } catch {
        // Fall back quietly to local storage
      }
    };

    syncUser();
    fetchFreshProfile();

    window.addEventListener('storage', syncUser);
    window.addEventListener('arshith_user_updated', syncUser);
    return () => {
      isMounted = false;
      window.removeEventListener('storage', syncUser);
      window.removeEventListener('arshith_user_updated', syncUser);
    };
  }, [isOpen]);

  const userPhoto = (
    currentUser?.photoUrl ||
    currentUser?.profile_photo ||
    currentUser?.profilePhoto ||
    currentUser?.photo_url ||
    currentUser?.avatar ||
    ''
  );

  useEffect(() => {
    setAvatarImgError(false);
  }, [userPhoto]);

  const employeeName = currentUser?.name || currentUser?.fullName || 'Employee';
  const employeeId = currentUser?.employeeId || currentUser?.id || 'AFI-001';
  const designation = currentUser?.designation || currentUser?.role || 'Staff Member';

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Lock document scroll while drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    let isMounted = true;
    const fetchUnread = async () => {
      try {
        const count = await chatService.getUnreadCount();
        if (isMounted) setUnreadCount(count);
      } catch {}
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 8000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleNavigate = (path) => {
    navigate(path);
    onClose();
  };

  // Canonical employee nav items with Sprints, Tasks, and HRMS extensions
  const navItems = [
    { label: 'Dashboard', path: '/employee/dashboard', icon: Home },
    { label: 'Daily Work Updates', path: '/employee/updates', icon: FileClock },
    { label: 'Assigned Tasks', path: '/employee/assignments?tab=tasks', icon: Briefcase },
    { label: 'Deadlines & Sprints', path: '/employee/assignments?tab=deadlines', icon: Clock },
    { label: 'Submit Daily Work', path: '/employee/assignments?tab=daily-work', icon: Send },
    { label: 'Feedback & Rework', path: '/employee/assignments?tab=feedback', icon: RotateCcw },
    { label: 'My Team Details', path: '/employee/assignments?tab=team', icon: Users },
    { label: 'Notifications', path: '/employee/assignments?tab=notifications', icon: Bell },
    { label: 'My Performance', path: '/employee/assignments?tab=performance', icon: Award },
    { label: 'Attendance', path: '/employee/attendance', icon: Clock },
    { label: 'Teams Chat', path: '/employee/chat', icon: MessageSquare, isChat: true },
    { label: 'Leave Management', path: '/employee/leaves', icon: FileText },
    { label: 'My Payslips', path: '/employee/payslips', icon: Receipt },
    { label: 'My Loans & Advances', path: '/employee/loans', icon: Coins },
    { label: 'Resignation & Settlement', path: '/employee/resignation', icon: UserMinus },
    { label: 'Meetings', path: '/employee/meetings', icon: Calendar },
    { label: 'Announcements', path: '/employee/announcements', icon: Bell },
    { label: 'Profile', path: '/employee/profile', icon: User },
  ];

  return (
    <>
      {/* Semi-transparent dark overlay */}
      <div
        className={`employee-drawer-overlay ${isOpen ? 'open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-out Left Drawer */}
      <aside
        className={`employee-nav-drawer ${isOpen ? 'open' : ''}`}
        aria-label="Employee Navigation Menu"
        role="dialog"
        aria-modal="true"
      >
        {/* Drawer Header matching Screenshot 3: Mint green background, centered Logo, "Employee Portal" */}
        <div className="employee-drawer-header">
          <button
            type="button"
            className="employee-drawer-close-btn"
            onClick={onClose}
            aria-label="Close navigation drawer"
            title="Close menu"
          >
            <X size={18} />
          </button>

          <div
            className="employee-drawer-logo-wrap"
            onClick={() => handleNavigate('/employee/dashboard')}
            title="Arshith Connect - Home"
          >
            <BrandLogo size="medium" />
          </div>
          <div className="employee-drawer-portal-title">Employee Portal</div>
        </div>

        {/* Profile Card */}
        <div
          className="employee-drawer-profile-card"
          onClick={() => handleNavigate('/employee/profile')}
          style={{ cursor: 'pointer' }}
          title={`${employeeName} (${employeeId}) - View Profile`}
        >
          <div
            className="drawer-user-avatar"
            style={{
              overflow: 'hidden',
              position: 'relative',
              backgroundColor: '#0b3d2b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {userPhoto && !avatarImgError ? (
              <img
                src={userPhoto}
                alt={employeeName}
                onError={() => setAvatarImgError(true)}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  borderRadius: '10px',
                  display: 'block',
                }}
              />
            ) : (
              <span>{employeeName.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="drawer-user-meta">
            <div className="drawer-user-name">{employeeName}</div>
            <div className="drawer-user-id">{employeeId} &bull; {designation}</div>
          </div>
        </div>

        {/* Navigation Item Links matching Screenshot 3 */}
        <nav className="employee-drawer-nav" aria-label="Employee Menu">
          {navItems.map((item, idx) => {
            const Icon = item.icon;
            const currentFullPath = location.pathname + location.search;
            const isActive = currentFullPath === item.path || (location.pathname === item.path && !item.path.includes('?'));

            return (
              <button
                key={idx}
                type="button"
                className={`employee-drawer-nav-item ${isActive ? 'active' : ''}`}
                onClick={() => handleNavigate(item.path)}
                aria-current={isActive ? 'page' : undefined}
                style={{ display: 'flex', alignItems: 'center', width: '100%' }}
              >
                <span className="drawer-item-icon">
                  <Icon size={20} />
                </span>
                <span className="drawer-item-label">{item.label}</span>
                {item.isChat && unreadCount > 0 && (
                  <span
                    style={{
                      marginLeft: 'auto',
                      backgroundColor: '#F04491',
                      color: '#ffffff',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '1px 7px',
                      borderRadius: '10px',
                    }}
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
