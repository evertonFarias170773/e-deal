/**
 * NF-e viva trava o Valor negociado e o Aplicar recotação (02/11/2026).
 *
 *   node --experimental-strip-types --no-warnings --import ./scripts/testes/_alias-hook.mjs scripts/testes/nf-viva-trava-frete.test.mts
 *
 * Nada vai ao banco: o cliente do Supabase é falso e qualquer escrita derruba o teste.
 * Os dados espelham os pedidos reais (lidos por SELECT em 02/11/2026).
 */
import { readFileSync } from "node:fs";
import { barreiraNfAutorizada } from "@/features/expedicao/services/corrigir-frete-simulacao";
import { gravarValorFreteNegociado } from "@/features/orcamentos/services/valor-frete-negociado";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok" : "FALHOU"} - ${nome}${ok ? "" : `\n   esperado ${JSON.stringify(esperado)}\n   veio     ${JSON.stringify(real)}`}`);
}
const ler = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

type Tabelas = Record<string, unknown[]>;
/** Cliente falso: só leitura. Registra o que foi pedido; escrita lança erro. */
function clienteFalso(tabelas: Tabelas, rpcs: Record<string, unknown> = {}) {
  const chamadas: string[] = [];
  const proibido = (o: string) => () => { throw new Error(`ESCRITA PROIBIDA: ${o}`); };
  return {
    chamadas,
    from(tabela: string) {
      chamadas.push(`from:${tabela}`);
      let linhas = [...(tabelas[tabela] ?? [])] as Record<string, unknown>[];
      const q: Record<string, unknown> = {
        select() { return q; },
        eq(col: string, v: unknown) { linhas = linhas.filter((l) => l[col] === v); return q; },
        maybeSingle: async () => ({ data: linhas[0] ?? null, error: null }),
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: linhas, error: null }).then(ok),
        update: proibido(`update ${tabela}`), insert: proibido(`insert ${tabela}`), delete: proibido(`delete ${tabela}`), upsert: proibido(`upsert ${tabela}`)
      };
      return q;
    },
    async rpc(nome: string) {
      chamadas.push(`rpc:${nome}`);
      return nome in rpcs ? { data: rpcs[nome], error: null } : { data: null, error: { message: "fim do teste" } };
    }
  };
}

// ── A barreira: o que conta como nota viva ──────────────────────────────────
const nota = (id_int: number, status: string, numero_nf: string | null) => ({ id_int, status, numero_nf });
for (const [nome, notas, trava] of [
  ["autorizada com número trava", [nota(1, "AUTORIZADA", "7671")], true],
  ["cancelada não trava", [nota(1, "CANCELADA", "7671")], false],
  ["denegada não trava", [nota(1, "DENEGADA", "7671")], false],
  ["sem nota não trava", [], false],
  ["cancelada + autorizada trava", [nota(1, "CANCELADA", "1"), nota(1, "AUTORIZADA", "2")], true]
] as const) {
  const r = await barreiraNfAutorizada(clienteFalso({ notas_fiscais: [...notas] }) as never, 1);
  checar(`barreira: ${nome}`, r?.motivo ?? null, trava ? "NF_AUTORIZADA" : null);
}

// ── Valor negociado no 24221 (NF-e 7671 autorizada, EM TRANSITO, CIF) ───────
const p24221 = { id_int: 24221, id_cliente: 10224, status_interno: "EM TRANSITO", modalidade_frete: "CIF", valor_frete: 31.27, valor_total: 164.56, is_avulso: false, id_int_pedido_principal: null };
const ator = { uid: "u", nome: "teste", email: "t@t" };
const c24221 = clienteFalso({ propostas: [p24221], notas_fiscais: [nota(24221, "AUTORIZADA", "7671")] });
const r24221 = await gravarValorFreteNegociado(c24221 as never, { idInt: 24221, valorFrete: 40, ator });
checar("24221: Valor negociado recusado pela nota viva", [r24221.ok, (r24221 as { code?: string }).code, (r24221 as { status?: number }).status], [false, "NF_AUTORIZADA", 409]);
checar("24221: mensagem igual à do Corrigir frete", (r24221 as { mensagem?: string }).mensagem?.endsWith("Cancele a nota antes de corrigir o frete."), true);
checar("24221: recusa antes de qualquer conta ou escrita", c24221.chamadas.some((c) => c.startsWith("rpc:")), false);

