/**
 * Janela "Gerar NFS-e", conduta — src/features/nfse/lib/janela-nfse.ts
 *
 *   node --experimental-strip-types scripts/testes/nfse-janela-conduta.test.mts
 *
 * O QUE PROVA
 *   1. Homologação emite com UM clique, sem confirmação; produção pede UMA, e o
 *      botão final diz "Emitir em PRODUÇÃO".
 *   2. O aviso de espera: "Aguarde, não clique de novo" e, de 15 s em diante,
 *      "Ainda processando. Não feche nem clique de novo".
 *   3. Falha por tempo ou rede é INCERTA; recusa clara do servidor não é.
 *   4. Depois de uma falha incerta, o que a janela diz vem do estado da nota:
 *      rascunho criado, em análise, autorizada, envio registrado, nada feito.
 *   5. O "Copiar detalhes" leva referência, hora e código, e o erro guardado só
 *      volta para o pedido certo.
 */
import {
  ESPERA_LONGA_MS,
  LIMITE_DA_CHAMADA_MS,
  chaveDoErroGuardado,
  codigoDaFalha,
  depoisDeFalhaAoCriar,
  depoisDeFalhaAoEmitir,
  detalhesDoErro,
  emissaoPedeConfirmacao,
  falhaEhIncerta,
  lerErroGuardado,
  rotuloDoBotaoDeEmitir,
  textoDeEspera,
  type ErroDaJanela
} from "../../src/features/nfse/lib/janela-nfse.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : `\n       obtido:   ${JSON.stringify(obtido)}\n       esperado: ${JSON.stringify(esperado)}`}`);
}

// 1. Confirmação
checar("homologacao: emite com um clique, sem confirmacao", emissaoPedeConfirmacao("homologacao"), false);
checar("producao: pede uma confirmacao", emissaoPedeConfirmacao("producao"), true);
checar("ambiente indefinido: sem confirmacao (a rota de emitir recusa)", emissaoPedeConfirmacao(null), false);
checar(
  "botao que emite: em producao diz PRODUCAO",
  [rotuloDoBotaoDeEmitir("producao", false), rotuloDoBotaoDeEmitir("producao", true), rotuloDoBotaoDeEmitir("homologacao", false), rotuloDoBotaoDeEmitir("homologacao", true), rotuloDoBotaoDeEmitir(null, false)],
  ["Emitir em PRODUÇÃO", "Reenviar em PRODUÇÃO", "Emitir NFS-e", "Reenviar NFS-e", "Emitir NFS-e"]
);

// 2. Espera
checar("espera: ate 15 s", [0, 1000, 14_999].map(textoDeEspera), ["Aguarde, não clique de novo", "Aguarde, não clique de novo", "Aguarde, não clique de novo"]);
checar("espera: de 15 s em diante", [15_000, 60_000].map(textoDeEspera), ["Ainda processando. Não feche nem clique de novo", "Ainda processando. Não feche nem clique de novo"]);
checar("espera: o limite e 15 s", ESPERA_LONGA_MS, 15_000);
checar("espera: emitir tem o maior limite, acima dos 60 s da rota", LIMITE_DA_CHAMADA_MS.emitir > 60_000, true);

// 3. Falha incerta
checar("incerta: tempo esgotado", falhaEhIncerta({ tipo: "sem_resposta", motivo: "tempo" }), true);
checar("incerta: sem rede", falhaEhIncerta({ tipo: "sem_resposta", motivo: "rede" }), true);
checar("incerta: 408, 502, 503 e 504", [408, 502, 503, 504].map((status) => falhaEhIncerta({ tipo: "http", status })), [true, true, true, true]);
checar(
  "certa: o servidor respondeu com recusa",
  [400, 401, 403, 404, 409, 422, 500].map((status) => falhaEhIncerta({ tipo: "http", status })),
  [false, false, false, false, false, false, false]
);
checar(
  "codigo da falha",
  [codigoDaFalha({ tipo: "sem_resposta", motivo: "tempo" }), codigoDaFalha({ tipo: "sem_resposta", motivo: "rede" }), codigoDaFalha({ tipo: "http", status: 409 }, "EMISSAO_EM_ANDAMENTO"), codigoDaFalha({ tipo: "http", status: 502 }, null)],
  ["TEMPO_ESGOTADO", "SEM_REDE", "HTTP_409/EMISSAO_EM_ANDAMENTO", "HTTP_502"]
);

