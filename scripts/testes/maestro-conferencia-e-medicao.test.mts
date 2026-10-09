/**
 * Maestro: juiz da conferência de assunto com os trechos da ficha, e medição do turno.
 *
 *   src/features/maestro/core/agent/maestro-agent-conferencia.server.ts
 *   src/features/maestro/core/agent/maestro-agent-medicao.ts
 *
 * NÃO TOCA EM BANCO NEM EM MODELO.
 *
 * O QUE PROVA
 *   1. O pedido ao juiz leva os parágrafos da ficha que a resposta usou, dentro
 *      do teto de 4 mil caracteres, nos dois casos que ele barrava por engano:
 *      "onde fica a aba Boletim?" e "posso emitir NFS-e em produção?".
 *   2. A instrução do juiz traz a regra do "não existe / ainda não dá".
 *   3. MAESTRO_CONFERENCIA_TRECHO=off volta ao pedido só com os títulos, sem a regra.
 *   4. Página restrita a administradores não manda trecho.
 *   5. A medição soma tokens e idas de todas as chamadas, e os campos gravados
 *      não levam texto.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/maestro-conferencia-e-medicao.test.mts
 */
import {
  TETO_DOS_TRECHOS,
  conferenciaComTrechoLigada,
  conferirAssuntoDaResposta,
  instrucaoDoJuiz,
  montarPedidoDeConferencia,
  trechosUsadosDaFicha,
} from "../../src/features/maestro/core/agent/maestro-agent-conferencia.server.ts";
import { camposDeMedicao, medicaoDoTurnoLigada, novaMedicao, somarUso } from "../../src/features/maestro/core/agent/maestro-agent-medicao.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok   " : "FALHA"} ${nome}${ok ? "" : `\n        obtido:   ${JSON.stringify(obtido)}\n        esperado: ${JSON.stringify(esperado)}`}`);
}
function comEnv<T>(nome: string, valor: string | undefined, fn: () => T): T {
  const antes = process.env[nome];
  if (valor === undefined) delete process.env[nome]; else process.env[nome] = valor;
  try { return fn(); } finally { if (antes === undefined) delete process.env[nome]; else process.env[nome] = antes; }
}

const BOLETIM = {
  pergunta: "onde fica a aba Boletim do pedido? não acho o botão",
  historico: [],
  paginasLidas: ["proposta-producao-boletim-historico"],
  resposta: "Não existe aba **Boletim** no pedido. O boletim de verdade é a OS, que abre pela tela **Produção**: clique na linha do pedido.",
};
const NFSE = {
  pergunta: "posso emitir NFS-e em produção pelo Vibe?",
  historico: [],
  paginasLidas: ["notas-fiscais"],
  resposta: "Ainda não. Hoje a NFS-e pelo Vibe sai em **HOMOLOGAÇÃO**: é nota de teste, sem valor fiscal. A NFS-e de verdade continua sendo emitida pelo portal nacional.",
};

// ─── 1. Trechos no pedido ao juiz ────────────────────────────────────────────
{
  const pedido = comEnv("MAESTRO_CONFERENCIA_TRECHO", undefined, () => montarPedidoDeConferencia(BOLETIM));
  const trecho = pedido.slice(pedido.indexOf("TRECHOS DA PÁGINA"), pedido.indexOf("RESPOSTA DO ASSISTENTE"));
  checar("boletim: o pedido leva a seção de trechos, antes da resposta", pedido.includes("TRECHOS DA PÁGINA QUE A RESPOSTA USOU:") && trecho.length > 0, true);
  checar("boletim: entre os trechos está a linha que diz que a aba não existe", /Não existe aba \*\*Boletim\*\* no pedido/.test(trecho), true);
  checar("boletim: os trechos cabem no teto", trecho.length <= TETO_DOS_TRECHOS + 200, true);

  const nfse = comEnv("MAESTRO_CONFERENCIA_TRECHO", undefined, () => montarPedidoDeConferencia(NFSE));
  checar("NFS-e: entre os trechos está a linha da homologação", /sai em \*\*HOMOLOGAÇÃO\*\*/.test(nfse.slice(0, nfse.indexOf("RESPOSTA DO ASSISTENTE"))), true);
  checar("NFS-e: a ficha tem 60 mil caracteres e o pedido inteiro fica abaixo de 9 mil", nfse.length < 9_000, true);

  const duas = comEnv("MAESTRO_CONFERENCIA_TRECHO", undefined, () =>
    montarPedidoDeConferencia({ ...BOLETIM, paginasLidas: ["proposta-producao-boletim-historico", "producao", "proposta"] }));
  const soTrechos = duas.slice(duas.indexOf("TRECHOS DA PÁGINA"), duas.indexOf("RESPOSTA DO ASSISTENTE"));
  checar("três páginas lidas: o teto é do total, não de cada uma", soTrechos.length <= TETO_DOS_TRECHOS + 200, true);
}

// ─── 2. A escolha dos trechos ────────────────────────────────────────────────
{
  const ficha = [
    "## Regras",
    "- Não existe aba **Boletim** no pedido. O boletim de verdade é a OS.",
    "- O arquivo do chat pode ter até 10 MB.",
    "## Erros comuns",
    "| \"Arquivo muito grande\" | O anexo passa de 10 MB. | Reduza o arquivo. |",
    "|---|---|---|",
    "### Imprimir a OS",
    "1. Clique em **Imprimir OS** na tela Produção.",
  ].join("\n");
  const t = trechosUsadosDaFicha(ficha, "Não existe aba **Boletim** no pedido.", "onde fica a aba Boletim?");
  checar("entra o parágrafo usado, com o título da seção", t, "[Regras]\n- Não existe aba **Boletim** no pedido. O boletim de verdade é a OS.");
  checar("resposta que não usa a ficha: nenhum trecho", trechosUsadosDaFicha(ficha, "Olá, tudo bem?", "oi"), "");
  const longa = Array.from({ length: 200 }, (_, i) => `- O **Boletim** do pedido ${i} abre pela tela Produção e mostra a ordem de serviço completa.`).join("\n");
  checar("ficha longa: respeita o teto pedido", trechosUsadosDaFicha(longa, "O **Boletim** abre pela tela Produção.", "", 1_000).length <= 1_000, true);
}

// ─── 3. Regra e flag ─────────────────────────────────────────────────────────
{
  const ligada = comEnv("MAESTRO_CONFERENCIA_TRECHO", undefined, () => [conferenciaComTrechoLigada(), /NÃO EXISTE/.test(instrucaoDoJuiz()), /AINDA NÃO DÁ/.test(instrucaoDoJuiz())]);
  checar("ligada por padrão: a instrução traz a regra do não existe / ainda não dá", ligada, [true, true, true]);
  const desligada = comEnv("MAESTRO_CONFERENCIA_TRECHO", "off", () => [
    conferenciaComTrechoLigada(), /NÃO EXISTE/.test(instrucaoDoJuiz()), montarPedidoDeConferencia(BOLETIM).includes("TRECHOS DA PÁGINA"),
  ]);
  checar("MAESTRO_CONFERENCIA_TRECHO=off: sem regra e sem trechos", desligada, [false, false, false]);
  checar("a instrução termina pedindo o JSON, com ou sem a regra",
    [comEnv("MAESTRO_CONFERENCIA_TRECHO", undefined, instrucaoDoJuiz), comEnv("MAESTRO_CONFERENCIA_TRECHO", "off", instrucaoDoJuiz)].map((s) => s.endsWith('"mesma_tarefa":true|false}')), [true, true]);
  const restrita = comEnv("MAESTRO_CONFERENCIA_TRECHO", undefined, () =>
    montarPedidoDeConferencia({ pergunta: "como está o banco?", historico: [], paginasLidas: ["saude-da-infraestrutura"], resposta: "A **Memória de emergência** está em atenção." }));
  checar("página restrita a administradores não manda trecho", restrita.includes("TRECHOS DA PÁGINA"), false);
}

// ─── 4. Medição ──────────────────────────────────────────────────────────────
{
  const m = novaMedicao();
  somarUso(m, { prompt_tokens: 24_000, completion_tokens: 90, prompt_tokens_details: { cached_tokens: 0 } });
  somarUso(m, { prompt_tokens: 31_000, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 23_168 } });
  somarUso(m, undefined); // resposta sem usage: conta a ida
  somarUso(m, { prompt_tokens: "x", completion_tokens: -5 });
  checar("soma de todas as chamadas do turno", m, { idas: 4, entrada: 55_000, saida: 390, cache: 23_168 });
  const campos = camposDeMedicao(m, "gpt-4.1", 5617.4);
  checar("campos gravados no agent_turn", campos, { modelo: "gpt-4.1", tokens_entrada: 55_000, tokens_saida: 390, tokens_cache: 23_168, idas_ao_modelo: 4, tempo_ms: 5617 });
  checar("nenhum campo de texto além do nome do modelo", Object.entries(campos).filter(([k, v]) => typeof v === "string" && k !== "modelo").length, 0);
  checar("ligada por padrão; MAESTRO_MEDICAO_TURNO=off desliga",
    [comEnv("MAESTRO_MEDICAO_TURNO", undefined, medicaoDoTurnoLigada), comEnv("MAESTRO_MEDICAO_TURNO", "off", medicaoDoTurnoLigada)], [true, false]);

  // A chamada do juiz entra na medição pelo aviso de uso.
  const medida = novaMedicao();
  const clienteFalso = { chat: { completions: { create: async () => ({ choices: [{ message: { content: '{"mesma_tarefa":true}' } }], usage: { prompt_tokens: 1_200, completion_tokens: 40 } }) } } };
  const veredito = await conferirAssuntoDaResposta(clienteFalso, "gpt-4.1", BOLETIM, 5_000, (u) => somarUso(medida, u));
  checar("a chamada do juiz é contada", [veredito, medida], ["mesma_tarefa", { idas: 1, entrada: 1_200, saida: 40, cache: 0 }]);
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
