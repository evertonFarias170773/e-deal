/**
 * Gabarito do faturamento do Maestro contra o BANCO REAL — somente leitura.
 *
 * Diferente das outras suítes deste diretório, esta precisa do banco: confere
 * que o cálculo do Maestro (calcularFaturamentoOficial) devolve, para um mês
 * fechado, o MESMO número do card Faturamento do Dashboard.
 *
 * O QUE CONFERE
 *   1. Setembro/2026 = R$ 1.121.100,46 em 1.324 cobranças (gabarito medido em
 *      02/10/2026; antes da correção o Maestro respondia R$ 780.657,05).
 *   2. O total do Maestro é igual à soma, feita agora, da visão que o Dashboard
 *      usa (view_pagamentos_pagos_v2) para o mesmo mês. Esta é a conferência
 *      que continua valendo se um lançamento retroativo mudar o mês.
 *   3. Valor e cobranças por empresa fecham com o total, e o ranking por
 *      vendedor (lido até o fim) soma o mesmo valor.
 *
 * Precisa de NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local.
 * Não grava nada: só SELECT em pagamentos_v2, propostas e na visão.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/maestro-faturamento-gabarito.test.mts [AAAA-MM]
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { calcularFaturamentoOficial } from "../../src/features/maestro/core/simple/maestro-simple-pagamentos.server.ts";

const GABARITO: Record<string, { valor: number; cobrancas: number }> = {
  "2026-09": { valor: 1121100.46, cobrancas: 1324 },
};

const mes = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) ?? "2026-09";
const [ano, m] = mes.split("-").map(Number);
const primeiroDia = `${mes}-01`;
const ultimoDia = new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10);
const proximoMes = new Date(Date.UTC(ano, m, 1)).toISOString();

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l.trim()))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")])
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok   " : "FALHA"} ${nome}${ok ? "" : `\n        obtido:   ${JSON.stringify(obtido)}\n        esperado: ${JSON.stringify(esperado)}`}`);
}
const centavos = (n: number) => Math.round(n * 100) / 100;

// O Dashboard, lido agora: a visão somada para o mês (paginada, por garantia).
let visaoValor = 0;
let visaoCobrancas = 0;
for (let de = 0; ; de += 1000) {
  const { data, error } = await supabase
    .from("view_pagamentos_pagos_v2")
    .select("data, id_empresa, status, total, quantidade")
    .gte("data", primeiroDia)
    .lte("data", ultimoDia)
    .order("data", { ascending: true })
    .order("id_empresa", { ascending: true })
    .order("status", { ascending: true })
    .range(de, de + 999);
  if (error) throw new Error(`visão do Dashboard: ${error.message}`);
  for (const r of data ?? []) {
    visaoValor += Number(r.total ?? 0);
    visaoCobrancas += Number(r.quantidade ?? 0);
  }
  if ((data ?? []).length < 1000) break;
}
visaoValor = centavos(visaoValor);

const r = await calcularFaturamentoOficial(supabase, {
  desde: `${primeiroDia}T00:00:00.000Z`,
  ate: proximoMes,
  periodoLabel: mes,
  agruparPorEmpresa: true,
  agruparPorVendedor: true,
});

console.log(`\nMês ${mes} (${r.dias?.inicio} a ${r.dias?.fim})`);
console.log(`Maestro:   R$ ${r.faturamento.toFixed(2)} em ${r.total_cobrancas} cobranças e ${r.total_propostas} propostas (${r.linhas_lidas} linhas lidas)`);
console.log(`Dashboard: R$ ${visaoValor.toFixed(2)} em ${visaoCobrancas} cobranças\n`);

checar("o Maestro dá o mesmo valor e as mesmas cobranças do Dashboard", [r.faturamento, r.total_cobrancas], [visaoValor, visaoCobrancas]);
checar("a soma linha a linha confere com a visão", r.conferencia?.confere, true);
checar("a leitura foi até o fim (sem aviso de incompleto)", [r.truncado, r.aviso_truncamento], [false, undefined]);
checar("o período é o mês pelo calendário de Brasília",
  r.dias, { inicio: `01/${String(m).padStart(2, "0")}/${ano}`, fim: `${ultimoDia.slice(8, 10)}/${String(m).padStart(2, "0")}/${ano}` });
checar("por empresa: valores e cobranças fecham com o total",
  [centavos((r.por_empresa ?? []).reduce((t, e) => t + e.faturamento, 0)), (r.por_empresa ?? []).reduce((t, e) => t + e.cobrancas, 0)],
  [r.faturamento, r.total_cobrancas]);
checar("por vendedor: lido até o fim, soma o total",
  [centavos((r.por_vendedor ?? []).reduce((t, v) => t + v.faturamento, 0)), (r.por_vendedor ?? []).reduce((t, v) => t + v.cobrancas, 0)],
  [r.faturamento, r.total_cobrancas]);

const gabarito = GABARITO[mes];
if (gabarito) {
  checar(`gabarito de ${mes}: R$ ${gabarito.valor.toFixed(2)} em ${gabarito.cobrancas} cobranças`, [r.faturamento, r.total_cobrancas], [gabarito.valor, gabarito.cobrancas]);
  if (r.faturamento !== gabarito.valor && r.faturamento === visaoValor) {
    console.log("        (o mês mudou depois de medido: o Maestro continua igual ao Dashboard; atualize o gabarito se a mudança for legítima)");
  }
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
