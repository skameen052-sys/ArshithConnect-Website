import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, MessageSquare, FileText } from 'lucide-react';
import BrandLogo from '../common/BrandLogo';
import { chatService } from '../../services/chatService';
import authService from '../../services/authService';
import api from '../../services/api';

/**
 * EmployeeNavbar - Top application header for the Employee Portal
 * Matches the reference design in Screenshot 4.
 */
export default function EmployeeNavbar({ onOpenDrawer }) {
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('arshith_user')) || null;
    } catch {
      return null;
    }
  });
  const [navImgError, setNavImgError] = useState(false);

  const handleLogout = () => {
    authService.logout();
    navigate('/login', { replace: true });
  };

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

  // Sync user state from localStorage and fetch fresh profile from backend
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
      } catch {}
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
  }, []);

  const userPhoto = (
    currentUser?.photoUrl ||
    currentUser?.profile_photo ||
    currentUser?.profilePhoto ||
    currentUser?.photo_url ||
    currentUser?.avatar ||
    ''
  );

  useEffect(() => {
    setNavImgError(false);
  }, [userPhoto]);

  const employeeName = currentUser?.name || currentUser?.fullName || 'Employee';
  const employeeId = currentUser?.employeeId || currentUser?.id || 'AFI-001';

  return (
    <header className="employee-top-navbar portal-navbar">
      {/* Left: Stepped Mint Hamburger Toggle Button matching Screenshot 4 */}
      <div className="portal-nav-left">
        <button
          type="button"
          className="employee-hamburger-btn"
          onClick={onOpenDrawer}
          aria-label="Open employee navigation menu"
          title="Open Menu"
        >
          <span className="employee-hamburger-line line-1" />
          <span className="employee-hamburger-line line-2" />
          <span className="employee-hamburger-line line-3" />
        </button>
      </div>

      {/* Center: ARSHITH Connect Logo matching Screenshot 4 */}
      <div
        className="employee-navbar-logo"
        style={{ cursor: 'pointer' }}
        onClick={() => navigate('/employee/dashboard')}
        title="Arshith Connect Employee Portal"
      >
        <BrandLogo size="medium" />
      </div>

      {/* Right: Work Update, Chat, User Avatar & Logout Button */}
      <div className="portal-nav-right" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* Work Update Button */}
        <button
          type="button"
          onClick={() => navigate('/employee/updates')}
          className="navbar-work-update-btn"
          title="Daily Work Updates & Schedule"
          aria-label="Work Updates"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: '#ffffff',
            color: '#00594C',
            border: '1px solid rgba(0, 89, 76, 0.28)',
            borderRadius: '10px',
            padding: '7px 13px',
            fontSize: '0.825rem',
            fontWeight: '700',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#00594C';
            e.currentTarget.style.color = '#ffffff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#ffffff';
            e.currentTarget.style.color = '#00594C';
          }}
        >
          <FileText size={16} />
          <span className="navbar-btn-label">Work Update</span>
        </button>

        {/* Teams Chat Icon Button with Floating Unread Badge */}
        <button
          type="button"
          onClick={() => navigate('/employee/chat')}
          className="navbar-team-chat-btn"
          title={`Teams Chat${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          aria-label="Teams Chat"
        >
          <MessageSquare size={18} />
          {unreadCount > 0 && (
            <span className="navbar-chat-badge">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        <div
          className="user-profile-badge"
          onClick={() => navigate('/employee/profile')}
          style={{ cursor: 'pointer' }}
          title={`${employeeName} (${employeeId}) - View Profile`}
        >
          <div
            className="user-avatar"
            style={{
              backgroundColor: '#0b3d2b',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {userPhoto && !navImgError ? (
              <img
                src={userPhoto}
                alt={employeeName}
                onError={() => setNavImgError(true)}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span>{employeeName.charAt(0).toUpperCase()}</span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          className="employee-logout-btn"
          title="Sign out of employee session"
          aria-label="Log Out"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}
