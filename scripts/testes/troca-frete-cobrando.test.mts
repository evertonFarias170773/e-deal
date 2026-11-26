/**
 * Trocar a transportadora cobrando a diferença à parte (26/11/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/troca-frete-cobrando.test.mts
 */
import { readFileSync } from "node:fs";
import {
  descricaoDaCobrancaDaTroca,
  ehFormaCobrancaTroca,
  FORMAS_COBRANCA_TROCA
} from "../../src/features/expedicao/lib/abono-frete.ts";
import { cobrancaDaTrocaPrecisaEmitir, lerSituacaoDasTrocas, textoDoErroDaTroca } from "../../src/features/expedicao/lib/troca-frete.ts";
import { lerSaldoDoDespacho } from "../../src/features/expedicao/lib/saldo-despacho.ts";
import {
  ehCobrancaDaTrocaDeFrete,
  ehCobrancaDeReenvio,
  rotuloDaCobrancaForaDaProposta,
  semCobrancaDeReenvio
} from "../../src/features/cobrancas/lib/cobranca-reenvio.ts";
import { recusaDaCobrancaParaTroca } from "../../src/features/cobrancas/troca-forma-pagamento.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else console.log(`ok      ${nome}`);
}

// Formas e descrição
checar("formas: PIX, boleto e cartão", FORMAS_COBRANCA_TROCA.map((f) => f.valor), ["PIX", "BOLETO", "CARD_PARCELADO"]);
checar("forma inválida recusada", [ehFormaCobrancaTroca("PIX"), ehFormaCobrancaTroca("E-FATURADO"), ehFormaCobrancaTroca("")], [true, false, false]);
checar("descrição", descricaoDaCobrancaDaTroca("VEPPO"), "Diferença de frete — troca para VEPPO");

// Marcas: a da troca e a do reenvio ficam fora do saldo da proposta
const lista = [
  { id: "a", valor: 288.46 },
  { id: "b", valor: 21.2, id_troca_frete: 77 },
  { id: "c", valor: 10, chave_reenvio: "REENVIO:1:1" },
  { id: "d", valor: 5, id_troca_frete: null }
];
checar("fora do saldo: troca e reenvio", semCobrancaDeReenvio(lista).map((c) => c.id), ["a", "d"]);
checar("marcas", [ehCobrancaDaTrocaDeFrete(lista[1]), ehCobrancaDeReenvio(lista[1]), ehCobrancaDaTrocaDeFrete(lista[0])], [true, false, false]);
checar("rótulos próprios", lista.map((c) => rotuloDaCobrancaForaDaProposta(c)), [null, "Diferença de frete da troca", "Frete do reenvio", null]);

// Trocar forma de pagamento recusa as marcadas (a nova nasceria sem marca e viraria venda)
const pixDaTroca = {
  id: "x", id_int: 25824, id_pagamento: "25824-B", cod_solicitacao_inter: null, reserva_estado: null, id_pendencia: null,
  motivo_troca: null, tipo_cobranca: "PIX", status: "A_RECEBER", paid_at: null, id_empresa: 1, valor: 21.2, id_troca_frete: 77
};
checar("trocar forma recusa a cobrança da troca", recusaDaCobrancaParaTroca(pixDaTroca as never)?.code, "COBRANCA_FORA_DA_PROPOSTA");

// Situação vinda do banco
const situacao = lerSituacaoDasTrocas([
  {
    id: 77, transportadora: "VEPPO", servico: "VEPPO", frete_cobrado: 24.46, valor_opcao: 45.66, valor: 21.2, tipo: "PIX",
    motivo: "cliente pediu", autor: "Celi", aplicado_em: "2026-11-26T20:00:00Z", id_cobranca: "u", abono: null,
    abonado_por: null, abono_motivo: null, pago: 0, pendente: 21.2,
    cobranca_viva: { id: "u", id_pagamento: "25824-B", status: "A_RECEBER", valor: 21.2, id_empresa: 1, tipo_cobranca: "PIX", pix_copia_cola: false, url_cobranca: null }
  }
]);
checar("situação lida", [situacao.length, situacao[0].pendente, situacao[0].cobrancaViva?.tipo], [1, 21.2, "PIX"]);
checar("PIX sem QR precisa emitir; pago não", [
  cobrancaDaTrocaPrecisaEmitir(situacao[0].cobrancaViva),
  cobrancaDaTrocaPrecisaEmitir({ ...situacao[0].cobrancaViva!, temPix: true }),
  cobrancaDaTrocaPrecisaEmitir({ ...situacao[0].cobrancaViva!, status: "PAID" }),
  cobrancaDaTrocaPrecisaEmitir({ ...situacao[0].cobrancaViva!, tipo: "CARD_PARCELADO", urlCobranca: "https://x" })
], [true, false, false, false]);
checar("erro do banco limpo", textoDoErroDaTroca("ERROR: EXP_TROCA_ABONO: somente administrador abona."), "somente administrador abona.");

