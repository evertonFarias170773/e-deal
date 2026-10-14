/**
 * NFS-e faturada em Contas a Receber (14/10/2026, nota 138 do pedido 23733).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/nfse-contas-a-receber.test.mts
 *
 * O QUE PROVA
 *   1. A NFS-e que vira nota do boleto: autorizada, de produção, com número; a mais recente.
 *   2. Referência: parcela única leva a ref da NFS-e; 2+ parcelas seguem `P…` (992d42c).
 *   3. O menu do Histórico NFS-e: "Lançar" só com faturado em aberto ainda não coberto
 *      por títulos ativos; "Revisar" e "Ver contas a receber" com título ativo; nada
 *      em homologação nem em nota não autorizada.
 */
import { acoesFinanceirasDaNfse, escolherNfseAutorizadaDoPedido, seloFinanceiroDaNfse } from "../../src/features/nfse/lib/financeiro-nfse.ts";
import { referenciaDoBoleto, referenciasDoLancamento } from "../../src/features/cobrancas/lib/referencia-do-boleto.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`}`);
}

// ── 1. Escolha da NFS-e ──────────────────────────────────────────────────────
const nota138 = { ref: "NFS-23733-001", status: "AUTORIZADA", ambiente: "producao", numero_nfse: "138", created_at: "2026-10-14T20:48:57Z", updated_at: "2026-10-14T20:49:25Z" };
checar("a nota 138", escolherNfseAutorizadaDoPedido([nota138])?.ref, "NFS-23733-001");
checar("homologacao, rascunho, sem numero e cancelada nao valem",
  escolherNfseAutorizadaDoPedido([
    { ...nota138, ambiente: "homologacao" },
    { ...nota138, status: "PENDENTE" },
    { ...nota138, numero_nfse: null },
    { ...nota138, status: "CANCELADA" }
  ]), null);
checar("a mais recente entre duas autorizadas",
  escolherNfseAutorizadaDoPedido([nota138, { ...nota138, ref: "NFS-23733-002", numero_nfse: "139", updated_at: "2026-10-20T10:00:00Z" }])?.ref,
  "NFS-23733-002");
checar("lista vazia", escolherNfseAutorizadaDoPedido([]), null);

// ── 2. Referência (a regra de 992d42c, sem mudança) ──────────────────────────
checar("parcela unica: a ref da NFS-e",
  referenciaDoBoleto({ idInt: 23733, parcela: 1, totalParcelas: 1, quantidadeDeParcelas: 1, refDaNotaDoPedido: "NFS-23733-001" }),
  "NFS-23733-001");
checar("2 parcelas: formato P",
  referenciasDoLancamento([{ parcela: 1, total_parcelas: 2 }, { parcela: 2, total_parcelas: 2 }], { idInt: 23733, refDaNotaDoPedido: "NFS-23733-001" }),
  ["P1223733", "P2223733"]);

// ── 3. Menu do Histórico NFS-e ───────────────────────────────────────────────
const base = { status: "AUTORIZADA", ambiente: "producao", faturadoEmAberto: { qtd: 1, soma: 90 }, titulosAtivos: { qtd: 0, soma: 0 } };
checar("faturado em aberto sem titulo: so Lancar", acoesFinanceirasDaNfse(base), { lancar: true, revisar: false, verContasAReceber: false });
checar("ja lancado por inteiro: Revisar e Ver", acoesFinanceirasDaNfse({ ...base, titulosAtivos: { qtd: 1, soma: 90 } }),
  { lancar: false, revisar: true, verContasAReceber: true });
checar("lancado em parte: Lancar o resto, Revisar e Ver", acoesFinanceirasDaNfse({ ...base, faturadoEmAberto: { qtd: 2, soma: 180 }, titulosAtivos: { qtd: 1, soma: 90 } }),
  { lancar: true, revisar: true, verContasAReceber: true });
checar("sem faturado em aberto (PIX, cartao, pago): nada", acoesFinanceirasDaNfse({ ...base, faturadoEmAberto: { qtd: 0, soma: 0 } }),
  { lancar: false, revisar: false, verContasAReceber: false });
checar("faturado ainda sem leitura: nao oferece", acoesFinanceirasDaNfse({ ...base, faturadoEmAberto: undefined }),
  { lancar: false, revisar: false, verContasAReceber: false });
checar("homologacao: nada", acoesFinanceirasDaNfse({ ...base, ambiente: "homologacao" }), { lancar: false, revisar: false, verContasAReceber: false });
checar("nao autorizada: nada", acoesFinanceirasDaNfse({ ...base, status: "PROCESSANDO" }), { lancar: false, revisar: false, verContasAReceber: false });

// ── 4. Selo "Contas a Receber" da linha ─────────────────────────────────────
checar("faturado em aberto sem titulo: Nao lancado", seloFinanceiroDaNfse(acoesFinanceirasDaNfse(base)), "nao_lancado");
checar("com titulo ativo: o selo da NF-e pelos titulos",
  seloFinanceiroDaNfse(acoesFinanceirasDaNfse({ ...base, titulosAtivos: { qtd: 1, soma: 90 } })), "pelos_titulos");
checar("lancado em parte: pelos titulos (a NF-e mostra Parcialmente lancado)",
  seloFinanceiroDaNfse(acoesFinanceirasDaNfse({ ...base, faturadoEmAberto: { qtd: 2, soma: 180 }, titulosAtivos: { qtd: 1, soma: 90 } })), "pelos_titulos");
checar("sem faturado, homologacao ou nao autorizada: sem selo",
  [seloFinanceiroDaNfse(acoesFinanceirasDaNfse({ ...base, faturadoEmAberto: { qtd: 0, soma: 0 } })),
   seloFinanceiroDaNfse(acoesFinanceirasDaNfse({ ...base, ambiente: "homologacao" })),
   seloFinanceiroDaNfse(acoesFinanceirasDaNfse({ ...base, status: "PENDENTE" }))],
  [null, null, null]);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
