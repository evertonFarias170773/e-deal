/**
 * Visualização do pedido — src/features/orcamentos/lib/visualizacao-da-proposta.ts
 * e src/features/orcamentos/lib/estado-de-edicao.ts
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/visualizacao-da-proposta.test.mts
 *
 * Regras puras, sem banco. Os casos usam a situação REAL lida em 08/10/2026
 * (só leitura; sem nome, documento, telefone nem e-mail):
 *   23320  FOB + MOTOBOY, cotação SEDEX "1 dia útil", E-Faturado a vencer + 1 cancelada, em produção
 *   23083  CIF, cotação SEDEX, DESPACHADO por transportadora (expedicoes.tipo_frete = TRANSPORTADORA)
 *   23114  CIF Correios (transportadora vinculada É os Correios), cartão pago + PIX cancelado
 *   23371  RETIRA, tabela especial 10%: itens 56,00, líquido 50,40, E-Retrabalho pago, em produção
 *   22139  complementar do 22137, RETIRA, sem cotação, sem cobrança
 *   23382  RETIRA, PIX pago e confirmado, em produção
 */
import {
  MARCADOR_SEM_CONTATO,
  SEM_PRAZO_DE_ENTREGA,
  contatoDaVisualizacao,
  estadoDaCobranca,
  freteDaVisualizacao,
  pagamentoDaVisualizacao,
  pedidoJaLiberado,
  prazoDeProducao,
  situacaoDasCobrancas,
  valoresDaTabelaEspecial
} from "../../src/features/orcamentos/lib/visualizacao-da-proposta.ts";
import {
  TITULO_DO_ESTADO_DE_EDICAO,
  avaliarEstadoDeEdicao,
  estadoDeEdicaoDaProposta,
  resumoDoEstadoDeEdicao,
  tomDoStatusDoCabecalho
} from "../../src/features/orcamentos/lib/estado-de-edicao.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : `\n       obtido:   ${JSON.stringify(obtido)}\n       esperado: ${JSON.stringify(esperado)}`}`);
}

const SEDEX = { transportadora: "Correios SEDEX", servico: "SEDEX", prazo: "1 dia útil" };
const base = { modalidade: null, transporteCategoria: null, idTransportadora: null, nomeTransportadora: null, cotacaoEscolhida: null, despachoConfirmado: false } as const;

/* ============================================================ 1. FRETE */
// 23320 — FOB com Motoboy
{
  const f = freteDaVisualizacao({ ...base, modalidade: "FOB", transporteCategoria: "MOTOBOY", cotacaoEscolhida: SEDEX });
  checar("23320 FOB com motoboy: rotulo", f.rotulo, "Cliente contrata: Motoboy");
  checar("23320: a cotacao SEDEX nao e o frete (sem selo ESCOLHIDO) e a nota diz qual e", [f.usaCotacao, f.nota], [false, "Frete definido: Cliente contrata: Motoboy. As cotações abaixo não estão em uso."]);
  checar("23320: prazo de entrega nao se aplica", f.prazoDeEntrega, SEM_PRAZO_DE_ENTREGA);
}
// FOB com transportadora (23365) e FOB sem nome lido
checar("FOB com transportadora: Cliente contrata: <nome>", freteDaVisualizacao({ ...base, modalidade: "FOB", transporteCategoria: "TRANSPORTADORA", idTransportadora: 900, nomeTransportadora: "Transportadora Exemplo", cotacaoEscolhida: { ...SEDEX, prazo: "8 dias úteis" } }).rotulo, "Cliente contrata: Transportadora Exemplo");
checar("FOB sem transportadora lida: a definir (nunca o SEDEX)", freteDaVisualizacao({ ...base, modalidade: "FOB", transporteCategoria: "TRANSPORTADORA", cotacaoEscolhida: SEDEX }).rotulo, "Cliente contrata: transportadora a definir");

