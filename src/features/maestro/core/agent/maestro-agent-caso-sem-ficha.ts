/**
 * maestro-agent-caso-sem-ficha.ts
 *
 * Fase 1 do encaminhamento de casos sem resolução (09/10/2026).
 *
 * O QUE FAZ
 *   1. DETECÇÃO: a mensagem do usuário traz assinatura de erro técnico
 *      ("duplicate key", "violates", "permission denied", nome de índice ou
 *      constraint, texto de erro entre aspas) e NENHUMA ficha do manual cita
 *      aquele erro → o turno é registrado em maestro_acoes como
 *      `caso_sem_ficha`. Nenhuma tarefa é criada nesta fase.
 *   2. TRAVA DE CASO SENSÍVEL: erro técnico em assunto de boleto, pagamento,
 *      cobrança, NF-e ou NFS-e → o servidor tira da resposta qualquer sugestão
 *      de repetir a ação e acrescenta a frase fixa `AVISO_NAO_REPITA`. Repetir
 *      registro de boleto ou emissão de nota é o que duplica título e nota.
 *      Erro CRU DE BANCO (chave duplicada, violação, permissão, índice) cai na
 *      trava mesmo quando uma ficha o cita.
 *
 * O QUE NÃO FAZ
 *   - Mensagem de TELA entre aspas que uma ficha cita segue o manual: a ficha
 *     pode mandar clicar de novo com razão (ex.: "o envio NÃO foi registrado").
 *   - Não guarda dado pessoal: CPF, CNPJ, telefone, e-mail e sequências longas
 *     de dígitos são mascarados antes de qualquer registro.
 *
 * DESLIGAR: MAESTRO_CASO_SEM_FICHA=off (detecção, registro e trava).
 *
 * Funções puras, sem modelo. Só `registrarCasoSemFicha` toca no banco, com a
 * sessão do usuário (RLS de maestro_acoes: linhas do próprio usuário).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { registrarAcaoMaestro } from '../simple/maestro-audit.server';
import { extrairPedidosCitados } from './maestro-agent-trava-pedido';

export const ACAO_CASO_SEM_FICHA = 'caso_sem_ficha';

/** Registros de `caso_sem_ficha` aceitos por usuário a cada hora. */
export const LIMITE_DE_REGISTROS_POR_HORA = 5;

export const AVISO_NAO_REPITA = 'Não repita a ação. Avise o suporte com o número do pedido e o texto do erro.';

const ASSINATURA_MAX = 200;
const RESPOSTA_MAX = 600;

export function casoSemFichaLigado(): boolean {
  return (process.env.MAESTRO_CASO_SEM_FICHA ?? '').trim().toLowerCase() !== 'off';
}

export type TipoDeErroTecnico = 'chave_duplicada' | 'violacao' | 'sem_permissao' | 'indice_ou_constraint' | 'erro_entre_aspas';

export interface ErroTecnico {
  tipo: TipoDeErroTecnico;
  /** Trecho da mensagem que carrega o erro, mascarado e truncado. */
  assinatura: string;
  /** O que procurar no manual para saber se alguma ficha cita este erro. */
  termos: string[];
}

const semAcento = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
const normalizar = (texto: string) => semAcento(texto).toLowerCase().replace(/\s+/g, ' ').trim();

/** Nome de índice ou constraint do Postgres: idx_x_y, x_y_key, x_pkey, x_fkey, x_check. */
const RE_INDICE = /\b(?:(?:idx|uq|uk|fk|pk|chk)_[a-z0-9]+(?:_[a-z0-9]+)+|[a-z0-9]+(?:_[a-z0-9]+)+_(?:pkey|fkey|key|check|chk|idx))\b/gi;
const RE_DUPLICADA = /duplicate\s+key/i;
const RE_VIOLACAO = /\bviolates\b|viola(?:[çc][aã]o)?\s+(?:de\s+|a\s+)?(?:restri[çc][aã]o|constraint|chave)/i;
const RE_PERMISSAO = /permission\s+denied|row-level\s+security/i;
const RE_ASPAS = /["“”«]([^"“”«»\n]{8,300})["“”»]/g;
const RE_PALAVRA_DE_ERRO = /\b(?:erro|error|errors|falha|falhou|failed|failure|exception|exce[çc][aã]o|invalid|inv[aá]lid[oa]|denied|recusad[oa]|rejeitad[oa]|n[aã]o\s+foi\s+poss[ií]vel|timeout|unexpected)\b/i;

/**
 * Tira dado pessoal de um texto que vai para o registro: e-mail, CPF, CNPJ,
 * telefone e qualquer sequência de 7 ou mais dígitos. Número de pedido (até 6
 * dígitos) fica.
 */
export function mascararDadoPessoal(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[e-mail]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]')
    .replace(/\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[telefone]')
    .replace(/\d[\d.\-/\s]{5,}\d/g, trecho => (trecho.replace(/\D/g, '').length >= 7 && !/^\d{2}\/\d{2}\/\d{4}$/.test(trecho) ? '[número]' : trecho));
}

function cortar(texto: string, max: number): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length > max ? `${limpo.slice(0, max - 1)}…` : limpo;
}

