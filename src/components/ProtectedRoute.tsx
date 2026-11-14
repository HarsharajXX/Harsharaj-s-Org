import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { UserRole } from '../types';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles,
}) => {
  const { user, isLiveMode } = useStore();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  // Never allow demo authentication to access protected live routes when Supabase is active
  if (isLiveMode && user.is_demo) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (allowedRoles && allowedRoles.length > 0) {
    // When in offline Demo Mode, allow previewing /admin only if user explicitly has an admin role,
    // never automatically grant admin roles via email string matching.
    const hasAccess = user.roles.some((role) => allowedRoles.includes(role));
    if (!hasAccess) {
      return <Navigate to="/unauthorized" replace />;
    }
  }

  return <>{children}</>;
};
