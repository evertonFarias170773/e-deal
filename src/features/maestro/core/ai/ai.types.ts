import type { ConversationContext } from '../../types';
import type { ExecutionPlan } from '../planner/planner.types';
import type { RegistryResolution } from '../registry/registry.result';
import type { PolicyDecision } from '../policy/policy.result';
import type { ToolResult } from '../tools/tools.types';
import type { ResponseModel, ResponseMetadata } from '../response/response.types';

export interface AIProviderCapabilities {
  chat: boolean;
  vision: boolean;
  embeddings: boolean;
  toolCalling: boolean;
  jsonMode: boolean;
  streaming: boolean;
}

export interface AIRequest {
  systemPrompt: string;
  userPrompt: string;
  conversationContext: ConversationContext;
  executionPlan?: ExecutionPlan;
  registryResolution?: RegistryResolution;
  policyDecisions?: Record<string, PolicyDecision>;
  toolResults?: Record<string, ToolResult>;
  responseModel?: ResponseModel;
  responseMetadata?: ResponseMetadata;
  temperature?: number;
}

export interface AIResponse {
  content: string;
  reasoningSummary?: string;
  confidence: number;
  provider: string;
  model: string;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  latency: number;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error' | 'unknown';
}

export interface AIProvider {
  id: string;
  name: string;
  capabilities: AIProviderCapabilities;
  generate(request: AIRequest): Promise<AIResponse>;
}