// 23083 — CIF despachado por transportadora
{
  const f = freteDaVisualizacao({ ...base, modalidade: "CIF", transporteCategoria: "CORREIOS", idTransportadora: 901, nomeTransportadora: "Rodoviario Exemplo", cotacaoEscolhida: SEDEX, despachoConfirmado: true, despacho: { tipoFrete: "TRANSPORTADORA", transportadoraNome: "Rodoviario Exemplo", modalidade: "CIF" } });
  checar("23083 CIF despachado por transportadora", [f.rotulo, f.usaCotacao, f.prazoDeEntrega], ["Transportadora: Rodoviario Exemplo", false, SEM_PRAZO_DE_ENTREGA]);
}
// CIF com transportadora declarada, ANTES do despacho (predicado da Expedição)
checar("CIF com transportadora declarada, sem despacho: Transportadora: <nome>", freteDaVisualizacao({ ...base, modalidade: "CIF", idTransportadora: 901, nomeTransportadora: "Rodoviario Exemplo", cotacaoEscolhida: SEDEX }).rotulo, "Transportadora: Rodoviario Exemplo");
checar("CIF com transportadora declarada e PREPOSTAGEM VIVA: segue a cotacao dos Correios", freteDaVisualizacao({ ...base, modalidade: "CIF", idTransportadora: 901, nomeTransportadora: "Rodoviario Exemplo", cotacaoEscolhida: SEDEX, correiosIdPrepostagem: "PR123", prepostagemCanceladaEm: null }).rotulo, "Correios SEDEX - 1 dia útil");
checar("CIF com prepostagem CANCELADA: volta a valer a transportadora", freteDaVisualizacao({ ...base, modalidade: "CIF", idTransportadora: 901, nomeTransportadora: "Rodoviario Exemplo", cotacaoEscolhida: SEDEX, correiosIdPrepostagem: "PR123", prepostagemCanceladaEm: "2026-10-07T12:00:00Z" }).rotulo, "Transportadora: Rodoviario Exemplo");

// 23114 — CIF Correios: igual a antes
{
  const f = freteDaVisualizacao({ ...base, modalidade: "CIF", transporteCategoria: "CORREIOS", idTransportadora: 902, nomeTransportadora: "CORREIOS SEDE", cotacaoEscolhida: SEDEX });
  checar("23114 CIF com Correios: igual a antes", [f.rotulo, f.usaCotacao, f.nota, f.prazoDeEntrega], ["Correios SEDEX - 1 dia útil", true, null, "1 dia útil"]);
}
checar("CIF sem transportadora: a cotacao, como sempre", freteDaVisualizacao({ ...base, modalidade: "CIF", cotacaoEscolhida: SEDEX }).rotulo, "Correios SEDEX - 1 dia útil");
checar("modalidade nao declarada: a cotacao, como sempre", freteDaVisualizacao({ ...base, cotacaoEscolhida: SEDEX }).rotulo, "Correios SEDEX - 1 dia útil");
checar("CIF motoboy com cotacao dos Correios: Motoboy", freteDaVisualizacao({ ...base, modalidade: "CIF", transporteCategoria: "MOTOBOY", cotacaoEscolhida: SEDEX }).rotulo, "Motoboy");
checar("CIF motoboy com cotacao de motoboy: a propria cotacao e o frete", [freteDaVisualizacao({ ...base, modalidade: "CIF", transporteCategoria: "MOTOBOY", cotacaoEscolhida: { transportadora: "Motoboy", servico: "MOTOBOY", prazo: "Sob consulta" } }).usaCotacao], [true]);
checar("sem cotacao e sem modalidade: frete nao definido", freteDaVisualizacao({ ...base }), { rotulo: "Frete não definido", usaCotacao: false, nota: null, prazoDeEntrega: SEM_PRAZO_DE_ENTREGA });

// RETIRA (23382, 23371)
{
  const f = freteDaVisualizacao({ ...base, modalidade: "RETIRA", transporteCategoria: "RETIRA", cotacaoEscolhida: { transportadora: "RETIRADA", servico: "RETIRADA", prazo: "Imediato" } });
  checar("RETIRA com a cotacao de retirada: Retira no balcao, a cotacao segue marcada, sem nota e sem prazo de entrega", [f.rotulo, f.usaCotacao, f.nota, f.prazoDeEntrega], ["Retira no balcão", true, null, SEM_PRAZO_DE_ENTREGA]);
}
{
  const f = freteDaVisualizacao({ ...base, modalidade: "RETIRA", cotacaoEscolhida: SEDEX });
  checar("RETIRA com cotacao SEDEX que sobrou: nunca SEDEX, e o SEDEX perde o selo", [f.rotulo, f.usaCotacao, f.nota], ["Retira no balcão", false, "Frete definido: Retira no balcão. As cotações abaixo não estão em uso."]);
}

// 22139 — complementar
{
  const f = freteDaVisualizacao({ ...base, modalidade: "RETIRA", transporteCategoria: "RETIRA", idIntPedidoPrincipal: 22137 });
  checar("22139 complementar: herdado do principal", [f.rotulo, f.usaCotacao, f.nota], ["Herdado do pedido #22137: RETIRA", false, null]);
}
checar("complementar sem modalidade", freteDaVisualizacao({ ...base, idIntPedidoPrincipal: 22137 }).rotulo, "Herdado do pedido #22137: modalidade não declarada");

