export interface SpecialistCapabilities {
  supportedDomains: string[];
  supportedIntents: string[];
  supportedObjects: string[];
  supportedTools: string[];
  supportedActions: string[];
}

export interface SpecialistExample {
  query: string;
  intent: string;
  toolsUsed: string[];
  expectedResponse: string;
}

export interface MaestroSpecialist {
  id: string;
  name: string;
  description: string;
  
  getCapabilities(): SpecialistCapabilities;
  getRules(): string[];
  getGuardrails(): string[];
  getPrompts(): string[];
  getExamples(): SpecialistExample[];
}
