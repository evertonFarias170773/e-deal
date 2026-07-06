import type { AuditLevel, PolicyDecisionStatus } from './policy.types';

export interface PolicyDecision {
  status: PolicyDecisionStatus;
  reason: string;
  requiresConfirmation: boolean;
  requiresPermission: string[];
  canExecute: boolean;
  auditLevel: AuditLevel;
  warnings: string[];
}
