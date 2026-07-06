import { INTENT_DICTIONARY } from './intent.dictionary';
import type { IntentRecognitionResult } from './intent.types';

export function recognizeIntent(query: string): IntentRecognitionResult {
  const normalized = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  let bestMatch: IntentRecognitionResult = {
    intentId: null,
    intent: null,
    domain: 'Geral',
    targetObject: null,
    specialist: 'geral',
    confidence: 'low',
    keywordsMatched: [],
  };

  let maxScore = 0;

  for (const def of INTENT_DICTIONARY) {
    let score = 0;
    const matchedKeys: string[] = [];
    let matchedIntent: string | null = null;
    let matchedObject: string | null = null;

    // Intents give 3 points
    for (const intent of def.intents) {
      const normIntent = intent.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (normalized.includes(normIntent)) {
        score += 3;
        matchedKeys.push(intent);
        if (!matchedIntent) matchedIntent = intent;
      }
    }

    // Objects give 4 points (strongest domain indicator)
    for (const obj of def.objects) {
      const normObj = obj.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (normalized.includes(normObj)) {
        score += 4;
        matchedKeys.push(obj);
        if (!matchedObject) matchedObject = obj;
      }
    }

    // Keywords give 1 point
    for (const kw of def.keywords) {
      const normKw = kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (normalized.includes(normKw)) {
        score += 1;
        matchedKeys.push(kw);
      }
    }

    if (score > maxScore) {
      maxScore = score;
      let confidence: 'high' | 'medium' | 'low' = def.defaultConfidence;
      
      // Dynamic confidence calculation based on rule matches
      if (score >= 7) confidence = 'high'; // matched at least an intent and an object
      else if (score >= 4) confidence = 'medium'; // matched at least an object
      else if (score > 0) confidence = 'low'; // weak match

      bestMatch = {
        intentId: def.id,
        intent: matchedIntent || def.intents[0], // fallback to first intent of domain if only object matched
        domain: def.domain,
        targetObject: matchedObject || def.objects[0],
        specialist: def.specialist,
        confidence,
        keywordsMatched: matchedKeys,
      };
    }
  }

  // Fallback for completely unrecognized queries
  if (maxScore === 0) {
    bestMatch = {
      intentId: 'sys-ajuda',
      intent: 'ajudar',
      domain: 'Sistema',
      targetObject: 'sistema',
      specialist: 'geral',
      confidence: 'low',
      keywordsMatched: [],
    };
  }

  return bestMatch;
}
