/**
 * Trocar a transportadora abonando a diferença (26/11/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/abono-frete.test.mts
 */
import { readFileSync } from "node:fs";
import { avisoCceDoAbono, podeAbonar, PERMISSAO_TROCAR_ABONANDO } from "../../src/features/expedicao/lib/abono-frete.ts";
import {
  resolverTransportadoraParceira,
  transportadoraPrecisaCorrecao,
  vinculoPeloCardEscolhido
} from "../../src/features/orcamentos/lib/transportadoras-parceiras.ts";
import { categoriaDoServico } from "../../src/features/orcamentos/lib/categoria-frete.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else console.log(`ok      ${nome}`);
}

checar("permissão", PERMISSAO_TROCAR_ABONANDO, "frete.trocar_abonando");
checar("abono só no que encarece e só com permissão", [podeAbonar(21.2, true), podeAbonar(21.2, false), podeAbonar(0, true), podeAbonar(-3, true)], [true, false, false, false]);
checar("aviso da CC-e com uma nota", avisoCceDoAbono(["48876"], "VEPPO")?.startsWith("A NF-e 48876 está autorizada"), true);
checar("aviso da CC-e sem nota", avisoCceDoAbono([], "VEPPO"), null);

// A opção vira cadastro e categoria (o que a rota grava na proposta).
checar("VEPPO -> 120018 / VEPPO", [resolverTransportadoraParceira({ transportadora: "VEPPO", servico: "VEPPO" }), categoriaDoServico("VEPPO", "VEPPO", "CIF")], [120018, "VEPPO"]);
checar("São Miguel -> 120026 / RODOVIARIO",
  [resolverTransportadoraParceira({ transportadora: "Transportadora São Miguel", servico: "SÃO MIGUEL" }), categoriaDoServico("Transportadora São Miguel", "SÃO MIGUEL", "CIF")],
  [120026, "RODOVIARIO"]);

// O card cotado continua SEDEX: sem o abono, o Salvar devolveria o vínculo aos Correios.
const sedex = { transportadora: "Correios SEDEX", servico: "SEDEX" };
checar("Salvar sem abono: card SEDEX volta aos Correios", vinculoPeloCardEscolhido({ modalidade: "CIF", card: sedex, idDaTela: 120018 }), 39975);
checar("Salvar com abono VEPPO: mantém VEPPO", vinculoPeloCardEscolhido({ modalidade: "CIF", card: sedex, idDaTela: 120018, vinculoAbonado: 120018 }), 120018);
checar("abono de outra transportadora não segura um vínculo diferente", vinculoPeloCardEscolhido({ modalidade: "CIF", card: sedex, idDaTela: 808, vinculoAbonado: 120018 }), 39975);
checar("quadro 'Corrigir a transportadora' some com o abono",
  [transportadoraPrecisaCorrecao({ modalidade: "CIF", card: sedex, idVinculo: 120018 }), transportadoraPrecisaCorrecao({ modalidade: "CIF", card: sedex, idVinculo: 120018, vinculoAbonado: 120018 })],
  [true, false]);

const rota = readFileSync("src/app/api/expedicao/recotacao/aplicar/route.ts", "utf8");
checar("rota: abono exige a permissão própria, dispensa liberação e NF-e, e chama a RPC do abono",
  [
    rota.includes("abonar ? PERMISSAO_TROCAR_ABONANDO : \"expedicao.processar\""),
    rota.includes("if (nfViva && !abonar)"),
    rota.includes("const { data: liberacao } = abonar"),
    rota.includes("supabase.rpc(\"exp_aplicar_recotacao_abono\""),
    rota.includes("if (diferenca > 0 && !abonar)")
  ],
  [true, true, true, true, true]);

const migration = readFileSync("supabase/migrations/20261126_frete_trocar_abonando.sql", "utf8");
checar("migration: não grava frete, total, cotação nem pagamentos",
  [
    /UPDATE public\.propostas\s+SET id_transportadora_cliente = p_id_transportadora,\s+categoria_frete = p_categoria_frete\s+WHERE/.test(migration),
    /valor_frete\s*=/.test(migration.split("CREATE OR REPLACE FUNCTION")[1].replace(/v_depois\.valor_frete|v_prop\.valor_frete|SELECT valor_frete/g, "")),
    /cotacao_frete|pagamentos_v2|boletos/.test(migration.replace(/--.*$/gm, ""))
  ],
  [true, false, false]);

const relatorio = readFileSync("src/features/relatorios/definicoes/frete-por-transportadora.ts", "utf8");
checar("relatório: coluna Abonado e custo", [relatorio.includes('{ id: "abonado", titulo: "Abonado", tipo: "moeda" }'), relatorio.includes('.from("expedicao_recotacoes")')], [true, true]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else console.log("\nTudo certo.");
