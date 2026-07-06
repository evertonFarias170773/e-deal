import type { SpecialistType } from '../../types';

export interface IntentDefinition {
  id: string;
  name: string;
  domain: string;
  specialist: SpecialistType;
  intents: string[];      // Possible verbs: consultar, criar, editar...
  objects: string[];      // Possible targets: boleto, cliente, pedido...
  keywords: string[];     // Contextual keywords: pendente, vencido, urgente...
  defaultConfidence: 'high' | 'medium' | 'low';
  nextActions: string[];  // For future Planner use
}

export interface IntentRecognitionResult {
  intentId: string | null;
  intent: string | null;
  domain: string | null;
  targetObject: string | null;
  specialist: SpecialistType;
  confidence: 'high' | 'medium' | 'low';
  keywordsMatched: string[];
}
