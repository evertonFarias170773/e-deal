/**
 * maestro-agent-conferencia.server.ts
 *
 * Conferencia do ASSUNTO de uma resposta de uso: a pagina do manual que foi
 * lida ensina a mesma tarefa que o usuario perguntou?
 *
 * POR QUE EXISTE
 *   O manual ainda nao cobre todas as telas. Medido em 02/10/2026: perguntado
 *   "como aprovo um cadastro de CPF que o cliente preencheu pelo link?" (tela
 *   sem pagina), o modelo leu a pagina da aba Geral da proposta e respondeu com
 *   o passo a passo de "adicionar socio pagador" — nomes de botao todos reais,
 *   tarefa errada. A trava de nomes (maestro-agent-trava-manual.ts) nao pega
 *   isso, e so o prompt nao segurou (2 de 2 rodadas).
 *
 * COMO
 *   Uma chamada curta e separada ao modelo, com a pergunta, o que cada pagina
 *   lida ensina e a resposta candidata. Devolve sim/nao. So um "nao" claro
 *   barra; duvida, erro ou falta de tempo deixam a resposta passar (as outras
 *   travas continuam valendo).
 *
 * ⚠️ Roda apenas no servidor.
 */

import { carregarManual } from './maestro-agent-manual.server';

export type ConferenciaDoAssunto = 'mesma_tarefa' | 'outra_tarefa' | 'nao_conferido';

export interface EntradaDaConferencia {
  pergunta: string;
  /** Ultimas falas da conversa, para entender pergunta de continuacao ("e depois?") */
  historico: Array<{ role: string; content: string }>;
  /** Identificadores das paginas lidas neste turno */
  paginasLidas: readonly string[];
  resposta: string;
}

/** Cliente minimo da OpenAI que esta funcao usa (o loop passa o dele). */
export interface ClienteDeChat {
  chat: {
    completions: {
      create: (corpo: Record<string, unknown>, opcoes?: { signal?: AbortSignal }) => Promise<{
        choices: Array<{ message?: { content?: string | null } }>;
      }>;
    };
  };
}

const SISTEMA =
  'Você confere respostas de um assistente que ensina a usar um sistema (ERP) a partir de páginas de manual. ' +
  'Sua única tarefa: dizer se a resposta ensina a MESMA tarefa que o usuário perguntou, ou se adapta uma tarefa DIFERENTE que só tem palavras em comum com a pergunta. ' +
  'Mesma tarefa = mesmo objetivo do usuário, na tela certa. Tarefa diferente = o usuário quer fazer A (ex.: aprovar um cadastro que chegou por um link) e a resposta ensina B (ex.: adicionar um sócio pagador numa proposta). ' +
  'Resposta que apresenta mais de um caminho para o que foi pedido, ou que diz que o usuário não tem permissão e explica os passos, continua sendo a mesma tarefa. ' +
  'Se a pergunta for continuação da conversa, use o histórico para entender o que foi pedido. Na dúvida, considere mesma tarefa. ' +
  'Responda SOMENTE um JSON: {"tarefa_perguntada":"...","tarefa_ensinada":"...","mesma_tarefa":true|false}';

export function montarPedidoDeConferencia(entrada: EntradaDaConferencia): string {
  const manual = carregarManual();
  const paginas = entrada.paginasLidas
    .map(slug => manual.find(p => p.slug === slug))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map(p => `- ${p.titulo}${p.paraQueServe ? ` — serve para: ${p.paraQueServe}` : ''}${p.assuntos.length > 0 ? ` — tarefas que ensina: ${p.assuntos.join('; ')}` : ''}`);
  const historico = entrada.historico
    .slice(-4)
    .map(t => `${t.role === 'user' ? 'Usuário' : 'Assistente'}: ${t.content.slice(0, 300)}`);

  return [
    historico.length > 0 ? `HISTÓRICO RECENTE:\n${historico.join('\n')}\n` : '',
    `PERGUNTA DO USUÁRIO:\n${entrada.pergunta.slice(0, 600)}\n`,
    `PÁGINAS DO MANUAL LIDAS:\n${paginas.join('\n') || '(nenhuma identificada)'}\n`,
    `RESPOSTA DO ASSISTENTE:\n${entrada.resposta.slice(0, 2500)}`,
  ].filter(Boolean).join('\n');
}

/** Interpreta o JSON devolvido. Qualquer coisa fora do esperado = nao conferido. */
export function lerVeredito(bruto: string | null | undefined): ConferenciaDoAssunto {
  if (!bruto) return 'nao_conferido';
  try {
    const json = JSON.parse(bruto) as { mesma_tarefa?: unknown };
    if (json.mesma_tarefa === true) return 'mesma_tarefa';
    if (json.mesma_tarefa === false) return 'outra_tarefa';
  } catch {
    // cai no nao_conferido
  }
  return 'nao_conferido';
}

export async function conferirAssuntoDaResposta(
  cliente: ClienteDeChat,
  modelo: string,
  entrada: EntradaDaConferencia,
  prazoMs: number,
): Promise<ConferenciaDoAssunto> {
  if (entrada.paginasLidas.length === 0 || prazoMs < 1_500) return 'nao_conferido';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Math.min(prazoMs, 6_000));
  try {
    const resposta = await cliente.chat.completions.create(
      {
        model: modelo,
        temperature: 0,
        max_tokens: 120,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SISTEMA },
          { role: 'user', content: montarPedidoDeConferencia(entrada) },
        ],
      },
      { signal: controller.signal },
    );
    return lerVeredito(resposta.choices[0]?.message?.content);
  } catch {
    // Falha ou estouro de tempo nunca derruba a resposta.
    return 'nao_conferido';
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Texto fixo quando a pagina lida ensina outra tarefa: nenhum passo adaptado sai. */
export function respostaDeAssuntoSemPagina(paginasLidas: readonly string[]): string {
  const manual = carregarManual();
  const titulos = paginasLidas
    .map(slug => manual.find(p => p.slug === slug)?.titulo)
    .filter((t): t is string => Boolean(t));
  const lida =
    titulos.length > 0
      ? ` A página que encontrei (${titulos.join(', ')}) ensina outra tarefa, então não vou adaptar os passos dela.`
      : '';
  return (
    `Ainda não tenho o passo a passo disso no manual do Vibe.${lida} ` +
    'Para esta dúvida, vale perguntar a quem cuida dessa área. Se houver um número de pedido, eu consigo mostrar a situação real dele.'
  );
}
