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
 * TRECHOS DA FICHA (09/10/2026)
 *   So com os titulos da pagina, o juiz barrava resposta certa quando a ficha
 *   diz que algo NAO existe ou AINDA nao da ("onde fica a aba Boletim?",
 *   "posso emitir NFS-e em producao?"): 5 falsos em 114 turnos de prova. Agora
 *   ele recebe tambem os paragrafos da ficha que a resposta usou (teto de 4 mil
 *   caracteres) e a regra de que "nao existe" e "ainda nao da" sao a mesma
 *   tarefa. Desligar: MAESTRO_CONFERENCIA_TRECHO=off (volta ao pedido so com os
 *   titulos e sem a regra).
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
        usage?: unknown;
      }>;
    };
  };
}

/** Teto dos trechos da ficha enviados ao juiz. */
export const TETO_DOS_TRECHOS = 4_000;
const TETO_POR_BLOCO = 600;

export function conferenciaComTrechoLigada(): boolean {
  return (process.env.MAESTRO_CONFERENCIA_TRECHO ?? '').trim().toLowerCase() !== 'off';
}

const REGRA_DO_NAO_EXISTE =
  'Quando houver TRECHOS DA PÁGINA, confira a resposta contra eles. ' +
  'Se a página diz que o que o usuário procura NÃO EXISTE, ou que AINDA NÃO DÁ para fazer, e a resposta diz isso e indica o caminho que a página aponta, é a MESMA tarefa: responder "não existe" ou "ainda não dá" é responder ao que foi perguntado. ' +
  'Só é tarefa diferente quando os trechos não tratam do que o usuário perguntou. ';

const semAcentoMinusculo = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const palavrasDe = (texto: string) => new Set(semAcentoMinusculo(texto).match(/[a-z0-9]{6,}/g) ?? []);

