import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { hasActiveAuthStorage } from '../utils/authSession';

/**
 * AdminProtectedRoute - Guards administrator routes
 * Verifies active session with admin role in localStorage.
 * Redirects unauthenticated users to /admin/login.
 */
export default function AdminProtectedRoute() {
  if (!hasActiveAuthStorage(['admin'])) {
    return <Navigate to="/admin/login" replace />;
  }

  return <Outlet />;
}
