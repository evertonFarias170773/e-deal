export interface ToolResult {
  toolId: string;
  success: boolean;
  data: any;
  source: 'supabase' | 'cache' | 'mock' | 'system';
  /** Label descritivo da fonte — usado pelo presenter para citar origem exata (ex: 'public.propostas · filtro: id_int = N') */
  sourceLabel?: string;
  executionTime: number; // ms
  count: number;
  warnings: string[];
  errors: string[];
}