/** Nomes que a resposta destaca: o que está em **negrito** ou entre aspas. */
function nomesDestacados(texto: string): string[] {
  const achados = [...texto.matchAll(/\*\*([^*\n]{3,80})\*\*|["“]([^"”\n]{3,120})["”]/g)].map(m => semAcentoMinusculo((m[1] ?? m[2]).trim()));
  return [...new Set(achados)];
}

/**
 * Os parágrafos da ficha que a resposta usou, na ordem da página, até o teto.
 * Um bloco é uma linha da ficha (parágrafo, item de lista ou linha de tabela);
 * entra o que compartilha com a resposta um nome destacado ou várias palavras,
 * e o que trata das palavras da pergunta. Cada bloco leva o título da seção.
 */
export function trechosUsadosDaFicha(conteudo: string, resposta: string, pergunta = '', teto = TETO_DOS_TRECHOS): string {
  const nomes = nomesDestacados(resposta);
  const daResposta = palavrasDe(resposta);
  const daPergunta = palavrasDe(pergunta);
  let secao = '';
  const blocos: Array<{ ordem: number; secao: string; texto: string; pontos: number }> = [];
  String(conteudo ?? '').replace(/\r\n/g, '\n').split('\n').forEach((linha, ordem) => {
    const texto = linha.trim();
    if (!texto || /^\|?[\s:|-]+\|?$/.test(texto)) return;
    if (/^#{1,4}\s/.test(texto)) {
      secao = texto.replace(/^#+\s*/, '');
      return;
    }
    const base = semAcentoMinusculo(texto);
    let comuns = 0;
    let daDuvida = 0;
    for (const palavra of palavrasDe(texto)) {
      if (daResposta.has(palavra)) comuns++;
      if (daPergunta.has(palavra)) daDuvida++;
    }
    const pontos = nomes.filter(n => base.includes(n)).length * 5 + Math.min(comuns, 10) + Math.min(daDuvida, 3) * 2;
    if (pontos >= 4) {
      blocos.push({ ordem, secao, texto: texto.length > TETO_POR_BLOCO ? `${texto.slice(0, TETO_POR_BLOCO - 1)}…` : texto, pontos });
    }
  });

  const escolhidos: typeof blocos = [];
  let total = 0;
  for (const bloco of [...blocos].sort((a, b) => b.pontos - a.pontos || a.ordem - b.ordem)) {
    const custo = bloco.texto.length + bloco.secao.length + 6;
    if (total + custo > teto) continue;
    escolhidos.push(bloco);
    total += custo;
  }
  let ultimaSecao: string | null = null;
  return escolhidos
    .sort((a, b) => a.ordem - b.ordem)
    .map(b => {
      const cabeca = b.secao && b.secao !== ultimaSecao ? `[${b.secao}]\n` : '';
      ultimaSecao = b.secao;
      return `${cabeca}${b.texto}`;
    })
    .join('\n');
}

/** Trechos de cada página lida, dividindo o teto entre elas. */
function trechosDasPaginasLidas(entrada: EntradaDaConferencia): string {
  // Página restrita a administradores não vai: quem pergunta pode não tê-la lido.
  const lidas = carregarManual().filter(p => entrada.paginasLidas.includes(p.slug) && !p.somenteAdministradores);
  if (lidas.length === 0) return '';
  const porPagina = Math.floor(TETO_DOS_TRECHOS / lidas.length);
  return lidas
    .map(p => {
      const usado = trechosUsadosDaFicha(p.conteudo, entrada.resposta, entrada.pergunta, porPagina - p.titulo.length - 8);
      return usado ? `== ${p.titulo} ==\n${usado}` : '';
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(0, TETO_DOS_TRECHOS);
}

const SISTEMA_INICIO =
  'Você confere respostas de um assistente que ensina a usar um sistema (ERP) a partir de páginas de manual. ' +
  'Sua única tarefa: dizer se a resposta ensina a MESMA tarefa que o usuário perguntou, ou se adapta uma tarefa DIFERENTE que só tem palavras em comum com a pergunta. ' +
  'Mesma tarefa = mesmo objetivo do usuário, na tela certa. Tarefa diferente = o usuário quer fazer A (ex.: aprovar um cadastro que chegou por um link) e a resposta ensina B (ex.: adicionar um sócio pagador numa proposta). ' +
  'Resposta que apresenta mais de um caminho para o que foi pedido, ou que diz que o usuário não tem permissão e explica os passos, continua sendo a mesma tarefa. ' +
  'Se a pergunta for continuação da conversa, use o histórico para entender o que foi pedido. Na dúvida, considere mesma tarefa. ';
const SISTEMA_FIM = 'Responda SOMENTE um JSON: {"tarefa_perguntada":"...","tarefa_ensinada":"...","mesma_tarefa":true|false}';

/** Instrução do juiz. Com os trechos ligados, leva a regra do "não existe". */
export function instrucaoDoJuiz(): string {
  return SISTEMA_INICIO + (conferenciaComTrechoLigada() ? REGRA_DO_NAO_EXISTE : '') + SISTEMA_FIM;
}

export function montarPedidoDeConferencia(entrada: EntradaDaConferencia): string {
  const manual = carregarManual();
  const paginas = entrada.paginasLidas
    .map(slug => manual.find(p => p.slug === slug))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map(p => `- ${p.titulo}${p.paraQueServe ? ` — serve para: ${p.paraQueServe}` : ''}${p.assuntos.length > 0 ? ` — tarefas que ensina: ${p.assuntos.join('; ')}` : ''}`);
  const historico = entrada.historico
    .slice(-4)
    .map(t => `${t.role === 'user' ? 'Usuário' : 'Assistente'}: ${t.content.slice(0, 300)}`);
  const trechos = conferenciaComTrechoLigada() ? trechosDasPaginasLidas(entrada) : '';

  return [
    historico.length > 0 ? `HISTÓRICO RECENTE:\n${historico.join('\n')}\n` : '',
    `PERGUNTA DO USUÁRIO:\n${entrada.pergunta.slice(0, 600)}\n`,
    `PÁGINAS DO MANUAL LIDAS:\n${paginas.join('\n') || '(nenhuma identificada)'}\n`,
    trechos ? `TRECHOS DA PÁGINA QUE A RESPOSTA USOU:\n${trechos}\n` : '',
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
  /** Recebe o `usage` da chamada, para a medição do turno. */
  aoUsar?: (usage: unknown) => void,
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
          { role: 'system', content: instrucaoDoJuiz() },
          { role: 'user', content: montarPedidoDeConferencia(entrada) },
        ],
      },
      { signal: controller.signal },
    );
    aoUsar?.(resposta.usage);
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
