/**
 * NFS-e: "Total: R$ X" no fim da Descrição do Serviço (12/11/2026, pedido do
 * Everton, caso 25173).
 *
 *   node --experimental-strip-types scripts/testes/nfse-total-na-descricao.test.mts
 *
 * O QUE PROVA
 *   1. O caso 25173 (dois itens, sem frete): a descrição fecha em "Total: R$ 108,50".
 *   2. Com frete: itens, "Frete - R$ x", "Total: R$ itens + frete".
 *   3. Com desconto: um Total só, o da nota, depois do frete (o "Total:" do desconto sai).
 *   4. Sem valor: termina no frete, como antes. A frase de pagamento não volta.
 *   5. Valor editado: a linha Total acompanha, mesmo com a descrição mexida;
 *      sem linha Total, o texto não muda.
 *   6. Conferência: bate passa; não bate recusa; sem linha Total passa; Total ilegível recusa.
 *   7. Janela e rota ligadas: as três portas passam o valor, o Total acompanha o campo,
 *      o Criar rascunho e a rota conferem antes de gravar.
 */
import { readFileSync } from "node:fs";
import { descricaoDosItens } from "../../src/features/nfse/lib/regras-emissao.ts";
import {
  conferirTotalDaDescricao,
  descricaoDaNfse,
  fatorDoDesconto,
  linhaDoTotal,
  trocarTotalDaDescricao,
  valorSugeridoComFrete
} from "../../src/features/nfse/lib/composicao-nfse.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`}`);
}

// ── 1. O caso 25173 ──────────────────────────────────────────────────────────
const itens25173 = [
  { id: 5678, nome: "* Fotos Fornecedor - Valor Unit R$ 15,50", quantidade: 1, valorUnitario: 15.5, subtotal: 15.5 },
  { id: 5679, nome: "* Fotos Fornecedor - Valor Unit R$ 15,50", quantidade: 6, valorUnitario: 15.5, subtotal: 93 }
];
const todos25173 = new Set(itens25173.map((i) => i.id));
const valor25173 = valorSugeridoComFrete(itens25173, todos25173, 108.5, 0);
checar("25173: valor sugerido", valor25173, 108.5);
const desc25173 = descricaoDaNfse(descricaoDosItens(25173, itens25173, { fator: 1, percentualTabelaEspecial: null, temOutroDesconto: false }), 0, valor25173);
checar("25173: descrição",
  desc25173,
  "Pedido 25173\n1 x * Fotos Fornecedor - R$ 15,50 un. - Subtotal R$ 15,50\n6 x * Fotos Fornecedor - R$ 15,50 un. - Subtotal R$ 93,00\nTotal: R$ 108,50");
checar("25173: confere com o valor", conferirTotalDaDescricao(desc25173, 108.5), { ok: true });

// ── 2. Com frete ─────────────────────────────────────────────────────────────
const itensFrete = [{ id: 1, nome: "Ingresso MOBI", quantidade: 100, valorUnitario: 1.5, subtotal: 150 }];
const valorFrete = valorSugeridoComFrete(itensFrete, new Set([1]), 150, 25);
checar("frete: valor", valorFrete, 175);
checar("frete: descrição",
  descricaoDaNfse(descricaoDosItens(1, itensFrete), 25, valorFrete),
  "Pedido 1\n100 x Ingresso MOBI - R$ 1,50 un. - Subtotal R$ 150,00\nFrete - R$ 25,00\nTotal: R$ 175,00");
checar("milhar", linhaDoTotal(21957.5), "Total: R$ 21.957,50");

// ── 3. Com desconto ──────────────────────────────────────────────────────────
const item138 = { id: 3759, nome: "* Horas Tratam de Imagem", quantidade: 1, valorUnitario: 100, subtotal: 100 };
const desconto = { fator: fatorDoDesconto(90, 100), percentualTabelaEspecial: 10, temOutroDesconto: false };
const comDesconto = descricaoDaNfse(descricaoDosItens(23733, [item138], desconto), 25, valorSugeridoComFrete([item138], new Set([3759]), 90, 25));
checar("desconto: um Total só, depois do frete",
  comDesconto,
  "Pedido 23733\n1 x * Horas Tratam de Imagem - R$ 100,00 un. - Subtotal R$ 100,00\nDesconto tabela especial (10%): - R$ 10,00\nFrete - R$ 25,00\nTotal: R$ 115,00");
