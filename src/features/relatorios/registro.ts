import { conferenciaPagamentos } from "./definicoes/conferencia-pagamentos";
import { contasAReceber } from "./definicoes/contas-a-receber";
import { contaCorrenteCreditos } from "./definicoes/conta-corrente-creditos";
import { curvaAbcClientes } from "./definicoes/curva-abc-clientes";
import { fretePorTransportadora } from "./definicoes/frete-por-transportadora";
import { fretesDespachadosLista } from "./definicoes/fretes-despachados-lista";
import { notasFiscais } from "./definicoes/notas-fiscais";
import { vendasPagas } from "./definicoes/vendas-pagas";
import { vendasPorCidade } from "./definicoes/vendas-por-cidade";
import type { AreaDef, AreaRelatorio, RelatorioDef } from "./types";

/**
 * Lista de relatórios prontos. Relatório novo = um arquivo em `definicoes/` +
 * uma linha aqui. Nada mais muda (menu, rota de dados e página leem esta lista).
 */
export const RELATORIOS: RelatorioDef[] = [
  vendasPagas,
  curvaAbcClientes,
  vendasPorCidade,
  contaCorrenteCreditos,
  conferenciaPagamentos,
  contasAReceber,
  notasFiscais,
  fretePorTransportadora,
  fretesDespachadosLista
];

export const AREAS: AreaDef[] = [
  { id: "vendas", rotulo: "Vendas", descricao: "Vendas, clientes e descontos." },
  { id: "financeiro", rotulo: "Financeiro", descricao: "Recebimentos, inadimplência e faturamento." },
  { id: "producao", rotulo: "Produção", descricao: "Pedidos por etapa, prazos e retrabalho." },
  { id: "expedicao", rotulo: "Expedição", descricao: "Despachos, fretes e entregas." },
  { id: "produtos", rotulo: "Produtos", descricao: "Mais vendidos e receita por produto." },
  { id: "infraestrutura", rotulo: "Infraestrutura", descricao: "Automações, webhooks e auditoria." }
];

export function buscarRelatorio(slug: string): RelatorioDef | undefined {
  return RELATORIOS.find((r) => r.slug === slug);
}

export function relatoriosDaArea(area: AreaRelatorio): RelatorioDef[] {
  return RELATORIOS.filter((r) => r.area === area);
}

/** Só as áreas que já têm relatório pronto. */
export function areasComRelatorio(): AreaDef[] {
  return AREAS.filter((a) => relatoriosDaArea(a.id).length > 0);
}
