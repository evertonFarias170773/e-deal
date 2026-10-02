/**
 * maestro-agent-status.ts
 *
 * Status do pedido na resposta do Maestro: exatamente como veio da consulta, ou
 * pelo rótulo que as telas do Vibe mostram para aquele status. Nunca reescrito.
 *
 * O CASO (02/10/2026)
 *   Pedido 23071, `status_interno = 'REVISAO PRODUCAO'`. A consulta devolveu o
 *   valor certo e o modelo escreveu "Situação: EM PRODUÇÃO" — que é OUTRO status
 *   da lista oficial (o seguinte no fluxo). O dado vinha da consulta certa; o
 *   nome foi trocado na redação.
 *
 * DE ONDE VEM A TABELA
 *   - A lista: docs/business/FLUXO-OFICIAL-STATUS-PROPOSTAS.md §3 (21 status,
 *     incluindo NOVO_ARTE_APROVADA e AGUARDANDO_ARTE_APROVADA). O teste
 *     maestro-status.test.mts lê o documento e falha se a lista daqui divergir.
 *   - O rótulo: `humanizeStatus`, o formatador que TODO StatusBadge do Vibe
 *     aplica. Não há segunda tabela de rótulos aqui — mudou na tela, mudou aqui.
 *   - O sufixo " / EM ARTE": `composeStatusEmArte`, a mesma função das telas.
 *
 * Funções puras — sem banco, sem modelo. Quem aplica é o loop.
 */
import { humanizeStatus } from '@/lib/formatters/status';
import { composeStatusEmArte } from '@/features/orcamentos/mappers';

/** FLUXO-OFICIAL-STATUS-PROPOSTAS.md §3, na ordem do documento. */
export const STATUS_OFICIAIS = [
  'NOVO',
  'NOVO / EM ARTE',
  'NOVO_ARTE_APROVADA',
  'AGUARDANDO',
  'AGUARDANDO / EM ARTE',
  'AGUARDANDO_ARTE_APROVADA',
  'AGUARDANDO / PENDENTE',
  'LIBERADO',
  'LIBERADO / EM ARTE',
  'CANCELADO',
  'REVISAO ATENDENTE',
  'REVISAO PRODUCAO',
  'EM PRODUCAO',
  'EM IMPRESSAO',
  'EM IMPRESSAO / PENDENTE',
  'EM ACABAMENTO',
  'EM ACABAMENTO / PENDENTE',
  'EXPEDICAO',
  'A RETIRAR',
  'EM TRANSITO',
  'ENTREGUE',
] as const;

/**
 * Fora da lista oficial, mas gravados em `status_interno` (§8.3 do documento):
 * APROVADO é o valor que o trigger financeiro escreve; RECEBIDO está na guarda
 * de etapa. Existem no banco, então o Maestro precisa reconhecê-los.
 */
export const STATUS_LEGADOS = ['APROVADO', 'RECEBIDO'] as const;

export interface LinhaDaTabelaDeStatus {
  status: string;
  /** Como as telas do Vibe mostram esse status. */
  rotulo: string;
  oficial: boolean;
}

/** Rótulo de exibição: o mesmo formatador do StatusBadge. Desconhecido → o próprio valor. */
export function rotuloDoStatus(status: string): string {
  return humanizeStatus(status);
}

export const TABELA_DE_STATUS: readonly LinhaDaTabelaDeStatus[] = [
  ...STATUS_OFICIAIS.map(status => ({ status, rotulo: rotuloDoStatus(status), oficial: true })),
  ...STATUS_LEGADOS.map(status => ({ status, rotulo: rotuloDoStatus(status), oficial: false })),
];

/**
 * O status como a tela mostra: `status_interno` com o sufixo " / EM ARTE" quando
 * `em_arte` está ligado, e o rótulo de exibição desse valor.
 */
export function statusDoPedidoParaExibir(
  statusInterno: string | null | undefined,
  emArte: boolean,
): { status: string | null; rotulo: string | null } {
  const cru = String(statusInterno ?? '').trim();
  if (!cru) return { status: null, rotulo: null };
  const status = composeStatusEmArte(cru, emArte);
  return { status, rotulo: rotuloDoStatus(status) };
}

