/**
 * "Salvar item" em proposta paga (21/10/2026): a pergunta da diferenca so no Salvar final.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/salvar-item-paga.test.mts
 *
 * Nada vai ao banco. O roteiro da trava e simulado com as MESMAS funcoes que a tela chama, e a
 * estrutura confere que a tela as chama antes de qualquer gravacao.
 */
import { readFileSync } from "node:fs";
import {
  avisoDaDiferencaNaTela,
  salvarItemSoNaTela,
  salvarSemMudancaEmPropostaPaga
} from "../../src/features/orcamentos/lib/salvar-item-paga.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}${ok ? "" : `\n      esperado ${JSON.stringify(esperado)}\n      veio     ${JSON.stringify(real)}`}`);
}

// ---------- a regra
checar("so na tela: edicao de proposta paga", salvarItemSoNaTela({ modo: "edit", propostaPaga: true }), true);
checar("grava como antes: sem pagamento confirmado, ou proposta nova", [salvarItemSoNaTela({ modo: "edit", propostaPaga: false }), salvarItemSoNaTela({ modo: "create", propostaPaga: true })], [false, false]);
checar("aviso a favor do cliente cita o valor e o Salvar", avisoDaDiferencaNaTela(-96).descricao, "Diferença atual: R$ 96,00 a favor do cliente. A decisão sobre a diferença é pedida uma vez, ao clicar em Salvar alterações.");
checar("aviso devedor: saldo a cobrar na aba Pagamentos (a rota nao pergunta)", avisoDaDiferencaNaTela(1234.5).descricao, "Diferença atual: R$ 1.234,50 a cobrar do cliente. Ao clicar em Salvar alterações, ela fica como saldo a cobrar na aba Pagamentos.");
checar("aviso sem diferenca", avisoDaDiferencaNaTela(0.004).titulo, "Item atualizado na tela");
const base = { modo: "edit", propostaPaga: true, formularioSujo: false, lotesPorGravar: false, totalDaTela: 744.27, totalCarregado: 744.27 };
checar("sem mudanca em proposta paga: nao chama a rota", salvarSemMudancaEmPropostaPaga(base), true);
checar("com mudanca (sujo, lotes ou total diferente): chama", [
  salvarSemMudancaEmPropostaPaga({ ...base, formularioSujo: true }),
  salvarSemMudancaEmPropostaPaga({ ...base, lotesPorGravar: true }),
  salvarSemMudancaEmPropostaPaga({ ...base, totalDaTela: 700 }),
  salvarSemMudancaEmPropostaPaga({ ...base, totalCarregado: null })
], [false, false, false, false]);
checar("sem pagamento confirmado: o Salvar segue como antes", salvarSemMudancaEmPropostaPaga({ ...base, propostaPaga: false }), false);

// ---------- o roteiro da trava, com as funcoes da tela
type Rota = { editarPaga: number; perguntas: number; lancamentos: number };
function roteiro(propostaPaga: boolean, pago: number, totais: number[]): Rota {
  const r: Rota = { editarPaga: 0, perguntas: 0, lancamentos: 0 };
  let totalGravado = pago;
  let sujo = false;
  let pendenciaRespondida = false;
  const salvarCompleto = (totalDaTela: number) => {
    // handleSave: sem mudanca em proposta paga, nao chama a rota
    if (salvarSemMudancaEmPropostaPaga({ modo: "edit", propostaPaga, formularioSujo: sujo, lotesPorGravar: false, totalDaTela, totalCarregado: totalGravado })) return;
    r.editarPaga += 1; // a rota grava e abre/ajusta a pendencia
    const diferenca = Math.round((totalDaTela - pago) * 100) / 100;
    if (propostaPaga && diferenca < 0 && !pendenciaRespondida) {
      r.perguntas += 1; // o modal
      r.lancamentos += 1; // a resposta (resolver-diferenca), uma vez
      pendenciaRespondida = true;
    }
    totalGravado = totalDaTela;
    sujo = false;
  };
  for (const t of totais) {
    sujo = true;
    // handleSaveItem: proposta paga fica so na tela
    if (!salvarItemSoNaTela({ modo: "edit", propostaPaga })) salvarCompleto(t);
  }
  const final = totais[totais.length - 1];
  if (sujo) salvarCompleto(final); // "Salvar alterações"
  salvarCompleto(final); // salvar de novo sem mudanca
  return r;
}
checar("paga, total menor: 3 edicoes sem Salvar final = 0 chamadas, 0 perguntas", (() => { const r = roteiro(true, 744.27, [700, 650, 600]); return [r.editarPaga - 1, r.perguntas, r.lancamentos]; })(), [0, 1, 1]);
checar("paga, total menor: o Salvar final faz 1 chamada, 1 pergunta, 1 lancamento; salvar de novo nao chama", roteiro(true, 744.27, [700, 650, 600]), { editarPaga: 1, perguntas: 1, lancamentos: 1 });
checar("paga, total maior: 1 chamada, nenhuma pergunta (regra da rota de 22/07)", roteiro(true, 930, [1000, 1100, 1200]), { editarPaga: 1, perguntas: 0, lancamentos: 0 });
checar("sem pagamento confirmado: cada Salvar item grava como antes (3 + o Salvar final + o de novo)", roteiro(false, 0, [100, 200, 300]).editarPaga, 4);

// ---------- estrutura: a tela chama as regras antes de gravar
const tela = readFileSync(new URL("../../src/features/orcamentos/OrcamentoFormPage.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const itemIni = tela.indexOf("async function handleSaveItem(");
const ramo = tela.indexOf("if (salvarItemSoNaTela({ modo: mode, propostaPaga: isPropostaPagaAtual })) {", itemIni);
checar("handleSaveItem: o ramo da proposta paga vem antes de qualquer gravacao", [
  ramo > itemIni,
  ramo < tela.indexOf("handleSaveRef.current?.()", itemIni),
  ramo < tela.indexOf("itemEmGravacaoRef.current = itemId;", itemIni)
], [true, true, true]);
checar("o ramo so fecha o card e avisa (nada de handleSave, editar-paga ou setDiferencaModal)", (() => {
  const trecho = tela.slice(ramo, tela.indexOf("return;", ramo));
  return [trecho.includes("setOpenItemIds"), trecho.includes("avisoDaDiferencaNaTela"), /handleSave|editar-paga|setDiferencaModal|fetch\(/.test(trecho)];
})(), [true, true, false]);
const saveIni = tela.indexOf("async function handleSave(opcoes");
checar("handleSave: 'sem mudanca' vem antes da chamada a editar-paga", [
  tela.indexOf("salvarSemMudancaEmPropostaPaga({", saveIni) > saveIni,
  tela.indexOf("salvarSemMudancaEmPropostaPaga({", saveIni) < tela.indexOf('fetch("/api/orcamentos/editar-paga"', saveIni)
], [true, true]);
checar("as aberturas fora da edicao seguem iguais (resolver-pendencia e Resolver agora) e o modal e o mesmo", [
  tela.includes('searchParams?.get("resolver-pendencia") === "true"'),
  (tela.match(/setDiferencaModal\(\{\n\s+isOpen: true,/g) ?? []).length
], [true, 3]);
const exp = readFileSync(new URL("../../src/features/expedicao/ExpedicaoPage.tsx", import.meta.url), "utf8");
checar("Expedicao (correcao de frete) nao usa a regra nova", /salvar-item-paga/.test(exp), false);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