/* ============================================================ 2. ESTADO DE EDIÇÃO */
type C = { status: string; tipo_cobranca: string; confirmado: boolean; valor: number; paid_at?: string | null };
const cob = (c: Partial<C>) => ({ status: "A_RECEBER", tipo_cobranca: "PIX", confirmado: false, valor: 100, paid_at: null, ...c }) as never;
const entrada = (cobrancas: unknown[], extra: Record<string, unknown> = {}) => ({ cobrancas: cobrancas as never[], titulos: [], modoEdicao: true, canEditarPropostaPaga: false, canEditarFaturado: false, isAvulso: false, temProdutosAtivos: true, ...extra });

// 23320: E-Faturado a vencer + uma cancelada
const cobrancas23320 = [cob({ tipo_cobranca: "E-FATURADO", status: "CANCELADO", confirmado: true, valor: 1090.2 }), cob({ tipo_cobranca: "E-FATURADO", status: "A_VENCER", confirmado: true, valor: 1090.2 })];
checar("23320 com permissao do faturado: Alteracao Liberada", avaliarEstadoDeEdicao(entrada(cobrancas23320, { canEditarFaturado: true })).estado, "FATURADO_A_VENCER_LIBERADA");
checar("23320 titulo do aviso e o da edicao", TITULO_DO_ESTADO_DE_EDICAO.FATURADO_A_VENCER_LIBERADA, "Faturado a Vencer — Alteração Liberada");
checar("23320 sem permissao: aviso generico de cobrancas, nao Edicao Bloqueada", avaliarEstadoDeEdicao(entrada(cobrancas23320)).estado, "COBRANCAS_GERADAS");
checar("23320 com titulos ainda nao lidos: o faturado nao destrava (como no formulario)", avaliarEstadoDeEdicao(entrada(cobrancas23320, { canEditarFaturado: true, titulos: null })).podeEditarPeloFaturado, false);

// Pedido só com cobrança CANCELADA: nenhum aviso
checar("so cobranca cancelada: sem aviso", avaliarEstadoDeEdicao(entrada([cob({ status: "CANCELADO" })], { canEditarPropostaPaga: true, canEditarFaturado: true })).estado, "SEM_COBRANCA_ATIVA");
checar("sem cobranca nenhuma: sem aviso", avaliarEstadoDeEdicao(entrada([])).estado, "SEM_COBRANCA_ATIVA");

// 23382: PIX pago e confirmado, em produção
const pixPago = [cob({ status: "PAID", confirmado: true, valor: 56, paid_at: "2026-10-07T12:00:00Z" })];
checar("23382 PIX pago, com permissao de editar paga: Edicao Autorizada", avaliarEstadoDeEdicao(entrada(pixPago, { canEditarPropostaPaga: true, canEditarFaturado: true })).estado, "EDICAO_AUTORIZADA_PAGA");
checar("23382 PIX pago, sem permissao: cobrancas geradas", avaliarEstadoDeEdicao(entrada(pixPago)).estado, "COBRANCAS_GERADAS");
checar("avulsa paga: bloqueada para todos", avaliarEstadoDeEdicao(entrada(pixPago, { canEditarPropostaPaga: true, canEditarFaturado: true, isAvulso: true })).estado, "AVULSA_PAGA_BLOQUEADA");
checar("cobranca aberta nao paga, com permissao: nao confirmada", avaliarEstadoDeEdicao(entrada([cob({})], { canEditarPropostaPaga: true, canEditarFaturado: true })).estado, "COBRANCA_ATIVA_NAO_CONFIRMADA");

