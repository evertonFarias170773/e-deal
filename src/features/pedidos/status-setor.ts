/**
 * Fase de produção POR SETOR — fonte única.
 *
 * Cada setor do pedido (PVC, LASER, FLEXO, TEXTIL) tem o seu próprio boletim em
 * `pedidos_artes` e, desde 13/08/2026, a sua própria fase em
 * `pedidos_artes.status_producao`. Antes disso a produção inteira dividia um
 * único campo (`propostas.status_interno`): mover o FLEXO reescrevia o que o
 * TEXTIL tinha acabado de gravar, e a lista de OS não tinha como mostrar
 * "FLEXO em impressão, PVC em acabamento".
 *
 * O vocabulário é o mesmo do QR de produção (`public.osqr__status_qr()`) até o
 * acabamento, mais `CONCLUIDO`. Da expedição em diante nada é por setor: o
 * pedido é despachado inteiro — o mesmo corte que a página do boletim já faz
 * (abas por setor + aba Expedição global).
 */

export const FASES_SETOR = [
  "EM PRODUCAO",
  "EM IMPRESSAO",
  "EM IMPRESSAO / PENDENTE",
  "EM ACABAMENTO",
  "EM ACABAMENTO / PENDENTE",
  "CONCLUIDO"
] as const;

export type FaseSetor = (typeof FASES_SETOR)[number];

/** Boletim sem fase gravada lê como "em produção" — derivado, nunca escrito. */
export const FASE_INICIAL: FaseSetor = "EM PRODUCAO";

export function normalizarFaseSetor(valor: string | null | undefined): FaseSetor {
  const texto = (valor || "").trim().toUpperCase();
  return FASES_SETOR.find((f) => f === texto) ?? FASE_INICIAL;
}

/** Rótulo curto, para caber no chip da lista. */
export const ROTULO_FASE: Record<FaseSetor, string> = {
  "EM PRODUCAO": "Em produção",
  "EM IMPRESSAO": "Impressão",
  "EM IMPRESSAO / PENDENTE": "Impressão pausada",
  "EM ACABAMENTO": "Acabamento",
  "EM ACABAMENTO / PENDENTE": "Acabamento pausado",
  CONCLUIDO: "Pronto"
};

/**
 * Etapa da cadeia. As variantes "/ PENDENTE" ficam na MESMA etapa da sua base:
 * pausar não faz o setor avançar. Usado para achar o setor menos adiantado.
 */
export function etapaDaFase(fase: FaseSetor): number {
  switch (fase) {
    case "EM PRODUCAO":
      return 0;
    case "EM IMPRESSAO":
    case "EM IMPRESSAO / PENDENTE":
      return 1;
    case "EM ACABAMENTO":
    case "EM ACABAMENTO / PENDENTE":
      return 2;
    case "CONCLUIDO":
      return 3;
  }
}

export function faseEstaPausada(fase: FaseSetor): boolean {
  return fase.endsWith("/ PENDENTE");
}

/** Cores do ponto/rótulo da fase (a cor do chip é do setor, não da fase). */
export const CORES_FASE: Record<FaseSetor, string> = {
  "EM PRODUCAO": "bg-slate-400",
  "EM IMPRESSAO": "bg-sky-500",
  "EM IMPRESSAO / PENDENTE": "bg-orange-500",
  "EM ACABAMENTO": "bg-indigo-500",
  "EM ACABAMENTO / PENDENTE": "bg-orange-500",
  CONCLUIDO: "bg-emerald-500"
};

export interface ConsolidacaoSetores {
  /** Fase do setor menos adiantado — o que segura o pedido. */
  fase: FaseSetor;
  prontos: number;
  total: number;
  /** Todos os setores concluíram a produção. */
  tudoPronto: boolean;
}

/**
 * Consolida as fases dos setores no ritmo do pedido: vale o setor MENOS
 * adiantado, porque é ele que segura a entrega. Empate na mesma etapa favorece
 * a variante pausada, que é a informação acionável.
 */
export function consolidarFases(fases: FaseSetor[]): ConsolidacaoSetores | null {
  if (fases.length === 0) return null;

  let menor = fases[0];
  for (const fase of fases) {
    const diferenca = etapaDaFase(fase) - etapaDaFase(menor);
    if (diferenca < 0 || (diferenca === 0 && faseEstaPausada(fase))) menor = fase;
  }

  const prontos = fases.filter((f) => f === "CONCLUIDO").length;
  return { fase: menor, prontos, total: fases.length, tudoPronto: prontos === fases.length };
}

/**
 * Espelho da consolidação em `propostas.status_interno`, que continua sendo o
 * status do PEDIDO. Devolve `null` quando não se deve escrever:
 *
 *  - `CONCLUIDO` não existe no vocabulário do pedido, e promover para EXPEDICAO
 *    aqui tiraria a OS da lista de produção sem colocá-la em lugar nenhum — a
 *    saída da produção continua pelo caminho já existente;
 *  - `REVISAO` foi de propósito deixado de fora: era o que os antigos rádios da
 *    lista gravavam, um valor que não está nem no filtro da lista nem na matriz
 *    do QR — o pedido sumia da tela no recarregamento seguinte.
 */
export function statusInternoDaFase(fase: FaseSetor): string | null {
  return fase === "CONCLUIDO" ? null : fase;
}
