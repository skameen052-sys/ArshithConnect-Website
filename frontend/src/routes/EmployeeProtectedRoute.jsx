import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { hasActiveAuthStorage } from '../utils/authSession';

/**
 * EmployeeProtectedRoute - Route guard for employee portal
 * Ensures only authenticated employees (or admins) can access /employee routes.
 * Redirects unauthenticated users to /login.
 */
export default function EmployeeProtectedRoute() {
  if (!hasActiveAuthStorage(['employee'])) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
