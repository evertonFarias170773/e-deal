/**
 * Pedidos VINCULADOS no painel da Expedicao (Fase 5, 08/10/2026).
 *
 * Fonte: `pedidos_vinculos`, lida em lote pela funcao `vinculos_dos_pedidos`
 * (so os pedidos carregados; a consulta da lista nao muda). Aqui fica so a
 * logica pura: agrupar as linhas, decidir a cor do card e montar os textos.
 *
 * Dois tipos: COMPLEMENTO (roxo) e ACOMPANHAR (rosa). Pedido nos dois: roxo,
 * com um marcador rosa pequeno. Quem saiu do grupo nao vem da funcao, logo
 * nao aparece. "Pronto" e a regra unica do banco (`pedido_pronto_para_expedir`).
 */

export type TipoVinculo = "COMPLEMENTO" | "ACOMPANHAR";

export type MembroVinculado = {
  idInt: number;
  ordem: number;
  statusInterno: string;
  pronto: boolean;
};

export type GrupoVinculado = {
  grupoId: string;
  tipo: TipoVinculo;
  /** Os OUTROS pedidos do grupo (sem o proprio card), por ordem. */
  membros: MembroVinculado[];
};

export type DestaqueVinculo = "NENHUM" | "COMPLEMENTO" | "ACOMPANHAR" | "AMBOS";

/** Classes literais (o Tailwind precisa ve-las inteiras); todas tem modo escuro em globals.css. */
export const CLASSE_CHIP_ROXO = "border-purple-200 bg-purple-50 text-purple-700";
export const CLASSE_CHIP_ROSA = "border-rose-200 bg-rose-50 text-rose-700";
export const CLASSE_FAIXA_ROXA = "border-l-4 border-l-purple-500";
export const CLASSE_FAIXA_ROSA = "border-l-4 border-l-rose-500";

function numero(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Linhas de `vinculos_dos_pedidos` -> grupos por pedido consultado.
 * Linha malformada e ignorada; grupo sem outro membro nao entra.
 */
export function agruparVinculos(linhas: readonly unknown[] | null | undefined): Map<number, GrupoVinculado[]> {
  const porPedido = new Map<number, Map<string, GrupoVinculado>>();
  for (const bruta of linhas ?? []) {
    if (!bruta || typeof bruta !== "object") continue;
    const l = bruta as Record<string, unknown>;
    const consulta = numero(l.consulta);
    const idInt = numero(l.id_int);
    const tipo = l.tipo === "COMPLEMENTO" || l.tipo === "ACOMPANHAR" ? l.tipo : null;
    const grupoId = typeof l.grupo_id === "string" ? l.grupo_id : null;
    if (consulta === null || idInt === null || !tipo || !grupoId) continue;
    if (idInt === consulta) continue;
    const grupos = porPedido.get(consulta) ?? new Map<string, GrupoVinculado>();
    const chave = `${tipo}:${grupoId}`;
    const grupo = grupos.get(chave) ?? { grupoId, tipo, membros: [] };
    grupo.membros.push({
      idInt,
      ordem: numero(l.ordem) ?? 0,
      statusInterno: typeof l.status_interno === "string" ? l.status_interno : "",
      pronto: l.pronto === true
    });
    grupos.set(chave, grupo);
    porPedido.set(consulta, grupos);
  }
  const resultado = new Map<number, GrupoVinculado[]>();
  for (const [consulta, grupos] of porPedido) {
    const lista = [...grupos.values()]
      .map((g) => ({ ...g, membros: [...g.membros].sort((a, b) => a.ordem - b.ordem || a.idInt - b.idInt) }))
      // COMPLEMENTO primeiro: e a cor que manda no card.
      .sort((a, b) => Number(b.tipo === "COMPLEMENTO") - Number(a.tipo === "COMPLEMENTO"));
    if (lista.length > 0) resultado.set(consulta, lista);
  }
  return resultado;
}

export function destaqueDoCard(grupos: readonly GrupoVinculado[] | undefined): DestaqueVinculo {
  if (!grupos || grupos.length === 0) return "NENHUM";
  const comp = grupos.some((g) => g.tipo === "COMPLEMENTO");
  const acomp = grupos.some((g) => g.tipo === "ACOMPANHAR");
  if (comp && acomp) return "AMBOS";
  return comp ? "COMPLEMENTO" : "ACOMPANHAR";
}

/** Faixa lateral do card: roxa se ha COMPLEMENTO (inclusive nos dois), rosa se so ACOMPANHAR. */
export function classeFaixaDoCard(destaque: DestaqueVinculo): string {
  if (destaque === "COMPLEMENTO" || destaque === "AMBOS") return CLASSE_FAIXA_ROXA;
  if (destaque === "ACOMPANHAR") return CLASSE_FAIXA_ROSA;
  return "";
}

export function classeChipDoTipo(tipo: TipoVinculo): string {
  return tipo === "COMPLEMENTO" ? CLASSE_CHIP_ROXO : CLASSE_CHIP_ROSA;
}

export function rotuloDoTipo(tipo: TipoVinculo): string {
  return tipo === "COMPLEMENTO" ? "Complemento" : "Acompanhar";
}

/** Texto do chip: "Vinculados: #A · #B". */
export function textoVinculados(grupo: GrupoVinculado): string {
  return `Vinculados: ${grupo.membros.map((m) => `#${m.idInt}`).join(" · ")}`;
}

/** Dica de cada numero: status e se ja esta pronto para expedir. */
export function dicaDoMembro(membro: MembroVinculado, tipo: TipoVinculo): string {
  const status = membro.statusInterno || "sem status";
  return `${rotuloDoTipo(tipo)}: #${membro.idInt} em ${status} (${membro.pronto ? "pronto para expedir" : "ainda nao esta pronto"})`;
}
