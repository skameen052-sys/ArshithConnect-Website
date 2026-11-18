import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { hasActiveAuthStorage } from '../utils/authSession';

/**
 * HrProjectsProtectedRoute - Guards Project & Team Operations HR routes
 * Verifies active session with 'hr_projects', 'admin', or 'hr' role.
 * Redirects unauthenticated users to /hr-projects/login.
 */
export default function HrProjectsProtectedRoute() {
  if (!hasActiveAuthStorage(['hr_projects', 'admin', 'hr'])) {
    return <Navigate to="/hr-projects/login" replace />;
  }

  return <Outlet />;
}