/** Linha para o prompt: a lista oficial com o rótulo de tela quando ele difere. */
export function listaDeStatusParaOPrompt(): string {
  return TABELA_DE_STATUS.filter(l => l.oficial)
    .map(l => (normalizarStatus(l.rotulo) === normalizarStatus(l.status) ? l.status : `${l.status} (na tela: ${l.rotulo})`))
    .join(' · ');
}

// ─── Comparação ──────────────────────────────────────────────────────────────

/** Maiúsculas, sem acento, CARACTERE A CARACTERE (mesmo comprimento do original). */
function aplanar(texto: string): string {
  let s = '';
  for (const c of texto) {
    const base = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    s += c.length === 1 ? (base[0] ?? c) : c; // par substituto (emoji) fica como está
  }
  return s;
}

/** Forma de comparação: maiúsculas, sem acento, sem marcação, barra e espaços padronizados. */
export function normalizarStatus(texto: string): string {
  return aplanar(texto)
    .replace(/[*`"“”']/g, '')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface TermoDoVocabulario {
  /** Como aparece no texto aplanado, com espaços flexíveis. */
  re: RegExp;
  termo: string;
  /** Uma palavra só e comum na fala ("aguardando", "novo"): fora de rótulo, só vale em MAIÚSCULAS. */
  ambiguo: boolean;
}

function regexDoTermo(termo: string): RegExp {
  const corpo = termo
    .split(' / ')
    .map(parte => parte.split(' ').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'))
    .join('\\s*/\\s*');
  // Colado no início; depois não pode continuar a palavra nem emendar outro sufixo.
  return new RegExp(`^${corpo}(?![A-Z0-9_])`);
}

/** Status crus e rótulos, do mais longo para o mais curto (o mais específico ganha). */
const VOCABULARIO: readonly TermoDoVocabulario[] = (() => {
  const termos = new Set<string>();
  for (const l of TABELA_DE_STATUS) {
    termos.add(normalizarStatus(l.status));
    termos.add(normalizarStatus(l.rotulo));
  }
  return [...termos]
    .sort((a, b) => b.length - a.length)
    .map(termo => ({ re: regexDoTermo(termo), termo, ambiguo: !/[ _/]/.test(termo) }));
})();

const TERMOS_DO_VOCABULARIO: ReadonlySet<string> = new Set(VOCABULARIO.map(v => v.termo));

/** Termo de status que começa exatamente em `pos` do texto aplanado. */
function termoEm(plano: string, pos: number): { termo: string; fim: number; ambiguo: boolean } | null {
  const resto = plano.slice(pos, pos + 60);
  for (const v of VOCABULARIO) {
    const m = v.re.exec(resto);
    if (m) return { termo: v.termo, fim: pos + m[0].length, ambiguo: v.ambiguo };
  }
  return null;
}

// ─── O que a consulta devolveu ───────────────────────────────────────────────

export interface StatusConsultados {
  /** Todo texto curto que as consultas desta pergunta devolveram (normalizado), mais o rótulo de cada status. */
  aceitos: Set<string>;
  /** Status da tabela encontrados nas consultas — sem nenhum, a trava não se aplica. */
  daTabela: Set<string>;
}

export function novoStatusConsultados(): StatusConsultados {
  return { aceitos: new Set(), daTabela: new Set() };
}

/**
 * Guarda os valores de texto (e as chaves, para contagens por status) do
 * resultado de uma ferramenta. Status da tabela entra com o valor cru E o rótulo.
 */
export function coletarStatusDaConsulta(resultado: unknown, destino: StatusConsultados, profundidade = 0): void {
  if (resultado == null || profundidade > 12) return;
  const anotar = (texto: string) => {
    if (texto.length < 2 || texto.length > 80) return;
    const n = normalizarStatus(texto);
    if (!n) return;
    destino.aceitos.add(n);
    if (TERMOS_DO_VOCABULARIO.has(n)) {
      destino.daTabela.add(n);
      destino.aceitos.add(normalizarStatus(rotuloDoStatus(texto.trim())));
      // O rótulo devolvido também libera o valor cru correspondente.
      for (const l of TABELA_DE_STATUS) {
        if (normalizarStatus(l.rotulo) === n) destino.aceitos.add(normalizarStatus(l.status));
      }
    }
  };
  if (typeof resultado === 'string') return anotar(resultado);
  if (Array.isArray(resultado)) {
    for (const item of resultado) coletarStatusDaConsulta(item, destino, profundidade + 1);
    return;
  }
  if (typeof resultado === 'object') {
    for (const [chave, valor] of Object.entries(resultado as Record<string, unknown>)) {
      anotar(chave);
      coletarStatusDaConsulta(valor, destino, profundidade + 1);
    }
  }
}

// ─── O que a resposta declara ────────────────────────────────────────────────

export interface StatusDeclarado {
  /** O termo de status reconhecido (normalizado) ou, na paráfrase, o valor escrito. */
  termo: string;
  /** Como está escrito na resposta. */
  escrito: string;
  /** Trecho a trocar na correção: [inicio, fim) no texto original. */
  inicio: number;
  fim: number;
  /** Valor inteiro depois do rótulo (normalizado) — para aceitar texto devolvido pela consulta. */
  valorInteiro: string;
  forma: 'rotulo' | 'frase' | 'esta';
  /** Não é um status da tabela: é uma reescrita ("Revisão da produção"). */
  parafrase: boolean;
}

/** "Status:" ou "Situação:" do PEDIDO (não "Situação financeira:", "Status da cobrança:"). */
const ROTULO =
  /(STATUS|SITUACAO)(?:[ \t]+(?:DO[ \t]+PEDIDO|DA[ \t]+PROPOSTA|ATUAL|INTERNO|GERAL))*[ \t]*[*_]*[ \t]*[:=][ \t]*[*_"“'`]*[ \t]*/g;

/** A linha, antes do rótulo, fala de outra coisa: o status é dela, não do pedido. */
const ROTULO_DE_OUTRA_COISA =
  /COBRANCA|PAGAMENTO|BOLETO|TITULO|PARCELA|\bPIX\b|NOTA|\bNF|\bARTE|SETOR|\bOS\b|ORDEM|PRODUCAO|EXPEDICAO|RASTREIO|ENTREGA|TAREFA|FRETE|\bPVC\b|LASER|FLEXO|TEXTIL/;

/** "com o status AGUARDANDO", "o status é X", "status atual X". */
const FRASE = /\bSTATUS[ \t]+(?:(?:DO[ \t]+PEDIDO|ATUAL|INTERNO)[ \t]+)*(?:E[ \t]+)?[*_"“'`]*/g;

/** "o pedido está EM PRODUÇÃO", "está em REVISAO PRODUCAO", "está com o status X". */
const ESTA = /\bESTAO?[ \t]+(?:(?:ATUALMENTE|AGORA|HOJE|AINDA|JA)[ \t]+)*(?:COMO[ \t]+)?[*_"“'`]*/g;

/** Começo de valor que tem cara de status reescrito ("Revisão da produção", "Pronto para retirada"). */
const CARA_DE_STATUS =
  /^(?:(?:EM|NA|NO)[ \t]+(?:REVIS|PRODU|IMPRESS|ACABAM|EXPED|TRANSIT|ARTE|FILA)|REVIS|PRODU|IMPRESS|ACABAM|EXPED|TRANSIT|ENTREG|RETIR|PRONT|FINALIZ|CONCLU|LIBERAD|APROVAD)/;

/** Antes do status, a frase fala de cobrança, boleto, nota, setor…: o status é dessa outra coisa. */
const FRASE_DE_OUTRA_COISA =
  /COBRANCA|PAGAMENTO|BOLETO|TITULO|PARCELA|\bPIX\b|NOTA|\bNF|\bARTE|SETOR|\bOS\b|ORDEM|RASTREIO|TAREFA|\bPVC\b|LASER|FLEXO|TEXTIL/;

const FIM_DO_VALOR = /\n|\(|\)|[.;,|]|[ \t][—–-][ \t]|\*\*|__/;

/**
 * Status que a resposta DECLARA como o do pedido. Não pega a palavra solta no
 * meio da frase ("aguardando a conferência", "liberado para produção"): só
 * depois de "Status:"/"Situação:", de "status …" ou de "está …".
 */
export function extrairStatusDeclarados(texto: string): StatusDeclarado[] {
  const plano = aplanar(texto);
  const achados: StatusDeclarado[] = [];
  const vistos = new Set<number>();
  const valorAte = (pos: number) => {
    const resto = plano.slice(pos, pos + 120);
    const corte = FIM_DO_VALOR.exec(resto);
    return normalizarStatus(corte ? resto.slice(0, corte.index) : resto);
  };
  const falaDeOutraCoisa = (pos: number) => {
    const linha = plano.slice(plano.lastIndexOf('\n', pos - 1) + 1, pos);
    const frase = linha.slice(Math.max(linha.lastIndexOf('. '), linha.lastIndexOf('; '), linha.lastIndexOf(': ')) + 1);
    return FRASE_DE_OUTRA_COISA.test(frase);
  };
  const anotar = (d: StatusDeclarado) => {
    if (vistos.has(d.inicio)) return;
    vistos.add(d.inicio);
    achados.push(d);
  };

  // 1. Depois de "Status:" / "Situação:".
  ROTULO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ROTULO.exec(plano)) !== null) {
    const inicioDaLinha = plano.lastIndexOf('\n', m.index - 1) + 1;
    const antes = plano.slice(inicioDaLinha, m.index);
    if (/[A-Z0-9]$/.test(antes)) continue; // "SUBSTATUS:", "status_x"
    if (ROTULO_DE_OUTRA_COISA.test(antes)) continue;
    const pos = m.index + m[0].length;
    const valorInteiro = valorAte(pos);
    const t = termoEm(plano, pos);
    if (t) {
      anotar({ termo: t.termo, escrito: texto.slice(pos, t.fim), inicio: pos, fim: t.fim, valorInteiro, forma: 'rotulo', parafrase: false });
    } else if (m[1] === 'STATUS' && valorInteiro && CARA_DE_STATUS.test(valorInteiro)) {
      // "Status: Revisão da produção" — não é da tabela, mas é um status reescrito.
      const resto = plano.slice(pos, pos + 120);
      const corte = FIM_DO_VALOR.exec(resto);
      const fim = pos + (corte ? corte.index : resto.length);
      const fimSemEspaco = pos + plano.slice(pos, fim).trimEnd().length;
      anotar({ termo: valorInteiro, escrito: texto.slice(pos, fimSemEspaco), inicio: pos, fim: fimSemEspaco, valorInteiro, forma: 'rotulo', parafrase: true });
    }
  }

  // 2. "com o status X", "o status é X".
  FRASE.lastIndex = 0;
  while ((m = FRASE.exec(plano)) !== null) {
    const pos = m.index + m[0].length;
    const t = termoEm(plano, pos);
    if (!t || falaDeOutraCoisa(m.index)) continue;
    anotar({ termo: t.termo, escrito: texto.slice(pos, t.fim), inicio: pos, fim: t.fim, valorInteiro: valorAte(pos), forma: 'frase', parafrase: false });
  }

  // 3. "está X" — palavra única e comum só conta em MAIÚSCULAS.
  ESTA.lastIndex = 0;
  while ((m = ESTA.exec(plano)) !== null) {
    if (falaDeOutraCoisa(m.index)) continue;
    const aposEsta = m.index + m[0].length;
    let pos = aposEsta;
    let t = termoEm(plano, pos);
    if (!t) {
      // "está em REVISAO PRODUCAO", "está na EXPEDICAO"
      const conectivo = /^(?:EM|NA|NO)[ \t]+[*_"“'`]*/.exec(plano.slice(pos, pos + 12));
      if (!conectivo) continue;
      pos += conectivo[0].length;
      t = termoEm(plano, pos);
      if (!t) continue;
    }
    const escrito = texto.slice(pos, t.fim);
    const emMaiusculas = escrito === escrito.toUpperCase() && /[A-ZÀ-Ú]/.test(escrito);
    if (t.ambiguo && !emMaiusculas) continue; // "está aguardando a conferência", "está liberado para produção"
    // A correção reescreve "está <...>" inteiro: "está com o status X".
    anotar({ termo: t.termo, escrito, inicio: aposEsta, fim: t.fim, valorInteiro: valorAte(pos), forma: 'esta', parafrase: false });
  }

  return achados.sort((a, b) => a.inicio - b.inicio);
}

/** O valor declarado bate com algo que a consulta devolveu? */
function bateComAConsulta(d: StatusDeclarado, consultados: StatusConsultados): boolean {
  if (consultados.aceitos.has(d.termo)) return true;
  if (consultados.aceitos.has(d.valorInteiro)) return true;
  // Texto devolvido pela consulta e seguido de complemento ("Aguardando pagamento do cliente").
  for (const aceito of consultados.aceitos) {
    if (aceito.length < 6 || TERMOS_DO_VOCABULARIO.has(aceito)) continue;
    if (d.valorInteiro.startsWith(aceito)) return true;
  }
  return false;
}

/**
 * Status declarados na resposta que NÃO batem com o que foi consultado.
 * Sem nenhum status da tabela nas consultas desta pergunta, não há o que
 * conferir (resposta conceitual, cotação, manual) e nada é apontado.
 */
export function statusForaDaConsulta(texto: string, consultados: StatusConsultados): StatusDeclarado[] {
  if (consultados.daTabela.size === 0) return [];
  return extrairStatusDeclarados(texto).filter(d => !bateComAConsulta(d, consultados));
}

// ─── Correção ────────────────────────────────────────────────────────────────

export interface StatusDoPedidoConsultado {
  numero: string;
  status: string;
  rotulo: string;
}

function descreverConsultados(pedidos: readonly StatusDoPedidoConsultado[], consultados: StatusConsultados): string {
  if (pedidos.length > 0) {
    return pedidos
      .map(p => `pedido ${p.numero} = ${p.status}${normalizarStatus(p.rotulo) !== normalizarStatus(p.status) ? ` (na tela: ${p.rotulo})` : ''}`)
      .join('; ');
  }
  return [...consultados.daTabela].join(', ');
}

export function correcaoDeStatus(
  errados: readonly StatusDeclarado[],
  pedidos: readonly StatusDoPedidoConsultado[],
  consultados: StatusConsultados,
): string {
  const escritos = [...new Set(errados.map(e => `"${e.escrito.trim()}"`))].join(', ');
  return (
    `CORREÇÃO OBRIGATÓRIA: a sua resposta informa o status ${escritos}, que NÃO é o que a consulta devolveu. ` +
    `Status consultado nesta pergunta: ${descreverConsultados(pedidos, consultados)}. ` +
    'Reescreva a resposta informando o status EXATAMENTE como está no campo "status" da consulta (ou pelo "status_na_tela"). ' +
    'Não traduza, não resuma e não troque por outro nome: "EM PRODUCAO" é um status diferente de "REVISAO PRODUCAO". ' +
    'Estar na fila de produção é outro dado da consulta e se diz "está na fila de produção", sem mudar o status. ' +
    'Não é preciso consultar de novo.'
  );
}

export interface CorrecaoAplicada {
  texto: string;
  /** Trechos trocados pelo rótulo consultado. */
  trocas: number;
  /** Sobrou status sem conferir (vários pedidos, ou sem pedido): entrou o aviso no fim. */
  aviso: boolean;
}

/**
 * Defesa final, sem o modelo: troca o status errado pelo consultado.
 * Com UM pedido consultado, troca no lugar. Com vários (não dá para saber de
 * qual a frase fala) ou sem pedido, acrescenta o aviso com o status certo.
 */
export function corrigirStatusNaResposta(
  texto: string,
  pedidos: readonly StatusDoPedidoConsultado[],
  consultados: StatusConsultados,
): CorrecaoAplicada {
  let saida = texto;
  let trocas = 0;
  if (pedidos.length === 1) {
    const certo = pedidos[0].rotulo || pedidos[0].status;
    const errados = statusForaDaConsulta(saida, consultados).sort((a, b) => b.inicio - a.inicio); // de trás para frente
    for (const e of errados) {
      const novo = e.forma === 'esta' ? `com o status ${certo}` : certo;
      saida = saida.slice(0, e.inicio) + novo + saida.slice(e.fim);
      trocas++;
    }
  }
  const sobrou = statusForaDaConsulta(saida, consultados);
  if (sobrou.length === 0) return { texto: saida, trocas, aviso: false };
  const escritos = [...new Set(sobrou.map(e => `"${e.escrito.trim()}"`))].join(', ');
  return {
    texto: `${saida}\n\n⚠️ O status ${escritos} citado acima não confere com a consulta. Status no Vibe: ${descreverConsultados(pedidos, consultados)}.`,
    trocas,
    aviso: true,
  };
}