// A cadeia é a do formulário: todas as combinações, comparadas com a expressão antiga
{
  const antiga = (e: Record<string, boolean | string | null>) =>
    !e.hasActiveCobranca ? "SEM_COBRANCA_ATIVA"
    : e.bloqueioAvulsaPaga ? "AVULSA_PAGA_BLOQUEADA"
    : e.podeEditarPeloFaturado ? "FATURADO_A_VENCER_LIBERADA"
    : e.canEditarFaturado && !e.canEditarPropostaPaga && !e.faturadoElegivel && e.motivoFaturado !== "SEM_FATURADO" ? "FATURADO_BLOQUEADA"
    : e.canEditarPropostaPaga && e.isPropostaPaga ? "EDICAO_AUTORIZADA_PAGA"
    : e.canEditarPropostaPaga && !e.isPropostaPaga ? "COBRANCA_ATIVA_NAO_CONFIRMADA"
    : "COBRANCAS_GERADAS";
  let diferentes = 0, total = 0;
  const bool = [true, false];
  for (const hasActiveCobranca of bool) for (const bloqueioAvulsaPaga of bool) for (const podeEditarPeloFaturado of bool) for (const canEditarFaturado of bool)
    for (const canEditarPropostaPaga of bool) for (const faturadoElegivel of bool) for (const isPropostaPaga of bool) for (const motivoFaturado of ["SEM_FATURADO", "TITULO_QUITADO", null]) {
      const e = { hasActiveCobranca, bloqueioAvulsaPaga, podeEditarPeloFaturado, canEditarFaturado, canEditarPropostaPaga, faturadoElegivel, isPropostaPaga, motivoFaturado };
      total += 1;
      if (estadoDeEdicaoDaProposta(e) !== antiga(e)) diferentes += 1;
    }
  checar("a funcao unica decide igual a cadeia do formulario em todas as combinacoes", [total, diferentes], [384, 0]);
}
checar("todo estado com aviso tem titulo e frase", (["AVULSA_PAGA_BLOQUEADA", "FATURADO_A_VENCER_LIBERADA", "FATURADO_BLOQUEADA", "EDICAO_AUTORIZADA_PAGA", "COBRANCA_ATIVA_NAO_CONFIRMADA", "COBRANCAS_GERADAS"] as const).every((s) => TITULO_DO_ESTADO_DE_EDICAO[s].length > 0 && resumoDoEstadoDeEdicao(s, null).length > 0), true);
checar("faturado bloqueado mostra o motivo que veio da regra", resumoDoEstadoDeEdicao("FATURADO_BLOQUEADA", "O título já foi quitado."), "O título já foi quitado.");
checar("tom do selo de status: o do formulario", ["NOVO", "APROVADO", "AGUARDANDO", "EM PRODUCAO", "LIBERADO", null].map((s) => tomDoStatusDoCabecalho(s)), ["info", "success", "warning", "neutral", "neutral", "neutral"]);

/* ============================================================ 3 e 4. PAGAMENTO E COBRANÇAS */
checar("sem cobranca ativa: Sem cobranca", [pagamentoDaVisualizacao([]), pagamentoDaVisualizacao([cob({ status: "CANCELADO" })])], ["Sem cobrança", "Sem cobrança"]);
checar("23320: so a ativa conta", pagamentoDaVisualizacao(cobrancas23320), "E-Faturado (Confirmado)");
checar("23114: cartao pago e confirmado; o PIX cancelado nao aparece", pagamentoDaVisualizacao([cob({ tipo_cobranca: "CARD_PARCELADO", status: "PAID", confirmado: true }), cob({ status: "CANCELADO" })]), "Cartão de crédito (Confirmado)");
checar("PIX aberto", pagamentoDaVisualizacao([cob({})]), "PIX (Não confirmado)");
checar("PIX pago ainda nao conferido", pagamentoDaVisualizacao([cob({ status: "PAID" })]), "PIX (Pago / A liberar)");
checar("faturado a vencer nao confirmado", estadoDaCobranca(cob({ tipo_cobranca: "E-FATURADO", status: "A_VENCER" })), "A vencer");
checar("duas formas ativas", pagamentoDaVisualizacao([cob({ status: "PAID", confirmado: true }), cob({ tipo_cobranca: "BOLETO" })]), "PIX (Confirmado) + Boleto (Não confirmado)");

checar("pedido ja liberado?", ["NOVO", "AGUARDANDO", "APROVADO", "LIBERADO", "EM PRODUCAO", "EXPEDICAO", "EM TRANSITO", "NOVO / EM ARTE", "", null].map((s) => pedidoJaLiberado(s)), [false, false, false, true, true, true, true, false, false, false]);
checar("23382 em producao com cobranca confirmada: estado real, nao Pronta para liberar", situacaoDasCobrancas(pixPago, "EM PRODUCAO"), "Confirmado");
checar("23371 em producao, E-Retrabalho confirmado", situacaoDasCobrancas([cob({ tipo_cobranca: "E-RETRABALHO", status: "PAID", confirmado: true })], "EM PRODUCAO"), "Confirmado");
checar("23320 em producao: so a ativa, sem a cancelada", situacaoDasCobrancas(cobrancas23320, "EM PRODUCAO"), "Confirmado");
checar("antes da liberacao o rotulo de liberacao continua", situacaoDasCobrancas(pixPago, "APROVADO"), "Pronta para liberar");
checar("antes da liberacao, sem pagamento", situacaoDasCobrancas([cob({})], "AGUARDANDO"), "Aguardando pagamento");

