import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import HrProjectsNavbar from '../components/hr-projects/HrProjectsNavbar';
import HrProjectsSidebar from '../components/hr-projects/HrProjectsSidebar';
import HrProjectsDashboard from '../pages/hr-projects/HrProjectsDashboard';
import '../styles/global.css';
import '../styles/admin.css';
import '../styles/responsive.css';

/**
 * HrProjectsLayout - Master Shell for Project Operations HR
 * Houses the top navbar, slide-out drawer, and mounts the 10 project modules.
 */
export default function HrProjectsLayout() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const mainAreaRef = useRef(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'dashboard');
  const [openAddProjectSignal, setOpenAddProjectSignal] = useState(0);

  const handleOpenAddProject = () => {
    setOpenAddProjectSignal((prev) => prev + 1);
    setIsDrawerOpen(false);
  };

  // Sync activeTab with URL search parameters
  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    if (tabFromUrl && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [searchParams]);

  // Close drawer and reset main area scroll on route change
  useEffect(() => {
    setIsDrawerOpen(false);
    if (mainAreaRef.current) {
      mainAreaRef.current.scrollTop = 0;
    }
  }, [location.pathname]);

  // Close drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isDrawerOpen) {
        setIsDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDrawerOpen]);

  // Lock body scroll while drawer is open
  useEffect(() => {
    if (isDrawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isDrawerOpen]);

  const toggleSidebar = useCallback(() => {
    setIsDrawerOpen((prev) => !prev);
  }, []);

  const handleSelectTab = (tabKey) => {
    setActiveTab(tabKey);
    setSearchParams({ tab: tabKey });
    setIsDrawerOpen(false);
    if (mainAreaRef.current) {
      mainAreaRef.current.scrollTop = 0;
    }
  };

  return (
    <div className="admin-portal-wrapper admin-layout admin-main-page-active">
      {/* Mobile / Desktop Drawer Backdrop Overlay */}
      {isDrawerOpen && (
        <div
          className="admin-nav-backdrop"
          onClick={() => setIsDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Single Unified Slide-Out Navigation Drawer */}
      <aside
        className={`admin-nav-drawer admin-mobile-drawer ${isDrawerOpen ? 'open' : ''}`}
        aria-label="Project Operations Navigation Drawer"
        role="dialog"
        aria-modal={isDrawerOpen}
      >
        <HrProjectsSidebar
          onClose={() => setIsDrawerOpen(false)}
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          onOpenAddProject={handleOpenAddProject}
        />
      </aside>

      {/* Main Content Area */}
      <div
        ref={mainAreaRef}
        className="admin-main-area admin-main admin-main-page-wrapper"
        id="hr-projects-main-scroll-container"
      >
        {/* Dedicated Portal Main Page Background Layer */}
        <div className="admin-main-page-bg" aria-hidden="true" />

        {/* Sticky Header within Main Area */}
        <div className="admin-header-wrapper admin-header">
          <div className="admin-header-container">
            <HrProjectsNavbar onToggleSidebar={toggleSidebar} />
          </div>
        </div>

        {/* Content Container */}
        <div className="dashboard-container admin-content">
          <main className="admin-page-content animate-fade-in">
            <HrProjectsDashboard
              activeTab={activeTab}
              onTabChange={handleSelectTab}
              openAddProjectSignal={openAddProjectSignal}
            />
          </main>
        </div>
      </div>
    </div>
  );
}

