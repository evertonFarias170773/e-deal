/**
 * test_veppo_call.ts
 *
 * Script para testar diretamente a chamada à API da VEPPO
 * usando o FreteService com os parâmetros do cenário real.
 *
 * Para rodar: npx tsx src/features/maestro/core/simple/test_veppo_call.ts
 */

import { solicitarCotacaoVeppo } from '../../../orcamentos/services/frete.service';

async function run() {
  console.log('=== Testando Chamada Direta à API da VEPPO ===');
  
  // Parâmetros do cenário:
  // Produto: 1000 Triband.
  // Peso unitário da pulseira Triband é aprox. 1.02g ou similar.
  // Peso total para 1.000 pulseiras = 1.000 * 1.02g = 1020g = 1.02kg.
  // Valor declarado: 1.000 * R$ 1.25 = R$ 1250,00.
  // Cidade: Santa Cruz do Sul, UF: RS.
  
  const input = {
    peso: 1020, // peso em gramas
    valor: 1250.00,
    cidade: 'Santa Cruz do Sul',
    uf: 'RS'
  };

  console.log('Payload de teste enviado para solicitarCotacaoVeppo:', JSON.stringify(input, null, 2));
  
  try {
    const fretes = await solicitarCotacaoVeppo(input);
    console.log('\n--- Resposta Recebida da VEPPO ---');
    console.log(JSON.stringify(fretes, null, 2));
    console.log('==============================================');
  } catch (err) {
    console.error('Erro na chamada da VEPPO:', err);
  }
}

run().catch(console.error);
