/**
 * Pedido ENTREGUE não pode ser alterado (02/11/2026).
 *
 *   node --experimental-strip-types --no-warnings --import ./scripts/testes/_alias-hook.mjs scripts/testes/pedido-entregue-trava.test.mts
 *
 * Nada vai ao banco: o cliente do Supabase é falso e qualquer escrita derruba o teste.
 */
import { readFileSync } from "node:fs";
import {
  MENSAGEM_PEDIDO_ENTREGUE,
  recusaPorPedidoEntregue,
  recusaPorPedidoEntreguePelaCobranca,
  statusEhEntregue
} from "@/features/orcamentos/services/pedido-entregue";
import { gravarValorFreteNegociado } from "@/features/orcamentos/services/valor-frete-negociado";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok" : "FALHOU"} - ${nome}${ok ? "" : `\n   esperado ${JSON.stringify(esperado)}\n   veio     ${JSON.stringify(real)}`}`);
}
const ler = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** Cliente falso: só leitura; escrita lança erro. */
function clienteFalso(tabelas: Record<string, Record<string, unknown>[]>, erroEm: string | null = null) {
  const chamadas: string[] = [];
  const proibido = (o: string) => () => {
    throw new Error(`ESCRITA PROIBIDA: ${o}`);
  };
  return {
    chamadas,
    from(tabela: string) {
      chamadas.push(`from:${tabela}`);
      let linhas = [...(tabelas[tabela] ?? [])];
      const q: Record<string, unknown> = {
        select() { return q; },
        eq(col: string, v: unknown) { linhas = linhas.filter((l) => l[col] === v); return q; },
        in() { return q; },
        neq() { return q; },
        order() { return q; },
        limit() { return q; },
        maybeSingle: async () => (erroEm === tabela ? { data: null, error: { message: "falhou" } } : { data: linhas[0] ?? null, error: null }),
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: linhas, error: null }).then(ok),
        update: proibido(`update ${tabela}`),
        insert: proibido(`insert ${tabela}`),
        delete: proibido(`delete ${tabela}`),
        upsert: proibido(`upsert ${tabela}`)
      };
      return q;
    },
    async rpc(nome: string) {
      chamadas.push(`rpc:${nome}`);
      return { data: null, error: { message: "fim do teste" } };
    }
  };
}
const prop = (id_int: number, status_interno: string) => ({ id_int, status_interno });

// ── A regra única ────────────────────────────────────────────────────────────
checar("statusEhEntregue: ENTREGUE (com espaço e minúsculas)", [statusEhEntregue("ENTREGUE"), statusEhEntregue(" entregue ")], [true, true]);
checar("statusEhEntregue: EM TRANSITO, EXPEDICAO, A RETIRAR, NOVO não", ["EM TRANSITO", "EXPEDICAO", "A RETIRAR", "NOVO"].map(statusEhEntregue), [false, false, false, false]);
for (const [st, esperado] of [["ENTREGUE", 409], ["EM TRANSITO", null], ["NOVO", null]] as const) {
  const r = await recusaPorPedidoEntregue(clienteFalso({ propostas: [prop(1, st)] }) as never, 1);
  checar(`status lido do banco ${st}`, r?.httpStatus ?? null, esperado);
}
const rErro = await recusaPorPedidoEntregue(clienteFalso({}, "propostas") as never, 1);
checar("falha de leitura recusa (nunca vira liberado)", rErro?.httpStatus, 500);
checar("mensagem exata", (await recusaPorPedidoEntregue(clienteFalso({ propostas: [prop(1, "ENTREGUE")] }) as never, 1))?.message, MENSAGEM_PEDIDO_ENTREGUE);
const cCob = clienteFalso({ pagamentos_v2: [{ id: "c1", id_int: 22414 }, { id: "c2", id_int: 5 }], propostas: [prop(22414, "ENTREGUE"), prop(5, "EM TRANSITO")] });
checar("pela cobrança: pedido entregue recusa; em trânsito passa", [(await recusaPorPedidoEntreguePelaCobranca(cCob as never, "c1"))?.code, await recusaPorPedidoEntreguePelaCobranca(cCob as never, "c2")], ["PEDIDO_ENTREGUE", null]);

// ── Valor negociado ─────────────────────────────────────────────────────────
const base = { id_cliente: 1, modalidade_frete: "CIF", valor_frete: 10, valor_total: 110, is_avulso: false, id_int_pedido_principal: null };
const ator = { uid: "u", nome: "t", email: "t@t" };
const vEnt = clienteFalso({ propostas: [{ id_int: 24275, status_interno: "ENTREGUE", ...base }], notas_fiscais: [] });
const rv = await gravarValorFreteNegociado(vEnt as never, { idInt: 24275, valorFrete: 20, ator });
checar(
  "Valor negociado em ENTREGUE: recusado com a mensagem, sem conta nem escrita",
  [(rv as { code?: string }).code, (rv as { mensagem?: string }).mensagem, vEnt.chamadas.some((c) => c.startsWith("rpc:"))],
  ["PEDIDO_ENTREGUE", MENSAGEM_PEDIDO_ENTREGUE, false]
);
const vTr = clienteFalso({ propostas: [{ id_int: 7, status_interno: "EM TRANSITO", ...base }], notas_fiscais: [] });
const rt = await gravarValorFreteNegociado(vTr as never, { idInt: 7, valorFrete: 20, ator });
checar("Valor negociado em EM TRANSITO: segue como hoje (chega à conta do total)", [(rt as { code?: string }).code, vTr.chamadas.includes("rpc:cc__total_soberano_proposta")], ["FALHA_TOTAL", true]);