/** A frase (ou linha) da mensagem onde o erro aparece. */
function trechoDoErro(mensagem: string, indice: number): string {
  const inicio = Math.max(mensagem.lastIndexOf('\n', indice - 1) + 1, indice - 120, 0);
  const fimDaLinha = mensagem.indexOf('\n', indice);
  const fim = Math.min(fimDaLinha === -1 ? mensagem.length : fimDaLinha, indice + ASSINATURA_MAX);
  return mensagem.slice(inicio, fim);
}

/**
 * A mensagem do usuário traz assinatura de erro técnico?
 * Pergunta comum ("como emito boleto?", 'o que é "Liberado"?') devolve null.
 */
export function detectarErroTecnico(mensagem: string): ErroTecnico | null {
  const texto = String(mensagem ?? '');
  if (!texto.trim()) return null;

  const indices = [...new Set((texto.match(RE_INDICE) ?? []).map(n => n.toLowerCase()))];
  const montar = (tipo: TipoDeErroTecnico, posicao: number, termos: string[]): ErroTecnico => ({
    tipo,
    assinatura: cortar(mascararDadoPessoal(trechoDoErro(texto, posicao)), ASSINATURA_MAX),
    termos,
  });

  const duplicada = RE_DUPLICADA.exec(texto);
  if (duplicada) return montar('chave_duplicada', duplicada.index, indices.length > 0 ? indices : ['duplicate key']);

  const violacao = RE_VIOLACAO.exec(texto);
  if (violacao) return montar('violacao', violacao.index, indices.length > 0 ? indices : [normalizar(violacao[0])]);

  const permissao = RE_PERMISSAO.exec(texto);
  if (permissao) return montar('sem_permissao', permissao.index, [normalizar(permissao[0])]);

  if (indices.length > 0) return montar('indice_ou_constraint', texto.toLowerCase().indexOf(indices[0]), indices);

  // Texto entre aspas só conta quando é texto de ERRO: a palavra de erro está
  // dentro das aspas, ou a mensagem fala em erro e cola o texto que apareceu.
  const falaEmErro = RE_PALAVRA_DE_ERRO.test(texto.replace(RE_ASPAS, ' '));
  RE_ASPAS.lastIndex = 0;
  let aspas: RegExpExecArray | null;
  while ((aspas = RE_ASPAS.exec(texto)) !== null) {
    const citado = aspas[1].trim();
    if (RE_PALAVRA_DE_ERRO.test(citado) || (falaEmErro && citado.split(/\s+/).length >= 3)) {
      RE_ASPAS.lastIndex = 0;
      return montar('erro_entre_aspas', aspas.index, [normalizar(citado)]);
    }
  }
  return null;
}

/**
 * Alguma ficha do manual cita este erro? Compara sem acento e sem caixa.
 * Texto citado entre aspas pode vir com número ou nome no meio: basta um
 * pedaço de 5 palavras seguidas do texto estar numa ficha.
 */
export function manualCitaOErro(erro: ErroTecnico, textosDoManual: readonly string[]): boolean {
  const fichas = textosDoManual.map(normalizar);
  for (const termo of erro.termos) {
    const alvo = normalizar(termo);
    if (alvo.length < 6) continue;
    if (fichas.some(f => f.includes(alvo))) return true;
    if (erro.tipo !== 'erro_entre_aspas') continue;
    const palavras = alvo.split(' ');
    for (let i = 0; i + 5 <= palavras.length; i++) {
      const pedaco = palavras.slice(i, i + 5).join(' ');
      if (pedaco.length >= 20 && fichas.some(f => f.includes(pedaco))) return true;
    }
  }
  return false;
}

const RE_ASSUNTO_SENSIVEL =
  /\b(?:boletos?|pagamentos?|pagou|pago|pix|cobran[çc]as?|nf-?e|nfs-?e|notas?\s+fiscais?|nota\s+fiscal|faturad[oa]s?|faturamento|t[ií]tulos?|cart[aã]o|estorno|duplicatas?)\b/i;

