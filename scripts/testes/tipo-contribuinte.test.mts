/**
 * Testes da TRADUÇÃO do tipo de contribuinte para o código da SEFAZ.
 *
 * O projeto não tem runner de testes; este arquivo roda sozinho pelo Node, que
 * remove os tipos na hora. O `--import` resolve o alias `@/` (ver _alias-hook.mjs):
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/tipo-contribuinte.test.mts
 *
 * Não toca no banco. Cobre as ONZE grafias que existiam em
 * `clientes.tipo_contribuinte` em 25/08/2026, porque a mesma tabela de
 * tradução está escrita duas vezes — aqui em TypeScript e no SQL de
 * normalização (supabase/manutencao/20260825_tipo_contribuinte_sefaz_e_nota_padrao.sql).
 * Se as duas divergirem, o cadastro e a nota voltam a discordar.
 *
 * Sai com código 1 se algo falhar.
 */
import {
  normalizarTipoContribuinte,
  tipoContribuintePorDocumento,
  OPCOES_TIPO_CONTRIBUINTE
} from "../../src/lib/fiscal/tipo-contribuinte.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else {
    console.log(`ok      ${nome}`);
  }
}

// ── as 11 grafias reais da base, com a contagem de 25/08/2026 ────────────────
checar("ISENTO (64.748 linhas) vira 9", normalizarTipoContribuinte("ISENTO"), "9");
checar("vazio (854 linhas) nao e traduzido", normalizarTipoContribuinte(""), null);
checar("NULL (212 linhas) nao e traduzido", normalizarTipoContribuinte(null), null);
checar("'2' (59 linhas) ja e codigo", normalizarTipoContribuinte("2"), "2");
checar("'2 = Contribuinte isento' (33 linhas) vira 2",
  normalizarTipoContribuinte("2 = Contribuinte isento"), "2");
checar("CONTRIBUINTE (11 linhas) vira 1", normalizarTipoContribuinte("CONTRIBUINTE"), "1");
checar("'Não Contribuinte' (6 linhas) vira 9 — e nao 1",
  normalizarTipoContribuinte("Não Contribuinte"), "9");
checar("'1' (2 linhas) ja e codigo", normalizarTipoContribuinte("1"), "1");
checar("'9 = Não contribuinte' (2 linhas) vira 9",
  normalizarTipoContribuinte("9 = Não contribuinte"), "9");
checar("'2 = Contribuinte isento de inscrição estadual' (1 linha) vira 2",
  normalizarTipoContribuinte("2 = Contribuinte isento de inscrição estadual"), "2");
checar("'1 = Contribuinte ICMS' (1 linha) vira 1",
  normalizarTipoContribuinte("1 = Contribuinte ICMS"), "1");

// ── a ORDEM das regras: o que quebraria se alguém reorganizasse ──────────────
// "Nao Contribuinte" CONTÉM "CONTRIBUINTE"; se a regra genérica viesse antes,
// 6 cadastros não contribuintes seriam declarados contribuintes de ICMS.
checar("sem acento tambem vira 9", normalizarTipoContribuinte("NAO CONTRIBUINTE"), "9");
checar("'9 - Nao Contribuinte' (rotulo do drop) vira 9",
  normalizarTipoContribuinte("9 - Nao Contribuinte"), "9");
// "...isento de inscrição estadual" CONTÉM "CONTRIBUINTE ISENTO", que por sua
// vez contém "CONTRIBUINTE".
checar("isento longo nao cai na regra do CONTRIBUINTE seco",
  normalizarTipoContribuinte("Contribuinte isento de inscricao estadual"), "2");

// ── ruido de digitacao ───────────────────────────────────────────────────────
checar("espaco em volta nao atrapalha", normalizarTipoContribuinte("  isento  "), "9");
checar("caixa baixa nao atrapalha", normalizarTipoContribuinte("contribuinte"), "1");
checar("numero em vez de texto", normalizarTipoContribuinte(9), "9");
checar("grafia desconhecida NAO chuta", normalizarTipoContribuinte("MEI"), null);
checar("undefined nao e traduzido", normalizarTipoContribuinte(undefined), null);

// ── o palpite por documento, que so entra quando o cadastro nao diz nada ─────
checar("CNPJ presume contribuinte ICMS",
  tipoContribuintePorDocumento("12.345.678/0001-90"), "1");
checar("CPF nunca e contribuinte", tipoContribuintePorDocumento("123.456.789-09"), "9");
checar("documento vazio cai em 9", tipoContribuintePorDocumento(""), "9");
checar("documento nulo cai em 9", tipoContribuintePorDocumento(null), "9");

// ── o drop: os mesmos tres codigos no cadastro e na NF ───────────────────────
checar("o drop oferece exatamente 1, 2 e 9",
  OPCOES_TIPO_CONTRIBUINTE.map((o) => o.valor), ["1", "2", "9"]);
checar("todo valor do drop sobrevive a propria traducao",
  OPCOES_TIPO_CONTRIBUINTE.map((o) => normalizarTipoContribuinte(o.valor)), ["1", "2", "9"]);
checar("todo ROTULO do drop tambem traduz de volta para o proprio codigo",
  OPCOES_TIPO_CONTRIBUINTE.map((o) => normalizarTipoContribuinte(o.rotulo)), ["1", "2", "9"]);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
