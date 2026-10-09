/**
 * ACOMPANHAR PEDIDO (Fase 7): regras puras da aba Fretes.
 *
 * Acompanhar liga pedidos que SO SAEM da Expedicao juntos; cada um segue com o
 * seu proprio despacho, etiqueta e cobranca. NAO ha vinculo financeiro nem
 * divisao de frete: nenhuma funcao de frete, cobranca ou valor le este vinculo.
 *
 * O vinculo mora em `pedidos_vinculos` (tipo ACOMPANHAR) e e escrito so pelas
 * funcoes `vincular_pedidos` e `soltar_pedido_vinculo`, chamadas pela rota
 * `/api/orcamentos/acompanhar` com a sessao de quem clicou. Aqui ficam as
 * decisoes que nao dependem do banco: quem e candidato, quando e so leitura,
 * o que mudou no seletor e como traduzir a recusa.
 */
/** Candidatos mostrados de uma vez (a busca por numero acha qualquer elegivel). */
export const TETO_CANDIDATOS = 10;
/** Pedidos por grupo. */
export const TETO_GRUPO = 10;

/**
 * Status em que o pedido JA NAO esta em aberto: cancelado ou ja despachado. O vinculo
 * pode ser criado desde o NOVO, antes de o pedido chegar a Expedicao (o funil
 * APROVADO..EXPEDICAO era estreito demais). A lista do banco, em `vincular_pedidos`,
 * recusa exatamente estes.
 */
export const STATUS_FORA_DE_ABERTO: readonly string[] = [
  "CANCELADO",
  "CANCELADA",
  "A RETIRAR",
  "EM TRANSITO",
  "ENTREGUE",
  "RECEBIDO"
];

export type SituacaoDoPedido = { statusInterno: string; despachado: boolean; avulso: boolean; encerradoTeste: boolean };

/**
 * A UNICA definicao de "em aberto" para o Acompanhar: nao cancelado, sem
 * despacho, status fora de A RETIRAR/EM TRANSITO/ENTREGUE/RECEBIDO, nao avulso,
 * sem teste encerrado. Devolve o motivo REAL de nao estar em aberto, ou null.
 * Card, rota e candidatos usam so esta funcao.
 */
export function motivoDeNaoEstarEmAberto(p: SituacaoDoPedido): string | null {
  const st = (p.statusInterno || "").toUpperCase();
  if (st === "CANCELADO" || st === "CANCELADA") return "Pedido cancelado.";
  if (p.despachado || STATUS_FORA_DE_ABERTO.includes(st)) return "Pedido já despachado.";
  if (p.avulso) return "Pedido avulso não vai para a Expedição.";
  if (p.encerradoTeste) return "Pedido de teste encerrado.";
  return null;
}

/** Pedido em grupo que ainda nao chegou a Expedicao: o grupo so despacha quando todos chegarem. */
export function aindaNaoChegouAExpedicao(statusInterno: string): boolean {
  return (statusInterno || "").toUpperCase() !== "EXPEDICAO";
}

export const AVISO_AINDA_NAO_CHEGOU =
  "Este pedido ainda não chegou à Expedição: o grupo só despacha quando todos chegarem. Para soltar: peça a um administrador da Expedição.";

export type PedidoReferencia = {
  idInt: number;
  idCliente: number | null;
  idFaturado: number | null;
};

export type PedidoParaAcompanhar = PedidoReferencia & {
  cliente: string;
  statusInterno: string;
  criadoEm: string | null;
  avulso: boolean;
  encerradoTeste: boolean;
  despachado: boolean;
  /** Grupo ACOMPANHAR ativo em que o pedido ja esta, e quem esta nele. */
  grupoAcompanhar: { grupoId: string; membros: number[] } | null;
};

