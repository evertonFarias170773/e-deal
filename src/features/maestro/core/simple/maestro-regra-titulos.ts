/**
 * maestro-regra-titulos.ts
 *
 * A regra UNICA do Maestro para titulo (boleto ou deposito) "em aberto" e
 * "em atraso" — decisao do dono em 02/10/2026.
 *
 *   EM ABERTO  = titulo sem pagamento e nao cancelado, em QUALQUER status
 *                (a vencer, a receber, vencido...). O titulo "Substituido" do
 *                Refazer boleto e gravado como CANCELADO, entao tambem fica fora.
 *   EM ATRASO  = em aberto com vencimento ANTES de hoje, no calendario de Brasilia.
 *
 * "Nao liquidado" e a mesma coisa que em aberto: titulo cancelado nao e divida.
 *
 * ANTES (ate 02/10/2026) havia tres regras diferentes:
 *   - em aberto     = sem pagamento E status A_VENCER  → o titulo A_RECEBER nao
 *                     pago ficava de fora (cliente 63708, R$ 1.710,69);
 *   - em atraso     = sem pagamento E dias_atraso > 0  → dependia da rotina
 *                     diaria e contava cancelado com dias de atraso congelados;
 *   - nao liquidado = sem pagamento                    → contava cancelado.
 *
 * Funcoes puras: quem consulta o banco e o adapter (maestro-simple-boletos) e a
 * consulta por pedido (maestro-agent-pedido).
 */

export interface TituloParaRegra {
  status?: unknown;
  paid_at?: unknown;
  vencimento?: unknown;
}

/** Trecho de filtro do PostgREST: status nulo OU fora dos cancelados. NOT IN sozinho descartaria o nulo. */
export const FILTRO_TITULO_NAO_CANCELADO = 'status.is.null,status.not.in.(CANCELADO,CANCELADA)';

function statusDe(titulo: TituloParaRegra): string {
  return String(titulo.status ?? '').trim().toUpperCase();
}

/** CANCELADO / CANCELADA — inclui o "Substituido" do Refazer boleto, que e um cancelado com marca. */
export function tituloCancelado(titulo: TituloParaRegra): boolean {
  return statusDe(titulo).startsWith('CANCELAD');
}

export function tituloPago(titulo: TituloParaRegra): boolean {
  return (titulo.paid_at != null && titulo.paid_at !== '') || statusDe(titulo) === 'PAID';
}

export function tituloEmAberto(titulo: TituloParaRegra): boolean {
  return !tituloPago(titulo) && !tituloCancelado(titulo);
}

/** Hoje em Brasilia, AAAA-MM-DD. */
export function hojeEmBrasilia(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

function dataCivil(valor: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor ?? '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Dias corridos de atraso de um titulo EM ABERTO: 0 ate o dia do vencimento
 * (inclusive), 1 no dia seguinte. Titulo pago, cancelado ou sem vencimento = 0.
 */
export function diasDeAtraso(titulo: TituloParaRegra, hoje: string = hojeEmBrasilia()): number {
  if (!tituloEmAberto(titulo)) return 0;
  const vencimento = dataCivil(titulo.vencimento);
  const dia = dataCivil(hoje);
  if (!vencimento || !dia || vencimento >= dia) return 0;
  const emDias = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) / 86_400_000;
  return Math.round(emDias(dia) - emDias(vencimento));
}

export function tituloEmAtraso(titulo: TituloParaRegra, hoje: string = hojeEmBrasilia()): boolean {
  return diasDeAtraso(titulo, hoje) > 0;
}

export const CRITERIO_TITULOS =
  'em aberto = título sem pagamento e não cancelado, em qualquer status (o substituído pelo Refazer boleto é cancelado e não entra); ' +
  'em atraso = em aberto com vencimento antes de hoje, no calendário de Brasília.';
