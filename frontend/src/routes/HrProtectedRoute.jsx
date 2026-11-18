import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { hasActiveAuthStorage } from '../utils/authSession';

/**
 * HrProtectedRoute - Guards Human Resources routes
 * Verifies active session with 'hr' or 'admin' role in localStorage.
 * Redirects unauthenticated users to /hr/login.
 */
export default function HrProtectedRoute() {
  if (!hasActiveAuthStorage(['hr', 'admin'])) {
    return <Navigate to="/hr/login" replace />;
  }

  return <Outlet />;
}