export type CandidatoAcompanhar = {
  idInt: number;
  cliente: string;
  statusInterno: string;
  criadoEm: string | null;
  desabilitado: boolean;
  motivo: string | null;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Mesmo cliente OU mesmo socio pagador (id_faturado igual e nao nulo). */
export function mesmoClienteOuPagador(a: PedidoReferencia, b: PedidoReferencia): boolean {
  const clienteIgual = a.idCliente !== null && b.idCliente !== null && a.idCliente === b.idCliente;
  const pagadorIgual = a.idFaturado !== null && b.idFaturado !== null && a.idFaturado === b.idFaturado;
  return clienteIgual || pagadorIgual;
}

/**
 * Pode entrar no grupo? Em aberto (`motivoDeNaoEstarEmAberto`), do mesmo cliente
 * ou pagador, e diferente do proprio pedido. Cliente/pagador tambem e conferido
 * no banco; aqui evita a ida e volta.
 */
export function podeSerCandidato(p: PedidoParaAcompanhar, ref: PedidoReferencia): boolean {
  if (p.idInt === ref.idInt) return false;
  if (!mesmoClienteOuPagador(ref, p)) return false;
  return motivoDeNaoEstarEmAberto(p) === null;
}

function listaDe(ids: readonly number[]): string {
  return ids.map((i) => `#${i}`).join(", ");
}

/**
 * Candidatos para o seletor. Quem ja esta em OUTRO grupo Acompanhar aparece
 * desabilitado, com o motivo. `busca` e o numero (ou parte) do pedido. O teto
 * vale depois da busca, do mais novo para o mais antigo.
 */
export function montarCandidatos(
  pedidos: readonly PedidoParaAcompanhar[],
  ref: PedidoReferencia,
  grupoAtual: string | null,
  busca?: string
): CandidatoAcompanhar[] {
  const termo = (busca ?? "").replace(/\D/g, "");
  return pedidos
    .filter((p) => podeSerCandidato(p, ref))
    .filter((p) => (termo ? String(p.idInt).includes(termo) : true))
    .sort((a, b) => b.idInt - a.idInt)
    .slice(0, TETO_CANDIDATOS)
    .map((p) => {
      const outro = p.grupoAcompanhar && p.grupoAcompanhar.grupoId !== grupoAtual ? p.grupoAcompanhar : null;
      return {
        idInt: p.idInt,
        cliente: p.cliente,
        statusInterno: p.statusInterno,
        criadoEm: p.criadoEm,
        desabilitado: Boolean(outro),
        motivo: outro ? `Já está em outro grupo Acompanhar (${listaDe(outro.membros.filter((m) => m !== p.idInt))})` : null
      };
    });
}

/**
 * Quando o checkbox e o seletor viram so leitura: o pedido editado nao esta em
 * aberto. E a MESMA definicao dos candidatos; devolve o motivo real ou null.
 */
export function motivoSomenteLeitura(p: SituacaoDoPedido): string | null {
  return motivoDeNaoEstarEmAberto(p);
}

export type MudancaDoSeletor = { vincular: number[]; soltar: number[]; erro: string | null };

/**
 * O que mudou entre o seletor antes e depois. `antes` e `depois` sao os OUTROS
 * pedidos marcados (sem o proprio). Marcar chama `vincular_pedidos` UMA vez
 * com o proprio pedido na frente; desmarcar solta aquele pedido. Vale de
 * qualquer membro: o grupo e o mesmo.
 */
export function planejarMudancaDoSeletor(antes: readonly number[], depois: readonly number[], proprio: number): MudancaDoSeletor {
  const a = new Set(antes.filter((i) => i !== proprio));
  const d = new Set(depois.filter((i) => i !== proprio));
  const vincular = [...d].filter((i) => !a.has(i)).sort((x, y) => x - y);
  const soltar = [...a].filter((i) => !d.has(i)).sort((x, y) => x - y);
  const total = d.size + 1;
  if (vincular.length > 0 && total > TETO_GRUPO) {
    return { vincular: [], soltar: [], erro: `O grupo aceita no maximo ${TETO_GRUPO} pedidos.` };
  }
  return { vincular, soltar, erro: null };
}

/** Texto do erro da rota/banco para a tela. */
export function mensagemDeErroAcompanhar(status: number, code: string | null | undefined, message: string | null | undefined): string {
  const texto = (message ?? "").trim();
  if (status === 401) return "Sessao expirada. Faca login novamente.";
  if (status === 403) {
    return code === "SOLTAR_DE_TERCEIRO"
      ? "Esta ligacao foi criada por outra pessoa. So quem a criou ou o admin da Expedicao pode soltar este pedido."
      : "Voce nao tem permissao para alterar o grupo Acompanhar (propostas.edit).";
  }
  if (texto) return texto.replace(/^VINC_[A-Z_]+:\s*/, "");
  return "Nao foi possivel atualizar o grupo Acompanhar.";
}

/**
 * Faixas de id_int para a busca por numero no servidor: todo id que COMECA pelo que foi
 * digitado (ids tem ate 7 digitos). Assim a busca alcanca qualquer candidato, nao so os
 * 10 mais recentes. Formato do filtro `or` do PostgREST.
 */
export function faixasDeBuscaPorNumero(termo: string): string[] {
  const t = termo.replace(/\D/g, "").slice(0, 9).replace(/^0+/, "");
  if (!t) return [];
  const faixas: string[] = [];
  for (let k = 0; k <= Math.max(0, 7 - t.length); k += 1) {
    const base = Number(t) * 10 ** k;
    faixas.push(`and(id_int.gte.${base},id_int.lte.${base + 10 ** k - 1})`);
  }
  return faixas;
}

/** Normaliza um membro/candidato vindo do JSON da rota. */
export function lerIds(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) {
    const n = num(x);
    if (n !== null && Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}