/* ============================================================ 5. PRAZOS */
checar("prazo de producao: o maior entre os itens", prazoDeProducao([{ produto: { prazo_dias_uteis: 1 }, prazo: "1 dia útil" }, { produto: { prazo_dias_uteis: 3 }, prazo: "3 dias úteis" }]), "3 dias úteis");
checar("23320: dois itens de 1 dia util (nao mais 7 dias)", prazoDeProducao([{ produto: { prazo_dias_uteis: 1 } }, { produto: { prazo_dias_uteis: 1 } }]), "1 dia útil");
checar("item cancelado nao conta", prazoDeProducao([{ produto: { prazo_dias_uteis: 1 } }, { produto: { prazo_dias_uteis: 10 }, statusItem: "CANCELADO" }]), "1 dia útil");
checar("sem numero no cadastro: le do texto do item", prazoDeProducao([{ produto: { prazo_dias_uteis: null }, prazo: "5 dias uteis" }]), "5 dias úteis");
checar("sem prazo nenhum (avulso): nao definido", [prazoDeProducao([]), prazoDeProducao([{ produto: null, prazo: "A combinar" }])], ["Não definido", "Não definido"]);

/* ============================================================ 6. TABELA ESPECIAL */
// 23371: 100 un a 0,56 = 56,00 bruto; 10% = 5,60; líquido 50,40
const itens23371 = [{ subtotalBruto: 56, acrescimoBonus: 5.6, subtotal: 50.4 }];
checar("23371: bruto, desconto e liquido corretos", valoresDaTabelaEspecial(itens23371, 50.4, 10), { mostrar: true, bruto: 56, desconto: 5.6, liquido: 50.4 });
checar("pedido sem tabela especial: as linhas nao aparecem", valoresDaTabelaEspecial([{ subtotalBruto: 1090.2, acrescimoBonus: 0, subtotal: 1090.2 }], 1090.2, 0), { mostrar: false, motivo: "SEM_TABELA" });
checar("tabela gravada mas desconto zerado nos itens: esconde (nunca -R$ 0,00)", valoresDaTabelaEspecial([{ subtotalBruto: 56, acrescimoBonus: 0, subtotal: 56 }], 56, 10), { mostrar: false, motivo: "NAO_DERIVAVEL" });
checar("itens nao fecham com o subtotal do resumo: esconde", valoresDaTabelaEspecial(itens23371, 56, 10), { mostrar: false, motivo: "NAO_DERIVAVEL" });
checar("item cancelado fica fora das somas", valoresDaTabelaEspecial([...itens23371, { subtotalBruto: 100, acrescimoBonus: 10, subtotal: 90, statusItem: "CANCELADO" }], 50.4, 10), { mostrar: true, bruto: 56, desconto: 5.6, liquido: 50.4 });
checar("varios itens, arredondamento de centavo", valoresDaTabelaEspecial([{ subtotalBruto: 33.33, acrescimoBonus: 3.33, subtotal: 30 }, { subtotalBruto: 66.67, acrescimoBonus: 6.67, subtotal: 60 }], 90, 10).mostrar, true);

/* ============================================================ 8. CONTATO */
checar("nome e o marcador, com telefone e e-mail", contatoDaVisualizacao({ nome: MARCADOR_SEM_CONTATO, whatsapp: "51900000000", email: "x@exemplo.com" }), { nome: "Contato sem nome cadastrado", detalhe: "51900000000 - x@exemplo.com" });
checar("nome e o marcador, so com telefone: sem traco solto", contatoDaVisualizacao({ nome: MARCADOR_SEM_CONTATO, whatsapp: "51900000000", email: "" }), { nome: "Contato sem nome cadastrado", detalhe: "51900000000" });
checar("marcador sem dado nenhum", contatoDaVisualizacao({ nome: MARCADOR_SEM_CONTATO, whatsapp: "", email: null }), { nome: "Sem contato cadastrado", detalhe: "" });
checar("contato com nome e sem telefone nem e-mail (23382): sem traco solto", contatoDaVisualizacao({ nome: "Fulano", whatsapp: "", email: "" }), { nome: "Fulano", detalhe: "" });
checar("contato completo: igual a antes", contatoDaVisualizacao({ nome: "Fulano", whatsapp: "51900000000", email: "x@exemplo.com" }), { nome: "Fulano", detalhe: "51900000000 - x@exemplo.com" });
checar("sem contato", contatoDaVisualizacao(null), { nome: "Sem contato cadastrado", detalhe: "" });

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
