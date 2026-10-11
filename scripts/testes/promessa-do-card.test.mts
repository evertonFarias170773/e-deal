/**
 * "Proximos dias" x "Expedicao do dia": a mesma regra, so a comparacao de data muda.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/promessa-do-card.test.mts
 */
import { promessaNoDia } from "../../src/features/expedicao/lib/promessa-do-card.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  if (JSON.stringify(real) !== JSON.stringify(esperado)) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else console.log(`ok      ${nome}`);
}

const HOJE = "2026-10-11";
const base = { emAberto: true, promessaDia: HOJE, hoje: HOJE, jaSaiu: false };

checar("hoje: igual conta, posterior nao", [promessaNoDia(base, "IGUAL_A_HOJE"), promessaNoDia(base, "POSTERIOR_A_HOJE")], [true, false]);
const amanha = { ...base, promessaDia: "2026-10-12" };
checar("amanha: so o card Proximos dias", [promessaNoDia(amanha, "IGUAL_A_HOJE"), promessaNoDia(amanha, "POSTERIOR_A_HOJE")], [false, true]);
const virada = { ...base, promessaDia: "2027-01-02", hoje: "2026-12-31" };
checar("virada de ano", promessaNoDia(virada, "POSTERIOR_A_HOJE"), true);
const ontem = { ...base, promessaDia: "2026-10-10" };
checar("ontem (atrasado): nenhum dos dois", [promessaNoDia(ontem, "IGUAL_A_HOJE"), promessaNoDia(ontem, "POSTERIOR_A_HOJE")], [false, false]);
checar("sem previsao: nenhum", [promessaNoDia({ ...base, promessaDia: null }, "IGUAL_A_HOJE"), promessaNoDia({ ...base, promessaDia: null }, "POSTERIOR_A_HOJE")], [false, false]);
checar("entregue (fora de aberto): nenhum", [promessaNoDia({ ...amanha, emAberto: false }, "POSTERIOR_A_HOJE"), promessaNoDia({ ...base, emAberto: false }, "IGUAL_A_HOJE")], [false, false]);
checar("ja saiu: nenhum", [promessaNoDia({ ...amanha, jaSaiu: true }, "POSTERIOR_A_HOJE"), promessaNoDia({ ...base, jaSaiu: true }, "IGUAL_A_HOJE")], [false, false]);

// O "prometido hoje" parametrizado e IDENTICO a formula que o service usava antes.
const formulaAntiga = (e: typeof base) => e.emAberto && e.promessaDia === e.hoje && !e.jaSaiu;
let divergiu = 0;
for (const emAberto of [true, false])
  for (const jaSaiu of [true, false])
    for (const promessaDia of [null, "2026-10-10", HOJE, "2026-10-12", "2027-01-01"])
      if (promessaNoDia({ emAberto, jaSaiu, promessaDia, hoje: HOJE }, "IGUAL_A_HOJE") !== formulaAntiga({ emAberto, jaSaiu, promessaDia: promessaDia as string, hoje: HOJE })) divergiu += 1;
checar("IGUAL_A_HOJE nao mudou o card do dia (20 combinacoes)", divergiu, 0);

// Nunca um pedido e do dia e de proximos dias ao mesmo tempo (a data e uma so).
let nos2 = 0;
for (const promessaDia of [null, "2026-10-10", HOJE, "2026-10-12"])
  if (promessaNoDia({ ...base, promessaDia }, "IGUAL_A_HOJE") && promessaNoDia({ ...base, promessaDia }, "POSTERIOR_A_HOJE")) nos2 += 1;
checar("hoje e futuro sao excludentes", nos2, 0);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