/** Assunto em que repetir a ação pode duplicar dinheiro ou documento fiscal. */
export function assuntoSensivel(texto: string): boolean {
  return RE_ASSUNTO_SENSIVEL.test(String(texto ?? ''));
}

const VERBOS_DE_ACAO =
  '(?:tent|repit|repet|refa[çcz]|registr|emit|ger|envi|reenvi|reemit|cri|clic|fa[çcz]|execut|process|lanc|lan[çc]|salv|confirm|pagu|pagar)\\w*';
const DE_NOVO = '(?:de\\s+novo|novamente|outra\\s+vez|mais\\s+uma\\s+vez)';
const RE_REPETIR = new RegExp(
  [
    `\\b${VERBOS_DE_ACAO}\\b[^.!?\\n]{0,60}\\b${DE_NOVO}`,
    `\\b${DE_NOVO}\\b[^.!?\\n]{0,20}\\b${VERBOS_DE_ACAO}`,
    '\\b(?:repita|repetir|repete|refa[çc]a|refazer|reenvie|reenviar|reemita|reemitir|retente|tentar\\s+mais\\s+tarde|tente\\s+mais\\s+tarde)\\b',
    '\\bnova\\s+tentativa\\b',
    '\\btente\\s+(?:registrar|emitir|gerar|enviar|criar|pagar|lan[çc]ar)\\b',
  ].join('|'),
  'i',
);
/** "Não repita", "não tente de novo", "sem repetir": é a orientação certa, fica. */
const RE_NEGADA = /\b(?:n[aã]o|nunca|sem|evite|antes\s+de)\s+(?:\w+\s+){0,2}?(?:repit|repet|tent|refa|reenvi|reemit|registr|emit|ger|clic|fa[çc])/i;

function sugereRepetir(frase: string): boolean {
  return RE_REPETIR.test(frase) && !RE_NEGADA.test(frase);
}

/** Quebra uma linha em frases, guardando a pontuação de cada uma. */
function frasesDaLinha(linha: string): string[] {
  return linha.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)\s*/g) ?? [linha];
}

export interface RespostaSemRepeticao {
  texto: string;
  /** Frases retiradas por sugerirem repetir a ação. */
  removidas: number;
}

/**
 * Tira da resposta toda frase que sugere repetir a ação e termina com a frase
 * fixa. Item de lista ou passo numerado sai inteiro.
 */
export function aplicarTravaDeNaoRepetir(resposta: string): RespostaSemRepeticao {
  let removidas = 0;
  const linhas: string[] = [];
  for (const linha of String(resposta ?? '').split('\n')) {
    if (linha.includes(AVISO_NAO_REPITA)) continue;
    const ehItem = /^\s*(?:[-*•]|\d+[.)])\s+/.test(linha);
    if (ehItem) {
      if (sugereRepetir(linha)) removidas++;
      else linhas.push(linha);
      continue;
    }
    const mantidas = frasesDaLinha(linha).filter(frase => {
      if (!sugereRepetir(frase)) return true;
      removidas++;
      return false;
    });
    const nova = mantidas.join('').trimEnd();
    if (nova.trim() || !linha.trim()) linhas.push(nova);
  }
  const corpo = linhas.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const texto = corpo ? `${corpo}\n\n${AVISO_NAO_REPITA}` : `Não consegui resolver este erro. ${AVISO_NAO_REPITA}`;
  return { texto, removidas };
}

export interface CasoSemFicha {
  erro: ErroTecnico;
  /** Nenhuma ficha cita o erro: é o caso que vai para o registro. */
  semFicha: boolean;
  /** Assunto de dinheiro ou nota fiscal: vale a trava de não repetir. */
  sensivel: boolean;
  /** Fichas que citam o erro (identificadores), quando o chamador os informou. */
  fichas: string[];
  pedidos: string[];
}

/**
 * O erro relatado pede algum tratamento? `textosDoManual` = conteúdo de todas
 * as fichas. Devolve null quando não há erro técnico na mensagem, quando o
 * erro é mensagem de tela que uma ficha cita, e quando a ficha cita o erro e o
 * assunto não é sensível.
 */
