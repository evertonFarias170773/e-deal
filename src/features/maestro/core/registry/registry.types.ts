import type { SpecialistType } from '../../types';
import type { ExecutionMode } from '../planner/planner.types';

export type ToolStatus = 'active' | 'deprecated' | 'offline';

export interface ToolDefinition {
  id: string;
  name: string;
  domain: string;
  specialist: SpecialistType;
  description: string;
  version: string;
  executionMode: ExecutionMode;
  status: ToolStatus;
  
  // Future fields
  requiredPermissions?: string[];
  supportedIntents?: string[];
  supportedObjects?: string[];
  inputSchema?: Record<string, any>;
  outputSchema?: Record<string, any>;
}
