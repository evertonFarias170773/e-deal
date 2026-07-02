"use client";

import { ReactNode } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { AccessDenied } from "@/components/common/AccessDenied";

interface PermissionGuardProps {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionGuard({ permission, children, fallback }: PermissionGuardProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return null; // Or a generic loading spinner
  }

  const canAccess = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, permission);

  if (!canAccess) {
    return fallback ? <>{fallback}</> : <AccessDenied />;
  }

  return <>{children}</>;
}