// 4a. Depois de falha incerta ao CRIAR
const rascunho = (ref: string, tentativasEnvio = 0) => ({ ref, situacao: "RASCUNHO" as const, tentativasEnvio });
checar(
  "criar: rascunho novo existe -> foi criado",
  depoisDeFalhaAoCriar(rascunho("NFS-23304-001"), null),
  { mensagem: "A resposta não chegou, mas o rascunho NFS-23304-001 foi criado. Confira e emita por ele.", aconteceu: true, acompanhar: false }
);
checar("criar: sem nota -> nao foi criado, pode tentar de novo", [depoisDeFalhaAoCriar(null, null).aconteceu, /NÃO foi criado/.test(depoisDeFalhaAoCriar(null, null).mensagem)], [false, true]);
checar(
  "criar outro: o rascunho que existe e o de antes -> nao foi criado",
  depoisDeFalhaAoCriar(rascunho("NFS-23304-001"), "NFS-23304-001").aconteceu,
  false
);
checar(
  "criar outro: apareceu um rascunho de outra referencia -> foi criado",
  depoisDeFalhaAoCriar(rascunho("NFS-23304-002"), "NFS-23304-001").aconteceu,
  true
);
checar(
  "criar: pedido ja com nota autorizada",
  depoisDeFalhaAoCriar({ ref: "NFS-1-001", situacao: "AUTORIZADA", numeroNfse: "14" }, null),
  { mensagem: "O pedido já tem a NFS-e nº 14 autorizada.", aconteceu: false, acompanhar: false }
);
checar("criar: pedido com nota em analise -> acompanha", depoisDeFalhaAoCriar({ ref: "NFS-1-001", situacao: "EM_ANALISE" }, null).acompanhar, true);

// 4b. Depois de falha incerta ao EMITIR
const REF = "NFS-23304-001";
checar(
  "emitir: a nota foi autorizada",
  depoisDeFalhaAoEmitir({ ref: REF, situacao: "AUTORIZADA", numeroNfse: "15" }, REF, 0),
  { mensagem: "A resposta não chegou, mas a nota foi AUTORIZADA (NFS-e nº 15).", aconteceu: true, acompanhar: false }
);
checar(
  "emitir: a nota esta em analise -> o envio saiu, acompanha",
  depoisDeFalhaAoEmitir({ ref: REF, situacao: "EM_ANALISE" }, REF, 0),
  { mensagem: "A resposta não chegou, mas o envio saiu: a nota está em análise.", aconteceu: true, acompanhar: true }
);
{
  const r = depoisDeFalhaAoEmitir(rascunho(REF, 1), REF, 0);
  checar("emitir: continua rascunho mas o contador andou -> envio registrado, NAO emitir de novo", [r.aconteceu, r.acompanhar, /NÃO emita de novo/.test(r.mensagem)], [true, true, true]);
}
{
  const r = depoisDeFalhaAoEmitir(rascunho(REF, 2), REF, 2);
  checar("emitir: continua rascunho e o contador parado -> envio nao registrado", [r.aconteceu, r.acompanhar, /NÃO foi registrado/.test(r.mensagem)], [false, false, true]);
}
checar("emitir: a nota registrou erro de envio", depoisDeFalhaAoEmitir({ ref: REF, situacao: "REENVIAR" }, REF, 0).acompanhar, false);
checar("emitir: a nota foi recusada", depoisDeFalhaAoEmitir({ ref: REF, situacao: "ENCERRADA" }, REF, 0).aconteceu, true);
checar("emitir: a releitura trouxe outra nota -> nao afirma nada sobre o envio", depoisDeFalhaAoEmitir(rascunho("NFS-23304-002"), REF, 0).aconteceu, false);
checar("emitir: a releitura nao trouxe nota", depoisDeFalhaAoEmitir(null, REF, 0).acompanhar, false);

// 5. Detalhes do erro e erro guardado
const erro: ErroDaJanela = { etapa: "emitir", mensagem: "A resposta não chegou.", codigo: "TEMPO_ESGOTADO", idInt: 23304, ref: REF, quando: "2026-10-06T22:30:00.000Z" };
checar(
  "detalhes: referencia, hora, codigo, etapa e pedido",
  detalhesDoErro(erro),
  ["Gerar NFS-e — erro", "Pedido: 23304", "Referência da nota: NFS-23304-001", "Etapa: Emitir NFS-e", "Hora: 2026-10-06T22:30:00.000Z", "Código: TEMPO_ESGOTADO", "Mensagem: A resposta não chegou."].join("\n")
);
checar("detalhes: sem nota", detalhesDoErro({ ...erro, etapa: "criar", ref: null }).includes("Referência da nota: (sem nota)"), true);
checar("guardado: a chave e por pedido", chaveDoErroGuardado(23304), "vibe:nfse:erro:23304");
checar("guardado: volta igual para o mesmo pedido", lerErroGuardado(JSON.stringify(erro), 23304), erro);
checar("guardado: de outro pedido nao volta", lerErroGuardado(JSON.stringify(erro), 23248), null);
checar(
  "guardado: vazio, lixo e formato errado sao ignorados",
  [null, "", "{", "[]", JSON.stringify({ idInt: 23304 }), JSON.stringify({ ...erro, etapa: "outra" })].map((bruto) => lerErroGuardado(bruto, 23304)),
  [null, null, null, null, null, null]
);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
