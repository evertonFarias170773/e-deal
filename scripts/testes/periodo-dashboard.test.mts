/**
 * Períodos do Dashboard e do Meu desempenho (src/lib/period.ts), 05/11/2026.
 *
 *   - "Mês anterior": mês fechado anterior, do dia 1 ao último dia.
 *   - O mesmo intervalo dá o mesmo período anterior no preset e no Personalizado.
 *   - Presets rolantes (Hoje, 7 e 30 dias) seguem como antes.
 *   - O Personalizado não aceita o meio da digitação (ano "0026", 31/02).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/periodo-dashboard.test.mts
 */
import { readFileSync } from "node:fs";
import {
  PERIOD_PRESET_LABELS,
  PERIOD_PRESET_VALUES,
  ehDataDoPeriodo,
  previousRange,
  resolveRange,
  type PeriodPreset
} from "../../src/lib/period.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(ok ? `ok      ${nome}` : `FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
}
const r = (inicio: string, fim: string) => ({ inicio, fim });
const anterior = (preset: PeriodPreset, hoje: string, ini = "", fim = "") => previousRange(preset, resolveRange(preset, ini, fim, hoje));

console.log("— Mês anterior —");
checar("na lista, logo depois de Mês atual", PERIOD_PRESET_VALUES.slice(2, 4), ["mes", "mes_ant"]);
checar("rótulo", PERIOD_PRESET_LABELS.mes_ant, "Mês anterior");
checar("em 05/11: 01/10 a 31/10", resolveRange("mes_ant", "", "", "2026-11-05"), r("2026-10-01", "2026-10-31"));
checar("em 15/03: fevereiro inteiro", resolveRange("mes_ant", "", "", "2026-03-15"), r("2026-02-01", "2026-02-28"));
checar("em janeiro: dezembro do ano anterior", resolveRange("mes_ant", "", "", "2026-01-10"), r("2025-12-01", "2025-12-31"));
checar("compara outubro com setembro inteiro", anterior("mes_ant", "2026-11-05"), r("2026-09-01", "2026-09-30"));
checar("compara março com fevereiro inteiro", anterior("mes_ant", "2026-04-02"), r("2026-02-01", "2026-02-28"));

console.log("— Mesmo intervalo, mesma comparação —");
const pares: [PeriodPreset, string][] = [
  ["mes", "2026-11-05"], ["mes", "2026-10-31"], ["mes", "2026-02-28"], ["mes_ant", "2026-11-05"],
  ["tri", "2026-11-05"], ["sem", "2026-11-05"], ["ano", "2026-11-05"], ["ano", "2026-12-31"]
];
for (const [preset, hoje] of pares) {
  const range = resolveRange(preset, "", "", hoje);
  checar(`${preset} em ${hoje} = Personalizado ${range.inicio} a ${range.fim}`,
    previousRange("custom", range), previousRange(preset, range));
}
checar("01/11 a 05/11 compara com 01/10 a 05/10", previousRange("custom", r("2026-11-01", "2026-11-05")), r("2026-10-01", "2026-10-05"));
checar("01/10 a 15/10 compara com 01/09 a 15/09", previousRange("custom", r("2026-10-01", "2026-10-15")), r("2026-09-01", "2026-09-15"));
checar("01/10 a 05/11 (trimestre) compara com 01/07 a 05/08", previousRange("custom", r("2026-10-01", "2026-11-05")), r("2026-07-01", "2026-08-05"));

console.log("— Intervalo fora de ciclo: mesma duração logo antes (como antes) —");
checar("10/10 a 20/10", previousRange("custom", r("2026-10-10", "2026-10-20")), r("2026-09-29", "2026-10-09"));
checar("20/10 a 31/10", previousRange("custom", r("2026-10-20", "2026-10-31")), r("2026-10-08", "2026-10-19"));
checar("Hoje", anterior("hoje", "2026-11-05"), r("2026-11-04", "2026-11-04"));
checar("Últimos 7 dias", anterior("7d", "2026-11-05"), r("2026-10-23", "2026-10-29"));
checar("Últimos 30 dias", anterior("30d", "2026-11-05"), r("2026-09-07", "2026-10-06"));
checar("Mês atual em 07/08 (exemplo antigo)", anterior("mes", "2026-08-07"), r("2026-07-01", "2026-07-07"));

console.log("— Datas do Personalizado —");
checar("ano 0026 não vale", ehDataDoPeriodo("0026-10-01"), false);
checar("31/02 não vale", ehDataDoPeriodo("2026-02-31"), false);
checar("01/10/2026 vale", ehDataDoPeriodo("2026-10-01"), true);
checar("período com ano 0026 cai no mês atual", resolveRange("custom", "0026-11-01", "2026-11-05", "2026-11-05"), r("2026-11-01", "2026-11-05"));

console.log("— Seletor: rascunho e Aplicar —");
const seletor = readFileSync("src/components/common/PeriodSelector.tsx", "utf8");
checar("campos editam o rascunho, não a URL", /onChange=\{\(event\) => setRascunhoIni\(event\.target\.value\)\}/.test(seletor) && /setRascunhoFim\(event\.target\.value\)/.test(seletor), true);
checar("só o Aplicar grava o período", (seletor.match(/onChange\(\{ preset: "custom"/g) ?? []).length, 1);
checar("sem trava de mínimo e máximo entre os campos", /\bmax=\{|\bmin=\{/.test(seletor), false);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
