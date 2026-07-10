import { processarOrcamentoAvulso, OrcamentoAvulsoState } from './maestro-orcamento-engine';

const state: OrcamentoAvulsoState = {
  itens: [
    { quantidade: 1000, termo: 'mobi' }
  ],
  pendingAmbiguity: false
};

const q1 = '900 mobi';
const r1 = processarOrcamentoAvulso(q1, state);
console.log('--- 900 mobi ---');
console.log(r1.action, r1.items);

const q2 = 'só 900 mobi';
const r2 = processarOrcamentoAvulso(q2, state);
console.log('--- só 900 mobi ---');
console.log(r2.action, r2.items);

const q3 = '1000 mobi e 900 triband';
const r3 = processarOrcamentoAvulso(q3, state);
console.log('--- 1000 mobi e 900 triband (ativo) ---');
console.log(r3.action, r3.items);

const q4 = '1000 mobi 1 1000 tex';
const r4 = processarOrcamentoAvulso(q4, state);
console.log('--- 1000 mobi 1 1000 tex ---');
console.log(r4.action, r4.items);
