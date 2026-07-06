import type { ExecutionMode } from '../planner/planner.types';
import type { ToolDefinition } from './registry.types';

export type RegistryResultStatus = 'ready' | 'unauthorized' | 'missing_params' | 'not_found' | 'blocked' | 'pending_confirmation';

export interface RegistryResult {
  stepId: string;
  toolId: string;
  tool?: ToolDefinition;
  status: RegistryResultStatus;
  executionMode: ExecutionMode;
  reason: string;
  estimatedDuration?: number;
}

export interface RegistryResolution {
  planId: string;
  status: 'resolved' | 'partial' | 'failed';
  results: RegistryResult[];
  missingTools: string[];
  blockedTools: string[];
  pendingConfirmationTools: string[];
  readyTools: string[];
}