// ── Salvar (saveProposta, roda no navegador) ────────────────────────────────
const { saveProposta } = await import("@/features/orcamentos/services/orcamentos.service");
const sEnt = clienteFalso({ propostas: [prop(22414, "ENTREGUE")] });
const rs = await saveProposta({ id_int: 22414 } as never, sEnt as never, "u", { force: true });
checar("Salvar em ENTREGUE (mesmo com force, caminho do editar-paga): recusado sem gravar", [rs.success, rs.errorMessage, sEnt.chamadas], [false, MENSAGEM_PEDIDO_ENTREGUE, ["from:propostas"]]);
for (const st of ["EM TRANSITO", "NOVO"]) {
  const c = clienteFalso({ propostas: [prop(9, st)] });
  try {
    await saveProposta({ id_int: 9 } as never, c as never, "u");
  } catch {
    // o resto do Salvar não cabe no cliente falso
  }
  checar(`Salvar em ${st}: passa da trava e segue para a checagem de cobranças de sempre`, c.chamadas.slice(0, 2), ["from:propostas", "from:pagamentos_v2"]);
}

// ── Rotas e telas: a trava vem antes de qualquer gravação ou provedor ───────
const antes = (txt: string, a: string, b: string) => txt.indexOf(a) > 0 && txt.indexOf(a) < txt.indexOf(b);
const editarPaga = ler("src/app/api/orcamentos/editar-paga/route.ts");
checar("editar-paga: recusa ENTREGUE pelo status lido do banco, antes do Salvar", [
  antes(editarPaga, "statusEhEntregue(propostaBanco.status_interno)", "await saveProposta("),
  antes(editarPaga, "valor_frete, status_interno\")", "statusEhEntregue(propostaBanco.status_interno)")
], [true, true]);
const usar = ler("src/app/api/cobrancas/usar-credito/route.ts");
checar("usar-credito: recusa antes de inserir a cobrança", antes(usar, "statusEhEntregue(propostaBanco.status_interno)", "    .insert({"), true);
const comb = ler("src/app/api/cobrancas/pagamento-combinado/route.ts");
checar("pagamento-combinado: recusa antes de inserir", antes(comb, "statusEhEntregue(proposta.status_interno)", ".insert([payloadCobrancaCredito])"), true);
for (const [rota, marco] of [["gerar-boleto", ".update(updatePayload)"], ["gerar-pix", "await gerarPixBancoInter("], ["gerar-cartao-asas", "gerarCartaoAsasParaCobranca(supabase, cobrancaId)"]] as const) {
  const t = ler(`src/app/api/cobrancas/${rota}/route.ts`);
  const i = t.indexOf("await recusaPorPedidoEntreguePelaCobranca(");
  checar(`${rota}: recusa pelo pedido da cobrança antes de falar com o provedor`, i > 0 && i < t.lastIndexOf(marco), true);
}
const provider = ler("src/features/cobrancas/CobrancasProvider.tsx");
checar("navegador (CobrancasProvider): confere o banco antes do insert da cobrança", antes(provider, "await recusaPorPedidoEntregue(client, Number(proposta.id_int))", ".insert([payloadInicial])"), true);
const form = ler("src/features/orcamentos/OrcamentoFormPage.tsx");
checar("tela do orçamento: produtos e frete travados, Salvar desabilitado e recusado com a mensagem", [
  form.includes("bloqueioAvulsaPaga ||\n    pedidoEntregueNaTela;"),
  form.includes("isQuotingVeppo || pedidoEntregueNaTela}"),
  form.includes("description: MENSAGEM_PEDIDO_ENTREGUE")
], [true, true, true]);
const painel = ler("src/features/cobrancas/PropostaCobrancaPanel.tsx");
checar("aba Pagamentos: Gerar cobrança desabilitado pelo status da proposta, em toda tela que usa o painel", [
  painel.includes("statusEhEntregue(proposta.status_interno) ? MENSAGEM_PEDIDO_ENTREGUE : null"),
  (painel.match(/Boolean\(bloqueioNovaCobranca\)/g) || []).length
], [true, 2]);

// ── Duplicar e Retrabalho continuam ─────────────────────────────────────────
const dup = ler("src/features/orcamentos/hooks/useDuplicarProposta.tsx");
const svc = ler("src/features/orcamentos/services/orcamentos.service.ts");
const corpoDuplicar = svc.slice(svc.indexOf("export async function duplicarProposta"), svc.indexOf("\nexport ", svc.indexOf("export async function duplicarProposta") + 10));
checar("Duplicar/Retrabalho: hook e duplicarProposta (RPC copiar_proposta_v2) não passam pela trava", [dup.includes("pedido-entregue"), corpoDuplicar.includes("copiar_proposta_v2"), corpoDuplicar.includes("recusaPorPedidoEntregue"), corpoDuplicar.includes("saveProposta(")], [false, true, false, false]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