checar("desconto sem frete: Total da nota",
  descricaoDaNfse(descricaoDosItens(23733, [item138], desconto), 0, 90).split("\n").filter((l) => l.startsWith("Total:")),
  ["Total: R$ 90,00"]);

// ── 4. Sem valor, e sem pagamento ────────────────────────────────────────────
checar("sem valor: termina no frete", descricaoDaNfse(descricaoDosItens(1, itensFrete), 25), "Pedido 1\n100 x Ingresso MOBI - R$ 1,50 un. - Subtotal R$ 150,00\nFrete - R$ 25,00");
checar("sem frase de pagamento nem natureza", /Forma de pagamento|Vencimento|Natureza/i.test(desc25173 + comDesconto), false);

// ── 5. Valor editado ─────────────────────────────────────────────────────────
checar("valor editado: Total novo", trocarTotalDaDescricao(desc25173, 100).split("\n").pop(), "Total: R$ 100,00");
checar("valor editado: o resto não muda", trocarTotalDaDescricao(desc25173, 100).split("\n").slice(0, -1), desc25173.split("\n").slice(0, -1));
const mexida = "Fotos do evento, conforme pedido 25173\nTotal: R$ 108,50\nObrigado";
checar("descrição mexida: troca só a linha Total", trocarTotalDaDescricao(mexida, 120.3), "Fotos do evento, conforme pedido 25173\nTotal: R$ 120,30\nObrigado");
checar("sem linha Total: não muda", trocarTotalDaDescricao("Fotos do evento", 120.3), "Fotos do evento");
checar("valor inválido: não muda", trocarTotalDaDescricao(desc25173, 0), desc25173);

// ── 6. Conferência ───────────────────────────────────────────────────────────
checar("não bate: recusa", conferirTotalDaDescricao(desc25173, 100).ok, false);
checar("não bate: mensagem",
  (conferirTotalDaDescricao(desc25173, 100) as { motivo: string }).motivo,
  'A linha Total da descrição (R$ 108,50) não bate com o Valor da nota (R$ 100,00). Corrija um dos dois ou use "Refazer a partir dos itens".');
checar("sem linha Total: passa", conferirTotalDaDescricao("Fotos do evento", 100), { ok: true });
checar("Total ilegível: recusa", conferirTotalDaDescricao("Itens\nTotal: cento e oito", 108.5).ok, false);
checar("milhar e CRLF: passa", conferirTotalDaDescricao("Itens\r\nTotal: R$ 21.957,50\r\n", 21957.5), { ok: true });
checar("vale a última linha Total", conferirTotalDaDescricao("Total: R$ 1,00\nTotal: R$ 108,50", 108.5), { ok: true });

// ── 7. Janela e rota ─────────────────────────────────────────────────────────
const modal = readFileSync("src/features/nfse/components/GerarNfseModal.tsx", "utf8");
const rota = readFileSync("src/app/api/fiscal/rascunho-nfse/route.ts", "utf8");
checar("janela: abrir passa o sugerido", /freteQueEntraNaNota\(lido\.itens, todos, lido\.freteDoPedido\), sugerido\)\)/.test(modal), true);
checar("janela: marcar item passa o valor", /freteQueEntraNaNota\(contexto\.itens, novo, contexto\.freteDoPedido\),\s*valorDaNota\.ok \? valorDaNota\.valor : null/.test(modal), true);
checar("janela: Refazer passa o valor do campo", /freteNaNota,\s*valorConferido\.ok \? valorConferido\.valor : null/.test(modal), true);
checar("janela: Total acompanha o campo Valor",
  /function mudarValor\(texto: string, mexido: boolean\)[\s\S]{0,250}trocarTotalDaDescricao\(atual, valor\.valor\)/.test(modal) &&
    modal.includes("onChange={(e) => mudarValor(e.target.value, true)}") &&
    modal.includes("onClick={() => mudarValor(sugeridoDaNota"),
  true);
checar("janela: marcar item com descrição mexida troca o Total", modal.includes("trocarTotalDaDescricao(atual, total)"), true);
checar("janela: Criar rascunho confere", /conferirTotalDaDescricao\(desc\.texto, valor\.valor\);\s*if \(!total\.ok\) return setValidacao\(total\.motivo\)/.test(modal), true);
const iConf = rota.indexOf("conferirTotalDaDescricao(descricao.texto, valor.valor)");
checar("rota: confere antes de gravar", iConf > 0 && iConf < rota.indexOf("rpc(\"fn_criar_rascunho_nfse\""), true);
checar("rota: código da recusa", /TOTAL_DIFERENTE_DO_VALOR/.test(rota), true);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
