/**
 * maestro-agent-status.ts
 *
 * Status do pedido na resposta do Maestro: exatamente como veio da consulta, ou
 * pelo rótulo que a lista de Propostas mostra para aquele status. Nunca reescrito.
 *
 * POR QUE EXISTE
 *   Um status trocado na redação ("EM PRODUCAO" no lugar de "REVISAO PRODUCAO")
 *   é outro status da lista oficial: a resposta fica errada com cara de certa.
 *   (O caso de 02/10/2026 que motivou a trava foi alarme falso: o pedido 23071
 *   tinha mudado de status minutos antes e a resposta estava certa.)
 *
 * DE ONDE VEM A TABELA
 *   - A lista: docs/business/FLUXO-OFICIAL-STATUS-PROPOSTAS.md §3 (21 status,
 *     incluindo NOVO_ARTE_APROVADA e AGUARDANDO_ARTE_APROVADA). O teste
 *     maestro-status.test.mts lê o documento e falha se a lista daqui divergir.
 *   - O rótulo: o da LISTA DE PROPOSTAS — `getStatusLabel` (orcamentos/mappers)
 *     seguido de `humanizeStatus` (o formatador do StatusBadge), exatamente o
 *     que a lista faz. Não há segunda tabela de rótulos aqui.
 *   - O sufixo " / EM ARTE": `composeStatusEmArte`, a mesma função das telas.
 *
 * STATUS EXIBIDO COMO OUTRO (decisão do dono, 02/10/2026)
 *   Na lista de Propostas, APROVADO aparece como "Liberado" (é o legado de
 *   LIBERADO, sem relação com arte) e os três "/ PENDENTE" aparecem como
 *   "Aguardando". O Maestro mostra igual: para esses, vale SÓ o rótulo — o valor
 *   cru escrito na resposta é trocado pelo rótulo.
 *
 * Funções puras — sem banco, sem modelo. Quem aplica é o loop.
 */
import { humanizeStatus } from '@/lib/formatters/status';
import { composeStatusEmArte, getStatusLabel } from '@/features/orcamentos/mappers';

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
  /** Como a lista de Propostas mostra esse status. */
  rotulo: string;
  oficial: boolean;
  /**
   * O rótulo é o nome de OUTRO status da lista (APROVADO → "Liberado",
   * "EM IMPRESSAO / PENDENTE" → "Aguardando"). Para estes o Maestro mostra só o
   * rótulo, nunca o valor cru.
   */
  exibidoComoOutro: boolean;
}

/** Rótulo de exibição: o que a lista de Propostas mostra. Desconhecido → o próprio valor. */
export function rotuloDoStatus(status: string): string {
  return humanizeStatus(getStatusLabel(status));
}

export const TABELA_DE_STATUS: readonly LinhaDaTabelaDeStatus[] = (() => {
  const linhas = [
    ...STATUS_OFICIAIS.map(status => ({ status: status as string, rotulo: rotuloDoStatus(status), oficial: true })),
    ...STATUS_LEGADOS.map(status => ({ status: status as string, rotulo: rotuloDoStatus(status), oficial: false })),
  ];
  const crus = new Set(linhas.map(l => normalizarStatus(l.status)));
  return linhas.map(l => {
    const rotulo = normalizarStatus(l.rotulo);
    return { ...l, exibidoComoOutro: rotulo !== normalizarStatus(l.status) && crus.has(rotulo) };
  });
})();

/** O que o rótulo sozinho não diz — vai junto do status para a resposta não enganar. */
const OBSERVACAO_DO_STATUS: Record<string, string> = {
  'AGUARDANDO / PENDENTE':
    'Além da condição financeira em aberto, há pendência operacional registrada neste pedido. Diga isso ao informar o status.',
  'EM IMPRESSAO / PENDENTE':
    'O status aparece como "Aguardando", mas NÃO é falta de pagamento: o pedido está na produção, com a IMPRESSÃO em pausa por pendência. Diga isso ao informar o status.',
  'EM ACABAMENTO / PENDENTE':
    'O status aparece como "Aguardando", mas NÃO é falta de pagamento: o pedido está na produção, com o ACABAMENTO em pausa por pendência. Diga isso ao informar o status.',
};

/**
 * O status como a lista de Propostas mostra: `status_interno` com o sufixo
 * " / EM ARTE" quando `em_arte` está ligado, e o rótulo de exibição desse valor.
 * Status exibido como outro (APROVADO, "/ PENDENTE") sai JÁ com o rótulo em
 * `status`: o valor cru não chega ao modelo.
 */
