export interface HighlightBlock {
  label: string;
  value: string;
  icon?: string;
  color?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

export interface CardBlock {
  title: string;
  content?: string;
  metadata?: Record<string, string>;
}

export interface TableBlock {
  headers: string[];
  rows: string[][];
}

export interface NextActionBlock {
  label: string;
  actionId: string;
  payload?: any;
}

export interface ResponseModel {
  title: string;
  summary: string;
  explanation?: string;
  highlights?: HighlightBlock[];
  cards?: CardBlock[];
  tables?: TableBlock[];
  warnings?: string[];
  recommendations?: string[];
  nextActions?: NextActionBlock[];
}

export interface ResponseMetadata {
  responseId: string;
  generatedAt: string; // ISO 8601
  templateId: string;
  templateVersion: string;
  confidence: number;
  dataSources: string[];
  toolsUsed: string[];
  executionTime: number; // in ms
  policyDecision?: string;
  executionPlanId?: string;
  conversationId?: string;
  specialist?: string;
  domain?: string;
}
