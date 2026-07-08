import { processarOrcamentoAvulso } from './src/features/maestro/core/simple/maestro-orcamento-engine';
console.log('1.', processarOrcamentoAvulso('qual valor pra 1560 tri', { itens: [], pendingAmbiguity: false }).action);
console.log('2.', processarOrcamentoAvulso('1500 ingressos mobi', { itens: [], pendingAmbiguity: false }).action);
console.log('3.', processarOrcamentoAvulso('orçamento para 1500 ingressos mobi', { itens: [], pendingAmbiguity: false }).action);