// Mesmo pedido com a nota cancelada ou denegada: passa da barreira (segue para a conta do total).
for (const st of ["CANCELADA", "DENEGADA"]) {
  const c = clienteFalso({ propostas: [p24221], notas_fiscais: [nota(24221, st, "7671")] });
  const r = await gravarValorFreteNegociado(c as never, { idInt: 24221, valorFrete: 40, ator });
  checar(`24221 com nota ${st}: não trava, segue como hoje`, [(r as { code?: string }).code, c.chamadas.includes("rpc:cc__total_soberano_proposta")], ["FALHA_TOTAL", true]);
}
// Pedido sem nota: passa da barreira, exatamente como antes.
const semNota = clienteFalso({ propostas: [{ ...p24221, id_int: 99 }], notas_fiscais: [] });
const rSem = await gravarValorFreteNegociado(semNota as never, { idInt: 99, valorFrete: 40, ator });
checar("pedido sem nota: Valor negociado segue o caminho de hoje", [(rSem as { code?: string }).code, semNota.chamadas.includes("rpc:cc__total_soberano_proposta")], ["FALHA_TOTAL", true]);

// ── Aplicar recotação no 22269 (NF 41011) e no 24343 (NF 41282) ─────────────
for (const [id, nf] of [[22269, "41011"], [24343, "41282"]] as const) {
  const r = await barreiraNfAutorizada(clienteFalso({ notas_fiscais: [nota(id, "AUTORIZADA", nf)] }) as never, id);
  checar(`${id}: Aplicar recebe a recusa da nota ${nf}`, [r?.motivo, r?.status, r?.mensagem.includes(`NF-e ${nf} autorizada`)], ["NF_AUTORIZADA", 409, true]);
}
const rota = ler("src/app/api/expedicao/recotacao/aplicar/route.ts");
const pos = (t: string) => rota.indexOf(t);
checar("rota aplicar: a barreira da nota vem antes da liberação, da cotação de rede e da RPC", [
  pos("await barreiraNfAutorizada(supabase, idInt)") > 0,
  pos("await barreiraNfAutorizada(supabase, idInt)") < pos(`.from("expedicao_recotacao_liberacoes")`),
  pos("await barreiraNfAutorizada(supabase, idInt)") < pos("cotarOpcoesFretePorEndereco("),
  pos("await barreiraNfAutorizada(supabase, idInt)") < pos(`rpc("exp_aplicar_recotacao"`)
], [true, true, true, true]);
checar("rota aplicar: a regra antiga (só empate barrado) saiu", rota.includes("temNfeAutorizada"), false);

// ── Tela ─────────────────────────────────────────────────────────────────────
const modal = ler("src/features/expedicao/components/DespacharModal.tsx");
checar("modal: Aplicar consulta a nota antes da confirmação de subsídio e da gravação", [
  modal.indexOf("await barreiraNfAutorizada(supabaseNota, pedido.idInt)") > 0,
  modal.indexOf("await barreiraNfAutorizada(supabaseNota, pedido.idInt)") < modal.indexOf("conferirFreteSubsidiado(getSupabaseClient(), pedido.idInt)"),
  modal.includes(`if (pedido.nfStatus === "AUTORIZADA") return false;`)
], [true, true, true]);
const form = ler("src/features/orcamentos/OrcamentoFormPage.tsx");
checar("orçamento: campo do Valor negociado desabilitado com a mensagem da nota", [
  form.includes("|| bloqueioValorNegociadoPorNota !== null}"),
  form.includes("`Valor do frete: ${bloqueioValorNegociadoPorNota}`")
], [true, true]);

if (falhas > 0) { console.log(`\n${falhas} falha(s).`); process.exitCode = 1; } else console.log("\nTudo certo.");