export function statusDoPedidoParaExibir(
  statusInterno: string | null | undefined,
  emArte: boolean,
): { status: string | null; rotulo: string | null; observacao: string | null } {
  const cru = String(statusInterno ?? '').trim();
  if (!cru) return { status: null, rotulo: null, observacao: null };
  const composto = composeStatusEmArte(cru, emArte);
  const rotulo = rotuloDoStatus(composto);
  const chave = normalizarStatus(composto);
  const linha = TABELA_DE_STATUS.find(l => normalizarStatus(l.status) === chave);
  return {
    status: linha?.exibidoComoOutro ? rotulo : composto,
    rotulo,
    observacao: OBSERVACAO_DO_STATUS[chave] ?? null,
  };
}

/** Mapa de contagem ou soma por status ("contagem_por_status_interno", "soma_por_status"). */
const MAPA_POR_STATUS = /^(?:contagem|soma)(?:_valor)?_por_status(?:_interno)?$/;

/**
 * Aplica o rótulo de tela ao resultado de QUALQUER ferramenta, antes de ele
 * chegar ao modelo: `status_interno` com valor exibido como outro (APROVADO,
 * "/ PENDENTE") vira o rótulo, e os mapas por status somam a linha na do
 * rótulo ({APROVADO: 10, LIBERADO: 3} → {LIBERADO: 13}), como a lista de
 * Propostas mostra. Sem isto o valor cru chegava ao modelo e cada resposta de
 * lista gastava uma rodada de correção — APROVADO é o status mais comum do banco.
 * Devolve uma cópia; não altera o original.
 */
export function aplicarRotulosDeTela(resultado: unknown, profundidade = 0): unknown {
  if (resultado == null || typeof resultado !== 'object' || profundidade > 12) return resultado;
  if (Array.isArray(resultado)) return resultado.map(item => aplicarRotulosDeTela(item, profundidade + 1));
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(resultado as Record<string, unknown>)) {
    if ((chave === 'status_interno' || chave === 'statusInterno') && typeof valor === 'string') {
      const linha = TABELA_DE_STATUS.find(l => l.exibidoComoOutro && normalizarStatus(l.status) === normalizarStatus(valor));
      saida[chave] = linha ? linha.rotulo : valor;
    } else if (MAPA_POR_STATUS.test(chave) && valor && typeof valor === 'object' && !Array.isArray(valor)) {
      saida[chave] = juntarPorRotulo(valor as Record<string, unknown>);
    } else {
      saida[chave] = aplicarRotulosDeTela(valor, profundidade + 1);
    }
  }
  return saida;
}