// Trava de saldo: a tela reconhece as situações novas (antes caíam como "sem veredito")
checar("saldo SALDO_TROCA_FRETE trava", lerSaldoDoDespacho({ bloqueia: true, situacao: "SALDO_TROCA_FRETE", saldo: 21.2, mensagem: "falta" })?.bloqueia, true);
checar("saldo SALDO_REENVIO trava", lerSaldoDoDespacho({ bloqueia: true, situacao: "SALDO_REENVIO", saldo: 10 })?.situacao, "SALDO_REENVIO");

// Migration: as exclusões e a proteção da marca
const mig = readFileSync("supabase/migrations/20261126b_frete_trocar_cobrando.sql", "utf8");
const semComentario = mig.replace(/--.*$/gm, "");
checar("migration: marca, gatilho, índice único e sem GRANT de escrita",
  [
    /ALTER TABLE public\.pagamentos_v2 ADD COLUMN id_troca_frete bigint;/.test(mig),
    /CREATE TRIGGER trg_pgv2_troca_frete_marcador\s+BEFORE INSERT OR UPDATE OF id_troca_frete/.test(mig),
    /CREATE UNIQUE INDEX pagamentos_v2_id_troca_frete_viva_uk/.test(mig),
    /GRANT [A-Z, ]*(INSERT|UPDATE)[A-Z, ]*\(?[^;]*id_troca_frete/.test(semComentario)
  ],
  [true, true, true, false]);
for (const fn of [
  "check_and_promote_proposta", "rpc_relatorio_vendas(", "rpc_relatorio_vendas_pagas(", "rpc_relatorio_curva_abc_clientes",
  "rpc_relatorio_vendas_por_cidade", "rpc_dashboard_executivo", "rpc_dashboard_vendedor", "rpc_ranking_vendedores"
]) {
  checar(`migration: exclusão em ${fn.replace("(", "")}`, semComentario.includes(`'public.${fn}`) && /id_troca_frete is null|id_troca_frete IS NULL/.test(semComentario), true);
}
checar("migration: views e trava de saldo",
  [
    /CREATE OR REPLACE VIEW public\.view_pagamentos_pagos AS[\s\S]*?id_troca_frete IS NULL/.test(mig),
    /CREATE OR REPLACE VIEW public\.view_pagamentos_pagos_v2 AS[\s\S]*?id_troca_frete IS NULL/.test(mig),
    /CREATE OR REPLACE VIEW public\.vw_relatorio_vendas_pagas_base AS[\s\S]*?id_troca_frete IS NULL/.test(mig),
    mig.includes("CREATE OR REPLACE VIEW public.vw_pagamentos_resumo AS"),
    mig.includes("'situacao', 'SALDO_TROCA_FRETE'"),
    /AND chave_reenvio IS NULL\s+-- Troca cobrando[^\n]*\n[^\n]*\n\s+AND id_troca_frete IS NULL;/.test(mig)
  ],
  [true, true, true, true, true, true]);
checar("migration: não grava frete, total, cotação nem boletos",
  [
    /UPDATE public\.propostas\s+SET id_transportadora_cliente = p_id_transportadora,\s+categoria_frete = p_categoria_frete\s+WHERE/.test(mig),
    /SET\s+valor_(frete|total)\s*=/.test(semComentario),
    /cotacao_frete|public\.boletos/.test(semComentario)
  ],
  [true, false, false]);

const rota = readFileSync("src/app/api/expedicao/recotacao/aplicar/route.ts", "utf8");
checar("rota: cobrando usa a mesma permissão e manda a forma",
  [rota.includes("const troca = abonar || cobrar;"), rota.includes("p_tipo_cobranca: a.tipoCobranca")],
  [true, true]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else console.log("\nTudo certo.");
