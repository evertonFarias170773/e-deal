/**
 * Total da proposta em centavos exatos — a regra do banco (06/11/2026, pedido 24606).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/total-no-centavo.test.mts
 *
 * SEM banco: os itens são os do banco, copiados à mão; a rota do abono roda com
 * o cliente Supabase falso, que só anota o que seria gravado.
 *   A. a conta: 24606 = 906,26; 22302 = 541,58; 22114 = 1.863,08; sem tabela
 *      especial nada muda (comparado com a soma antiga em centenas de casos);
 *   B. a tela: resumo da carga e da edição, texto do WhatsApp, visualização;
 *   C. a aba Pagamentos: R$ 0,01 em aberto no 24606, e "Abonar diferença" vê saldo;
 *   D. o abono: abona R$ 0,01 e grava total 906,25 — o que a trava do despacho
 *      compara com o pago 906,25 (libera); diferença real de R$ 0,01 continua;
 *   E. quem grava não muda: o salvar segue em `calculateResumo`, e os campos
 *      `semArredondar`, `total` e `totalCents` guardam a conta de antes.
 */
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const url = (arquivo: string) => pathToFileURL(path.join(AQUI, arquivo)).href;
registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@supabase/supabase-js") return { url: url("_supabase-js-falso-com-tipos.mts"), shortCircuit: true };
    if (especificador === "next/server") return { url: url("_next-server-falso-com-tipos.mts"), shortCircuit: true };
    if (especificador === "@/lib/supabase/client") return { url: url("_supabase-falso.mts"), shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const lib = await import("../../src/features/orcamentos/lib/total-no-centavo.ts");
const { calculateResumo, calculateItemSubtotal, buildPropostaInformalText } = await import("../../src/features/orcamentos/orcamento-utils.ts");
const { totaisDaProposta } = await import("../../src/features/orcamentos/lib/total-da-proposta.ts");
const { valoresDaTabelaEspecial } = await import("../../src/features/orcamentos/lib/visualizacao-da-proposta.ts");
const { roundMoney } = await import("../../src/features/cobrancas/cobrancas-utils.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

type Linha = [qtd: number, unit: number, fixo: number];
/** Itens do formulário, como a carga os monta (bruto, bônus e subtotal por item). */
function itensDoForm(linhas: Linha[], bonus: number) {
  return linhas.map(([quantidade, valorUnitario, valorFixo], i) => {
    const base = { quantidade, valorUnitario, valorFixo, variacoesEscolhidas: [] };
    const t = calculateItemSubtotal(base, bonus);
    return {
      ...base,
      id: `i${i}`,
      nome: `Item ${i + 1}`,
      prazo: "3 dias úteis",
      statusItem: "PENDENTE",
      subtotalBruto: t.subtotalBruto,
      acrescimoBonus: t.acrescimoBonus,
      subtotal: t.subtotal,
      pesoTotal: 0
    } as never;
  });
}

// Itens copiados do banco em 06/11/2026.
const P24606: Linha[] = [[885, 0.72, 60], [885, 0.35, 0]];
const P22302: Linha[] = [[105, 3.1, 20], [105, 2.25, 20]];
const P22114: Linha[] = [[6350, 0.27, 40]];

// ── A. a conta ──────────────────────────────────────────────────────────────
console.log("== A. a conta em centavos");
const conta = (linhas: Linha[], bonus: number, frete = 0) =>
  lib.totalNoCentavo({ itens: itensDoForm(linhas, bonus), bonusPercent: bonus, descontoTipo: "VALOR", descontoValor: 0, frete });
{
  const c = conta(P24606, 10);
  confere("24606: bruto 1.006,95, bônus 100,69, total 906,26", c.brutoCentavos === 100695 && c.bonusCentavos === 10069 && c.totalCentavos === 90626, c);
  confere("24606: o resumo fecha (bruto − bônus = total)", c.brutoCentavos - c.bonusCentavos === c.totalCentavos);
}
confere("22302 continua 541,58", conta(P22302, 10).totalCentavos === 54158, conta(P22302, 10));
confere("22114 continua 1.863,08 (com frete 196,30)", conta(P22114, 5, 196.3).totalCentavos === 186308, conta(P22114, 5, 196.3));
confere("a soma antiga dava 906,25 no 24606 (o defeito)", roundMoney(calculateResumo(itensDoForm(P24606, 10), [], 0, "VALOR").valorTotal) === 906.25);
confere("centavosDoValor(906.255) = 90626 (a trava: round do banco)", lib.centavosDoValor(906.255) === 90626);
confere("centavosDoValor de valor com 2 casas não muda", lib.centavosDoValor(541.58) === 54158 && lib.centavosDoValor(0.1 + 0.2) === 30);
{
  // Sem tabela especial e sem meio centavo: a conta nova = a antiga.
  let iguais = 0, total = 0;
  let semente = 7;
  const aleatorio = () => ((semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let n = 0; n < 500; n++) {
    const linhas: Linha[] = Array.from({ length: 1 + Math.floor(aleatorio() * 4) }, () => [
      1 + Math.floor(aleatorio() * 900),
      Math.round(aleatorio() * 5000) / 100,
      Math.round(aleatorio() * 10000) / 100
    ]);
    const frete = Math.round(aleatorio() * 20000) / 100;
    const antigo = roundMoney(calculateResumo(itensDoForm(linhas, 0), [{ id: "f", escolhido: true, valor: frete } as never], 0, "VALOR").valorTotal);
    const novo = lib.totalNoCentavo({ itens: itensDoForm(linhas, 0), bonusPercent: 0, descontoTipo: "VALOR", descontoValor: 0, frete }).totalCentavos / 100;
    total++;
    if (antigo === novo) iguais++;
  }
  confere(`pedido sem tabela especial não muda: ${iguais}/${total} iguais à soma antiga`, iguais === total, { iguais, total });
}
{
  const c = lib.totalNoCentavo({ itens: itensDoForm([[10, 12.5, 0]], 0), bonusPercent: 0, descontoTipo: "PERCENTUAL", descontoValor: 10, frete: 17.43 });
  confere("desconto geral percentual + frete: 125,00 − 12,50 + 17,43 = 129,93; desconto mostrado fecha", c.totalCentavos === 12993 && c.descontoCentavos === 1250, c);
}

// ── B. a tela ───────────────────────────────────────────────────────────────
console.log("== B. a tela e o texto");
{
  const itens = itensDoForm(P24606, 10);
  // Forma da CARGA da proposta (orcamentos.service): bruto = subtotal, bônus 0.
  const somaFlutuante = (itens as Array<{ subtotal: number }>).reduce((t, i) => t + i.subtotal, 0);
  const carga = lib.resumoNoCentavo(
    { subtotalBrutoProdutos: somaFlutuante, acrescimoBonus: 0, subtotalProdutos: somaFlutuante, descontoGeralTipo: "VALOR", descontoGeralValor: 0, descontoGeral: 0, frete: 0, valorTotal: somaFlutuante, pesoTotal: 0, prazoProducao: "", prazoEntrega: "" },
    { itens, bonusPercent: 10 }
  );
  confere("carga: total R$ 906,26", carga.valorTotal === 906.26, carga);
  confere("carga: semArredondar guarda a conta de antes (para NF-e e consolidação)", carga.semArredondar?.valorTotal === somaFlutuante && somaFlutuante !== 906.26);
  // Forma da EDIÇÃO (calculateResumo): bruto e bônus separados.
  const edicao = lib.resumoNoCentavo(calculateResumo(itens, [], 0, "VALOR"), { itens, bonusPercent: lib.bonusPercentDosItens(itens) });
  confere("edição: bruto 1.006,95, bônus 100,69, total 906,26", edicao.subtotalBrutoProdutos === 1006.95 && edicao.acrescimoBonus === 100.69 && edicao.valorTotal === 906.26, edicao);
  confere("bônus lido dos itens = 10%", lib.bonusPercentDosItens(itens) === 10);

  // A moeda sai com espaço não separável (Intl); o teste compara com espaço comum.
  const texto = buildPropostaInformalText({ id_int: 24606, clienteNome: "Cliente", itens, resumo: calculateResumo(itens, [], 0, "VALOR"), formaPagamento: "PIX", bonusPercent: 10, modalidade: "RETIRA" }).replace(/ /g, " ");
  confere("WhatsApp: subtotal bruto 1.006,95", texto.includes("Subtotal bruto R$ 1.006,95"), texto);
  confere("WhatsApp: tabela especial −100,69", texto.includes("-R$ 100,69"));
  confere("WhatsApp: total R$ 906,26", texto.includes("ficou em *R$ 906,26*"));

  const vis = valoresDaTabelaEspecial(itens as never, carga.subtotalProdutos, 10);
  confere("visualização: 1.006,95 − 100,69 = 906,26", vis.mostrar === true && vis.bruto === 1006.95 && vis.desconto === 100.69 && vis.liquido === 906.26, vis);

  // Lista de Pedidos, área do cliente e Lisiton: a conta pelas linhas do banco.
  const linhasBanco = P24606.map(([qtd, valor_unt, fixo]) => ({ qtd, valor_unt, fixo, status_item: "PENDENTE" }));
  const t = totaisDaProposta({ isAvulso: false, valorTotalGravado: 906.255, valor: null, valorFrete: 0, itens: linhasBanco, bonusPercent: 10, descontoGeral: null });
  confere("lista/área do cliente: totalNoCentavo 906,26", t.totalNoCentavo === 906.26, t);
  confere("lista/área do cliente: `total` (gravado pelo lotes-em-massa) fica como era", Math.round(t.total * 100) === 90625, t.total);
  const t22114 = totaisDaProposta({ isAvulso: false, valorTotalGravado: 1863.075, valor: null, valorFrete: 196.3, itens: [{ qtd: 6350, valor_unt: 0.27, fixo: 40, status_item: "PENDENTE" }], bonusPercent: 5, descontoGeral: null });
  confere("22114 pela lista: 1.863,08", t22114.totalNoCentavo === 1863.08, t22114);
}

// ── C. a aba Pagamentos ─────────────────────────────────────────────────────
console.log("== C. aba Pagamentos (a conta de PropostaCobrancaPanel)");
{
  const saldo = (total: number, cobrado: number) => roundMoney(Math.max(roundMoney(total) - roundMoney(cobrado), 0));
  confere("24606: total 906,26 − PIX 906,25 = R$ 0,01 em aberto (Abonar diferença aparece)", saldo(906.26, 906.25) === 0.01);
  confere("22302: 541,58 − 541,58 = 0", saldo(541.58, 541.58) === 0);
  confere("antes: 906,2549999 − 906,25 = 0 (o defeito)", saldo(906.2549999999999, 906.25) === 0);
}

// ── D. o abono e a trava ────────────────────────────────────────────────────
console.log("== D. abono de diferença (rota, com dublê) e a trava do despacho");
const { falso } = await import("./_supabase-falso.mts");
const { POST: abonar } = await import("../../src/app/api/orcamentos/abonar-diferenca/route.ts");
async function rodarAbono(pago: number, itensLinhas: Array<{ valor_sub_total: number }>, bonus: number | null) {
  falso.zerar();
  falso.responder("usuarios:select", { data: { is_admin: true, is_super_adm: false, nome_usuario: "Admin Teste", id_perfil: 1 }, error: null });
  falso.responder("propostas:select", { data: { id_int: 24606, id_cliente: 11406, is_avulso: false, valor_total: 906.255, valor_frete: 0, status_interno: "EXPEDICAO" }, error: null });
  falso.responder("pagamentos_v2:select", { data: [{ id: "p1", valor: pago, status: "PAID", confirmado: true, obs_v2: null, chave_reenvio: null }], error: null });
  falso.responder("produtos_proposta:select", { data: itensLinhas.map((i) => ({ ...i, status_item: "PENDENTE" })), error: null });
  falso.responderEmSequencia("desconto_proposta:select", [
    { data: bonus ? { valor_percentual: bonus } : null, error: null },
    { data: [], error: null }
  ]);
  const req = new Request("http://localhost/api/orcamentos/abonar-diferenca", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token" },
    body: JSON.stringify({ idInt: 24606 })
  });
  const resp = await abonar(req as never);
  const json = (await resp.json()) as Record<string, unknown>;
  const payload = (tabela: string, op: string) => falso.chamadas.find((c) => c.tabela === tabela && c.op === op)?.payload as Record<string, unknown> | Record<string, unknown>[] | undefined;
  return { status: resp.status, json, desconto: payload("desconto_proposta", "insert"), total: payload("propostas", "update") };
}
{
  const r = await rodarAbono(906.25, [{ valor_sub_total: 697.2 }, { valor_sub_total: 309.75 }], 10);
  confere("24606: o abono vê R$ 0,01 e abona", r.status === 200 && r.json.success === true && r.json.valorAbonado === 0.01, r.json);
  const desc = r.desconto as Record<string, unknown> | undefined;
  confere("24606: desconto geral nominal de R$ 0,01", Number(desc?.valor_nominal) === 0.01, desc);
  const tot = r.total as Record<string, unknown> | undefined;
  confere("24606: total gravado pelo abono = 906,25", Number(tot?.valor_total) === 906.25, tot);
  // A trava (exp_saldo_despacho, sem mudança): round(total) − pago, em centavos.
  const travaBloqueia = (total: number, pago: number) => Math.round(lib.centavosDoValor(total)) - Math.round(pago * 100) > 0;
  confere("trava: total 906,25 x pago 906,25 -> libera o despacho", !travaBloqueia(Number(tot?.valor_total), 906.25));
  confere("trava: hoje 906,255 x 906,25 -> bloqueia (o caso)", travaBloqueia(906.255, 906.25));
  confere("trava: diferença real de R$ 0,01 (100,01 x 100,00) continua bloqueando", travaBloqueia(100.01, 100));
}
{
  const r = await rodarAbono(541.58, [{ valor_sub_total: 345.5 }, { valor_sub_total: 256.25 }], 10);
  confere("22302 pago 541,58: nada a abonar", r.status === 400 && /Não há saldo pendente/.test(String(r.json.error)), r.json);
}
{
  const r = await rodarAbono(100, [{ valor_sub_total: 100.01 }], null);
  confere("diferença real de R$ 0,01 sem tabela especial: o abono a enxerga", r.status === 200 && r.json.valorAbonado === 0.01, r.json);
}

// ── E. o salvar não muda ────────────────────────────────────────────────────
console.log("== E. o que é gravado não muda");
{
  const itens = itensDoForm(P24606, 10);
  const doSalvar = calculateResumo(itens, [], 0, "VALOR").valorTotal;
  confere("calculateResumo (a conta do saveProposta) continua a de antes", doSalvar === 906.2549999999999, doSalvar);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