function juntarPorRotulo(mapa: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  const comOutroRotulo: Array<[LinhaDaTabelaDeStatus, unknown]> = [];
  for (const [status, valor] of Object.entries(mapa)) {
    const linha = TABELA_DE_STATUS.find(l => l.exibidoComoOutro && normalizarStatus(l.status) === normalizarStatus(status));
    if (linha) comOutroRotulo.push([linha, valor]);
    else saida[status] = valor;
  }
  for (const [linha, valor] of comOutroRotulo) {
    const alvo = Object.keys(saida).find(k => normalizarStatus(k) === normalizarStatus(linha.rotulo)) ?? linha.rotulo;
    const atual = saida[alvo];
    if (atual === undefined) saida[alvo] = valor;
    else if (typeof atual === 'number' && typeof valor === 'number') saida[alvo] = Math.round((atual + valor) * 100) / 100;
    else saida[linha.status] = valor; // não dá para somar: mantém a linha como veio
  }
  return saida;
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

/** Linha da tabela pelo valor cru normalizado. */
const LINHA_POR_STATUS: ReadonlyMap<string, LinhaDaTabelaDeStatus> = new Map(
  TABELA_DE_STATUS.map(l => [normalizarStatus(l.status), l]),
);

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

/** Bloco do resultado que fala de outra coisa (o "status" ali é do setor, do título, da nota…). */
const BLOCO_DE_OUTRA_COISA = /^(?:setores|ordens_de_servico|titulos|nota_fiscal|notas|expedicoes|tarefas|artes|pagamentos|boletos|parcelas)$/;
/** Campo que não é o status do pedido, mesmo fora desses blocos. */
const CAMPO_DE_OUTRA_COISA = /^status_(?:d[aoe]_)?(?:arte|pagamento|producao|expedicao)$/;

/**
 * Guarda os valores de texto (e as chaves, para contagens por status) do
 * resultado de uma ferramenta.
 *   - Status do pedido da tabela entra com o valor cru E o rótulo.
 *   - Status exibido como outro (APROVADO, "/ PENDENTE") entra SÓ com o rótulo.
 *   - Texto de outro bloco (setor, título, nota, arte) entra como texto comum:
 *     não vira status do pedido.
 */
export function coletarStatusDaConsulta(resultado: unknown, destino: StatusConsultados, deOutraCoisa = false, profundidade = 0): void {
  if (resultado == null || profundidade > 12) return;
  const anotar = (texto: string, outra: boolean) => {
    if (texto.length < 2 || texto.length > 80) return;
    const n = normalizarStatus(texto);
    if (!n) return;
    if (outra || !TERMOS_DO_VOCABULARIO.has(n)) {
      destino.aceitos.add(n);
      return;
    }
    destino.daTabela.add(n);
    const linha = LINHA_POR_STATUS.get(n);
    if (linha?.exibidoComoOutro) {
      destino.aceitos.add(normalizarStatus(linha.rotulo)); // só o rótulo; o cru não vale
      return;
    }
    destino.aceitos.add(n);
    if (linha) destino.aceitos.add(normalizarStatus(linha.rotulo));
    // O rótulo devolvido também libera o valor cru correspondente (EXPEDICAO ↔ Na Expedição).
    for (const l of TABELA_DE_STATUS) {
      if (!l.exibidoComoOutro && normalizarStatus(l.rotulo) === n) destino.aceitos.add(normalizarStatus(l.status));
    }
  };
  if (typeof resultado === 'string') return anotar(resultado, deOutraCoisa);
  if (Array.isArray(resultado)) {
    for (const item of resultado) coletarStatusDaConsulta(item, destino, deOutraCoisa, profundidade + 1);
    return;
  }
  if (typeof resultado === 'object') {
    for (const [chave, valor] of Object.entries(resultado as Record<string, unknown>)) {
      anotar(chave, deOutraCoisa);
      const outra =
        deOutraCoisa ||
        BLOCO_DE_OUTRA_COISA.test(chave) ||
        CAMPO_DE_OUTRA_COISA.test(chave) ||
        (chave === 'cobrancas' && Array.isArray(valor)); // a lista de cobranças, não a parte "cobrancas"
      coletarStatusDaConsulta(valor, destino, outra, profundidade + 1);
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
  /** Valor cru que a tela mostra com outro rótulo, e a consulta trouxe esse rótulo: troca direta. */
  trocarPor?: string;
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
  /COBRANCA|PAGAMENTO|BOLETO|TITULO|PARCELA|\bPIX\b|NOTA|\bNF|\bARTE|SETOR|\bOS\b|ORDEM|RASTREIO|TAREFA|CREDITO|CADASTRO|\bPVC\b|LASER|FLEXO|TEXTIL/;

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
  const fora: StatusDeclarado[] = [];
  for (const d of extrairStatusDeclarados(texto)) {
    const linha = LINHA_POR_STATUS.get(d.termo);
    if (linha?.exibidoComoOutro) {
      // "APROVADO" escrito cru: a tela mostra "Liberado". Se foi esse o rótulo
      // consultado, a troca é direta; senão é só um status que não bate.
      const consultouORotulo = consultados.aceitos.has(normalizarStatus(linha.rotulo));
      fora.push(consultouORotulo ? { ...d, trocarPor: linha.rotulo } : d);
      continue;
    }
    if (!bateComAConsulta(d, consultados)) fora.push(d);
  }
  return fora;
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
  return [...new Set([...consultados.daTabela].map(s => {
    const linha = LINHA_POR_STATUS.get(s);
    return linha?.exibidoComoOutro ? linha.rotulo : s;
  }))].join(', ');
}

export function correcaoDeStatus(
  errados: readonly StatusDeclarado[],
  pedidos: readonly StatusDoPedidoConsultado[],
  consultados: StatusConsultados,
): string {
  const outros = errados.filter(e => !e.trocarPor);
  const comRotulo = errados.filter(e => e.trocarPor);
  const partes: string[] = ['CORREÇÃO OBRIGATÓRIA:'];
  if (outros.length > 0) {
    const escritos = [...new Set(outros.map(e => `"${e.escrito.trim()}"`))].join(', ');
    partes.push(`a sua resposta informa o status ${escritos}, que NÃO é o que a consulta devolveu.`);
  }
  for (const frase of new Set(comRotulo.map(e => `o status "${e.escrito.trim()}" aparece nas telas do Vibe como "${e.trocarPor}": escreva "${e.trocarPor}".`))) {
    partes.push(frase);
  }
  return (
    `${partes.join(' ')} ` +
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
  // Valor cru que a tela mostra com outro rótulo: a troca não depende de qual
  // pedido a frase fala, então vale mesmo com vários pedidos.
  for (const e of statusForaDaConsulta(saida, consultados).filter(x => x.trocarPor).sort((a, b) => b.inicio - a.inicio)) {
    const novo = e.forma === 'esta' ? `com o status ${e.trocarPor}` : String(e.trocarPor);
    saida = saida.slice(0, e.inicio) + novo + saida.slice(e.fim);
    trocas++;
  }
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
