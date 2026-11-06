/**
 * Registro de recebíveis: o título conta POR COBRANÇA, não por pedido (06/11/2026, pedido 24253).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/registro-recebiveis-por-cobranca.test.mts
 *
 * SEM banco: cliente Supabase falso. Os números do 24253 são os do banco.
 *   A. a regra pura (`tituloOcupaACobranca`);
 *   B. a lista (`getRecebiveisParaRegistro`): o 24253 aparece só com a parte
 *      faturada; quem tem título próprio continua fora; título legado sem
 *      vínculo continua escondendo; a consulta só lê cobrança faturada, então
 *      pedido com boleto normal, sem faturado, nunca entra.
 */
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const url = (arquivo: string) => pathToFileURL(path.join(AQUI, arquivo)).href;
registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@/lib/supabase/client") return { url: url("_supabase-falso.mts"), shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

const { falso } = await import("./_supabase-falso.mts");
const { tituloOcupaACobranca, tituloEstaAtivo } = await import("../../src/features/contas-a-receber/lib/titulo-da-cobranca.ts");
const { getRecebiveisParaRegistro } = await import("../../src/features/contas-a-receber/registro-recebiveis/services/registro-recebiveis.service.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

// ── A. a regra ──────────────────────────────────────────────────────────────
console.log("== A. a regra");
confere("boleto da entrada (24253-B) não ocupa a faturada (24253-C)", !tituloOcupaACobranca({ status: "PAID", id_pagamento: "24253-B" }, "24253-C"));
confere("título da própria cobrança ocupa", tituloOcupaACobranca({ status: "A_VENCER", id_pagamento: "24253-C" }, "24253-C"));
confere("título cancelado não ocupa", !tituloOcupaACobranca({ status: "CANCELADO", id_pagamento: "24253-C" }, "24253-C"));
confere("título legado sem vínculo ocupa todas (conservador, como antes)", tituloOcupaACobranca({ status: "A_VENCER", id_pagamento: null }, "24253-C"));
confere("status nulo conta como ativo (mesmo predicado do índice)", tituloEstaAtivo({ status: null, id_pagamento: "x" }));

// ── B. a lista ──────────────────────────────────────────────────────────────
console.log("== B. a lista do Registro de recebíveis");
const faturada = (id: string, idInt: number, idPagamento: string, valor: number) => ({
  id, id_int: idInt, id_pagamento: idPagamento, id_cliente: 54430, cliente: "CLIENTE", documento: "04464148000138",
  valor, status: "A_VENCER", confirmado: true, tipo_cobranca: "E-FATURADO", empresa: "E3 BRINDES LTDA", id_empresa: 3,
  created_at: "2026-10-28T00:00:00Z", vencimento: "2026-11-30", boleto_enviadoo: false,
  p_qtd_parcelas: 1, p_dias_pra_inicio: 30, p_intervalo: 30, p_valor_entrada: 0
});
falso.zerar();
falso.responder("pagamentos_v2:select", {
  data: [
    faturada("c", 24253, "24253-C", 6719.45),
    faturada("p", 30000, "30000-A", 500), // já tem título próprio
    faturada("l", 30001, "30001-A", 800) // título legado, sem vínculo
  ],
  error: null
});
falso.responder("boletos:select", {
  data: [
    { id_int: 24253, status: "PAID", id_pagamento: "24253-B" },
    { id_int: 30000, status: "A_VENCER", id_pagamento: "30000-A" },
    { id_int: 30001, status: "A_VENCER", id_pagamento: null }
  ],
  error: null
});
const r = await getRecebiveisParaRegistro();
const ids = r.itens.map((i) => i.cobranca.id_pagamento);
confere("sem erro", r.errorMessage === null, r.errorMessage);
confere("24253 aparece só com a parte faturada (24253-C, R$ 6.719,45)", ids.length === 1 && ids[0] === "24253-C" && r.itens[0].cobranca.valor === 6719.45, r.itens.map((i) => [i.cobranca.id_pagamento, i.cobranca.valor]));
confere("faturado com título próprio continua fora", !ids.includes("30000-A"));
confere("faturado com título legado sem vínculo continua fora", !ids.includes("30001-A"));
const consulta = falso.chamadas.find((c) => c.tabela === "pagamentos_v2");
const filtroTipo = consulta?.filtros.find((f) => f[0] === "in" && (f[1] as unknown[])[0] === "tipo_cobranca")?.[1] as unknown[] | undefined;
confere("a consulta só lê cobrança faturada (boleto normal, sem faturado, nunca entra)", JSON.stringify(filtroTipo?.[1]) === JSON.stringify(["E-FATURADO", "E-Faturado"]), filtroTipo);
const consultaBoletos = falso.chamadas.find((c) => c.tabela === "boletos");
confere("os títulos são lidos com o vínculo (id_pagamento)", Boolean(consultaBoletos));

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
