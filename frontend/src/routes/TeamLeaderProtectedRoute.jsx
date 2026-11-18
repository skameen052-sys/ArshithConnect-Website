import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { hasActiveAuthStorage } from '../utils/authSession';

/**
 * TeamLeaderProtectedRoute
 * Guards Team Leader portal routes for users with 'team_leader', 'admin', 'hr_projects', or 'hr' roles.
 */
export default function TeamLeaderProtectedRoute() {
  const allowedRoles = ['team_leader', 'admin', 'hr_projects', 'hr'];
  if (!hasActiveAuthStorage(allowedRoles, { requireUser: false })) {
    return <Navigate to="/teamlead/login" replace />;
  }

  return <Outlet />;
}

