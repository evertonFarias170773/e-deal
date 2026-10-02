/**
 * Maestro: status do pedido exatamente como veio da consulta, ou pelo rótulo de tela.
 *
 *   src/features/maestro/core/agent/maestro-agent-status.ts
 *
 * NÃO TOCA EM BANCO NEM EM MODELO.
 *
 * O QUE PROVA
 *   1. A lista de status do Maestro é a lista oficial: lê o §3 de
 *      docs/business/FLUXO-OFICIAL-STATUS-PROPOSTAS.md e compara, na ordem.
 *   2. O rótulo de cada status é o que o StatusBadge do Vibe mostra
 *      (humanizeStatus), incluindo NOVO_ARTE_APROVADA e AGUARDANDO_ARTE_APROVADA.
 *   3. A resposta REAL de 02/10/2026 — pedido 23071 em REVISAO PRODUCAO, escrito
 *      como "EM PRODUÇÃO" — é apontada, e a defesa final troca pelo status certo.
 *   4. Status certo (cru, com acento ou pelo rótulo de tela) passa.
 *   5. Palavra de status no meio da frase ("aguardando a conferência",
 *      "liberado para produção"), status de cobrança e resposta sem pedido
 *      consultado não disparam.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/maestro-status.test.mts
 */
import { readFileSync } from "node:fs";
import {
  STATUS_LEGADOS,
  STATUS_OFICIAIS,
  TABELA_DE_STATUS,
  coletarStatusDaConsulta,
  correcaoDeStatus,
  corrigirStatusNaResposta,
  extrairStatusDeclarados,
  listaDeStatusParaOPrompt,
  novoStatusConsultados,
  rotuloDoStatus,
  statusDoPedidoParaExibir,
  statusForaDaConsulta,
} from "../../src/features/maestro/core/agent/maestro-agent-status.ts";
import { humanizeStatus } from "../../src/lib/formatters/status.ts";
import { composeStatusEmArte } from "../../src/features/orcamentos/mappers.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok   " : "FALHA"} ${nome}${ok ? "" : `\n        obtido:   ${JSON.stringify(obtido)}\n        esperado: ${JSON.stringify(esperado)}`}`);
}

// ─── 1. A lista é a do documento oficial ─────────────────────────────────────
{
  const doc = readFileSync("docs/business/FLUXO-OFICIAL-STATUS-PROPOSTAS.md", "utf8").replace(/\r\n/g, "\n");
  const secao = doc.slice(doc.indexOf("# 3. Lista Oficial de Status"));
  const bloco = /```text\n([\s\S]*?)\n```/.exec(secao)?.[1] ?? "";
  const doDocumento = bloco.split("\n").map((l) => l.trim()).filter(Boolean);
  checar("o documento oficial lista 21 status", doDocumento.length, 21);
  checar("a lista do Maestro é a do documento, na mesma ordem", [...STATUS_OFICIAIS], doDocumento);
  checar("os *_ARTE_APROVADA estão na lista", ["NOVO_ARTE_APROVADA", "AGUARDANDO_ARTE_APROVADA"].every((s) => (STATUS_OFICIAIS as readonly string[]).includes(s)), true);
  checar("legados reconhecidos, fora da lista oficial", [...STATUS_LEGADOS], ["APROVADO", "RECEBIDO"]);
}

// ─── 2. O rótulo é o da tela ─────────────────────────────────────────────────
{
  checar("cada rótulo é o do StatusBadge (humanizeStatus)",
    TABELA_DE_STATUS.every((l) => l.rotulo === humanizeStatus(l.status)), true);
  // A tabela inteira, por extenso: mudou o formatador das telas, este teste avisa.
  checar("tabela de rótulos", Object.fromEntries(TABELA_DE_STATUS.map((l) => [l.status, l.rotulo])), {
    "NOVO": "Novo",
    "NOVO / EM ARTE": "NOVO / EM ARTE",
    "NOVO_ARTE_APROVADA": "Novo / Arte aprovada",
    "AGUARDANDO": "Aguardando",
    "AGUARDANDO / EM ARTE": "AGUARDANDO / EM ARTE",
    "AGUARDANDO_ARTE_APROVADA": "Aguardando / Arte aprovada",
    "AGUARDANDO / PENDENTE": "AGUARDANDO / PENDENTE",
    "LIBERADO": "LIBERADO",
    "LIBERADO / EM ARTE": "LIBERADO / EM ARTE",
    "CANCELADO": "Cancelado",
    "REVISAO ATENDENTE": "REVISAO ATENDENTE",
    "REVISAO PRODUCAO": "REVISAO PRODUCAO",
    "EM PRODUCAO": "EM PRODUCAO",
    "EM IMPRESSAO": "EM IMPRESSAO",
    "EM IMPRESSAO / PENDENTE": "EM IMPRESSAO / PENDENTE",
    "EM ACABAMENTO": "EM ACABAMENTO",
    "EM ACABAMENTO / PENDENTE": "EM ACABAMENTO / PENDENTE",
    "EXPEDICAO": "Na Expedição",
    "A RETIRAR": "A Retirar",
    "EM TRANSITO": "Em Trânsito",
    "ENTREGUE": "Entregue",
    "APROVADO": "Aprovado",
    "RECEBIDO": "RECEBIDO",
  });
  checar("status desconhecido não vira outro: fica como veio", rotuloDoStatus("STATUS QUE NAO EXISTE"), "STATUS QUE NAO EXISTE");
  checar("em arte: mesmo sufixo das telas", statusDoPedidoParaExibir("AGUARDANDO", true), { status: composeStatusEmArte("AGUARDANDO", true), rotulo: "AGUARDANDO / EM ARTE" });
  checar("arte aprovada: rótulo de tela", statusDoPedidoParaExibir("NOVO_ARTE_APROVADA", false), { status: "NOVO_ARTE_APROVADA", rotulo: "Novo / Arte aprovada" });
  checar("arte aprovada com a arte de volta em andamento", statusDoPedidoParaExibir("AGUARDANDO_ARTE_APROVADA", true).status, "AGUARDANDO / EM ARTE");
  checar("revisão de produção não ganha sufixo", statusDoPedidoParaExibir("REVISAO PRODUCAO", true), { status: "REVISAO PRODUCAO", rotulo: "REVISAO PRODUCAO" });
  checar("sem status → nulo", statusDoPedidoParaExibir(null, false), { status: null, rotulo: null });
  const linha = listaDeStatusParaOPrompt();
  checar("o prompt recebe a lista com os rótulos que diferem",
    [linha.includes("NOVO_ARTE_APROVADA (na tela: Novo / Arte aprovada)"), linha.includes("EXPEDICAO (na tela: Na Expedição)"), linha.includes("REVISAO PRODUCAO ·"), linha.includes("APROVADO")],
    [true, true, true, false]);
}

// ─── 3. A resposta real da 23071 ─────────────────────────────────────────────
/** O que consultar_pedido devolveu para a 23071 (só o que importa aqui). */
const CONSULTA_23071 = {
  ok: true, numero: 23071,
  secoes: {
    situacao: { cliente: "LISITON DOCUMENTOS SEGUROS LTDA", vendedor: "Lisiane Colbeich", status: "REVISAO PRODUCAO", status_na_tela: "REVISAO PRODUCAO", na_fila_de_producao: true, valor_total: 491.69 },
    cobrancas: {
      cobertura: { situacao: "COBERTO_E_CONFIRMADO", status_do_pedido: "REVISAO PRODUCAO" },
      cobrancas: [{ numero_do_pagamento: "23071-A", tipo: "PIX", situacao: "Paga e confirmada pelo financeiro" }],
    },
  },
};
const consultou = (resultado: unknown) => { const c = novoStatusConsultados(); coletarStatusDaConsulta(resultado, c); return c; };
const da23071 = consultou(CONSULTA_23071);
const PEDIDO_23071 = [{ numero: "23071", status: "REVISAO PRODUCAO", rotulo: "REVISAO PRODUCAO" }];

{
  // Texto REAL do loop em 02/10/2026 (pergunta: "qual a situação do 23071?").
  const RESPOSTA_REAL = [
    "Pedido 23071 — LISITON DOCUMENTOS SEGUROS LTDA",
    "",
    "- Situação: EM PRODUÇÃO (já está na fila de produção desde 02/10/2026 às 14:50)",
    "- Valor total: R$ 491,69 (inclui frete SEDEX: R$ 36,69)",
    "- Vendedor: Lisiane Colbeich",
    "- Empresa: E3 Brindes",
    "",
    "Pagamento:",
    "- O valor do pedido está totalmente coberto por cobrança confirmada pelo financeiro.",
    "- Cobrança ativa: R$ 491,69 (PIX), paga e confirmada pelo financeiro em 02/10/2026.",
    "",
    "Resumo: O pedido já está pago, confirmado pelo financeiro e em produção.",
  ].join("\n");

  checar("a consulta devolveu um status da tabela", [...da23071.daTabela], ["REVISAO PRODUCAO"]);
  const errados = statusForaDaConsulta(RESPOSTA_REAL, da23071);
  checar("resposta real: 'EM PRODUÇÃO' não é o status consultado", errados.map((e) => [e.escrito, e.termo, e.forma]), [["EM PRODUÇÃO", "EM PRODUCAO", "rotulo"]]);
  const correcao = correcaoDeStatus(errados, PEDIDO_23071, da23071);
  checar("a correção diz o status certo e o errado", [correcao.includes('"EM PRODUÇÃO"'), correcao.includes("pedido 23071 = REVISAO PRODUCAO")], [true, true]);

  const final = corrigirStatusNaResposta(RESPOSTA_REAL, PEDIDO_23071, da23071);
  checar("defesa final: troca no lugar, sem aviso", [final.trocas, final.aviso], [1, false]);
  checar("defesa final: a linha fica com o status consultado",
    final.texto.split("\n")[2], "- Situação: REVISAO PRODUCAO (já está na fila de produção desde 02/10/2026 às 14:50)");
  checar("depois da troca nada mais é apontado", statusForaDaConsulta(final.texto, da23071), []);

  // A outra forma do mesmo erro, do roteiro com a resposta forçada.
  const OUTRA = "- Status: EM PRODUÇÃO (já está na fila de produção desde 02/10/2026 14:50)\n\nO pedido 23071 está em produção e pago.";
  checar("'Status: EM PRODUÇÃO' e 'está em produção' são apontados",
    statusForaDaConsulta(OUTRA, da23071).map((e) => [e.forma, e.termo]), [["rotulo", "EM PRODUCAO"], ["esta", "EM PRODUCAO"]]);
  checar("defesa final nas duas formas",
    corrigirStatusNaResposta(OUTRA, PEDIDO_23071, da23071).texto,
    "- Status: REVISAO PRODUCAO (já está na fila de produção desde 02/10/2026 14:50)\n\nO pedido 23071 está com o status REVISAO PRODUCAO e pago.");
}

// ─── 4. O status certo passa ─────────────────────────────────────────────────
{
  const passa = (t: string, c = da23071) => statusForaDaConsulta(t, c).length === 0;
  checar("cru", passa("**Status:** REVISAO PRODUCAO (pedido já está na fila de produção)"), true);
  checar("com acento e em minúsculas", passa("Status: Revisão Produção"), true);
  checar("no meio da frase", passa("O pedido 23071 está em REVISAO PRODUCAO, ou seja, já foi liberado para a produção e está na fila."), true);
  checar("'com o status'", passa("O pedido 23071 está com o status REVISAO PRODUCAO."), true);

  const emExpedicao = consultou({ secoes: { situacao: { status: "EXPEDICAO", status_na_tela: "Na Expedição" } } });
  checar("rótulo de tela vale como o cru", [passa("Status: Na Expedição", emExpedicao), passa("Status: EXPEDICAO", emExpedicao), passa("O pedido está na Expedição.", emExpedicao)], [true, true, true]);
  checar("outro status da lista não vale", passa("Status: EM TRANSITO", emExpedicao), false);

  const arteAprovada = consultou({ secoes: { situacao: { status: "AGUARDANDO_ARTE_APROVADA", status_na_tela: "Aguardando / Arte aprovada" } } });
  checar("*_ARTE_APROVADA: cru e rótulo passam",
    [passa("Status: AGUARDANDO_ARTE_APROVADA", arteAprovada), passa("Status: Aguardando / Arte aprovada", arteAprovada)], [true, true]);
  checar("*_ARTE_APROVADA resumido para 'Aguardando' é apontado",
    statusForaDaConsulta("Status: AGUARDANDO (cobrança ativa)", arteAprovada).map((e) => e.termo), ["AGUARDANDO"]);

  const emArte = consultou({ secoes: { situacao: { status: "AGUARDANDO / EM ARTE", status_na_tela: "AGUARDANDO / EM ARTE" } } });
  checar("sufixo EM ARTE: inteiro passa, cortado é apontado",
    [passa("Status: AGUARDANDO / EM ARTE", emArte), passa("Status: Aguardando/Em arte", emArte), passa("Status: AGUARDANDO", emArte)], [true, true, false]);

  const aprovado = consultou({ secoes: { situacao: { status: "APROVADO", status_na_tela: "Aprovado" } } });
  checar("legado APROVADO passa; 'Liberado' no lugar é apontado",
    [passa("Status: APROVADO (proposta avulsa)", aprovado), passa("O pedido está com status APROVADO.", aprovado), passa("Status: Liberado", aprovado)], [true, true, false]);
}

// ─── 5. O que não é declaração de status ─────────────────────────────────────
{
  const aguardando = consultou({ secoes: { situacao: { status: "AGUARDANDO", status_na_tela: "Aguardando" }, cobrancas: { cobrancas: [{ situacao: "Paga pelo cliente, ainda NÃO confirmada pelo financeiro" }, { situacao: "Cancelada" }] } } });
  const TEXTO = [
    "O pedido 22986 está com o status AGUARDANDO.",
    "O cliente já pagou, e o pedido está aguardando a conferência do financeiro.",
    "Assim que o financeiro confirmar, o status passa para LIBERADO e o pedido pode ser liberado para produção.",
    "Ele ainda não foi liberado para produção nem entregue.",
    "- Cobrança 22986-A — Situação: Paga pelo cliente, ainda NÃO confirmada pelo financeiro",
    "- Cobrança 22986-B — Status: Cancelada",
    "Situação financeira: valor pago, aguardando conferência.",
    "O boleto está CANCELADO e a nota fiscal está com status AUTORIZADA.",
  ].join("\n");
  checar("frase solta, próximo status, cobrança, boleto e nota não disparam", statusForaDaConsulta(TEXTO, aguardando).map((e) => e.escrito), []);
  checar("só a primeira linha declara o status do pedido", extrairStatusDeclarados(TEXTO).map((e) => [e.forma, e.termo]), [["frase", "AGUARDANDO"]]);

  const semPedido = novoStatusConsultados();
  coletarStatusDaConsulta({ cotacao: { produto: "Pulseira Triband", total: 871.72 } }, semPedido);
  checar("sem status consultado (cotação, manual, conceito) a trava não se aplica",
    statusForaDaConsulta("Status: EM PRODUCAO significa que a fábrica já começou.", semPedido), []);

  // Contagem por status: as chaves do resultado contam como consultadas.
  const pipeline = consultou({ contagem_por_status_interno: { AGUARDANDO: 5, NOVO: 3 } });
  checar("contagem por status: citar um status contado passa", statusForaDaConsulta("São 5 propostas com status AGUARDANDO.", pipeline), []);

  // Paráfrase: não é da tabela, mas é o status reescrito.
  checar("'Status: Revisão da produção' é apontado como reescrita",
    statusForaDaConsulta("Status: Revisão da produção", da23071).map((e) => [e.escrito, e.parafrase]), [["Revisão da produção", true]]);
  checar("a reescrita é trocada inteira",
    corrigirStatusNaResposta("Status: Revisão da produção (na fila)", PEDIDO_23071, da23071).texto, "Status: REVISAO PRODUCAO (na fila)");

  // Dois pedidos na mesma pergunta: não dá para saber de qual a frase fala → aviso.
  const dois = consultou([CONSULTA_23071, { numero: 23020, secoes: { situacao: { status: "APROVADO", status_na_tela: "Aprovado" } } }]);
  const DOIS = [{ numero: "23071", status: "REVISAO PRODUCAO", rotulo: "REVISAO PRODUCAO" }, { numero: "23020", status: "APROVADO", rotulo: "Aprovado" }];
  const r = corrigirStatusNaResposta("Pedido 23020 — Status: APROVADO\nPedido 23071 — Status: EM PRODUÇÃO", DOIS, dois);
  checar("dois pedidos: não troca no lugar, avisa com o status de cada um",
    [r.trocas, r.aviso, r.texto.includes("pedido 23071 = REVISAO PRODUCAO"), r.texto.includes("pedido 23020 = APROVADO")], [0, true, true, true]);
  const exp = [{ numero: "1", status: "EXPEDICAO", rotulo: "Na Expedição" }];
  checar("um pedido: a troca usa o rótulo de tela",
    corrigirStatusNaResposta("Status: EM TRANSITO", exp, consultou({ secoes: { situacao: { status: "EXPEDICAO" } } })).texto, "Status: Na Expedição");
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