export function avaliarCasoSemFicha(
  mensagem: string,
  textosDoManual: readonly string[],
  slugs: readonly string[] = [],
): CasoSemFicha | null {
  const erro = detectarErroTecnico(mensagem);
  if (!erro) return null;
  const citam = textosDoManual.map((texto, i) => (manualCitaOErro(erro, [texto]) ? i : -1)).filter(i => i >= 0);
  const semFicha = citam.length === 0;
  const sensivel = assuntoSensivel(mensagem);
  if (!semFicha && (erro.tipo === 'erro_entre_aspas' || !sensivel)) return null;
  const fichas = citam.map(i => slugs[i]).filter((s): s is string => Boolean(s));
  return { erro, semFicha, sensivel, fichas, pedidos: extrairPedidosCitados(mensagem) };
}

/** Recado ao modelo, antes de ele responder, quando o caso foi detectado. */
export function orientacaoDeCasoSemFicha(caso: CasoSemFicha): string {
  return [
    caso.semFicha
      ? 'O usuário relata um ERRO TÉCNICO que nenhuma página do manual do Vibe explica. Diga com honestidade que você não tem a solução deste erro. Não invente causa nem correção.'
      : `O usuário relata um ERRO TÉCNICO de banco que o manual do Vibe cita${caso.fichas.length > 0 ? ` (páginas: ${caso.fichas.join(', ')})` : ''}. Chame consultar_manual com essa página ANTES de responder e explique a causa só pelo que ela diz, sem inventar.`,
    caso.sensivel
      ? 'O assunto envolve boleto, pagamento, cobrança ou nota fiscal: NÃO sugira repetir, refazer, registrar ou emitir de novo, nem "tentar mais tarde". Repetir pode duplicar título ou nota.'
      : 'Não sugira repetir a ação como solução.',
    'Você pode consultar o pedido citado e mostrar a situação real dele. Oriente avisar o suporte com o número do pedido e o texto do erro.',
  ].join(' ');
}

export interface RegistroDeCasoSemFicha {
  supabase: SupabaseClient;
  userId: string;
  caso: CasoSemFicha;
  /** Páginas do manual lidas no turno: é o que o Maestro sabe sobre a tela. */
  paginasLidas: readonly string[];
  resposta: string;
  frasesRemovidas: number;
  agora?: Date;
}

export type DesfechoDoRegistro = 'registrado' | 'limite_por_hora' | 'limite_nao_conferido';

/**
 * Grava o caso em maestro_acoes, respeitando o limite por usuário e por hora.
 * Se a contagem falhar, não grava no banco (o log do servidor fica). Nunca lança.
 */
export async function registrarCasoSemFicha(entrada: RegistroDeCasoSemFicha): Promise<DesfechoDoRegistro> {
  const { supabase, userId, caso } = entrada;
  const desde = new Date((entrada.agora ?? new Date()).getTime() - 60 * 60 * 1000).toISOString();
  try {
    const { count, error } = await supabase
      .from('maestro_acoes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('acao', ACAO_CASO_SEM_FICHA)
      .gte('created_at', desde);
    if (error || typeof count !== 'number') {
      console.warn(`[MaestroCasoSemFicha] Limite não conferido (${error?.message ?? 'sem contagem'}) — caso só no log: ${caso.erro.tipo}`);
      return 'limite_nao_conferido';
    }
    if (count >= LIMITE_DE_REGISTROS_POR_HORA) {
      console.warn(`[MaestroCasoSemFicha] Limite de ${LIMITE_DE_REGISTROS_POR_HORA} por hora atingido — caso só no log: ${caso.erro.tipo}`);
      return 'limite_por_hora';
    }
  } catch (err) {
    console.warn('[MaestroCasoSemFicha] Falha ao conferir o limite — caso só no log:', err);
    return 'limite_nao_conferido';
  }

  const pedido = caso.pedidos.length === 1 ? Number(caso.pedidos[0]) : undefined;
  await registrarAcaoMaestro(supabase, {
    userId,
    acao: ACAO_CASO_SEM_FICHA,
    resultado: 'sucesso',
    idInt: pedido !== undefined && Number.isSafeInteger(pedido) ? pedido : undefined,
    detalhe: caso.erro.tipo,
    payload: {
      // O Maestro não recebe a tela em que o usuário está: ficam as fichas lidas.
      tela: entrada.paginasLidas.length > 0 ? entrada.paginasLidas.join(', ') : null,
      pedidos_citados: caso.pedidos,
      tipo_de_erro: caso.erro.tipo,
      assinatura_do_erro: caso.erro.assinatura,
      assunto_sensivel: caso.sensivel,
      frases_de_repetir_removidas: entrada.frasesRemovidas,
      resposta: cortar(mascararDadoPessoal(entrada.resposta), RESPOSTA_MAX),
    },
  });
  return 'registrado';
}
