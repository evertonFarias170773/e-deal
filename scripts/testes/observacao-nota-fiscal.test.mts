/**
 * "Observação para a nota fiscal" (`propostas.obs_nota_fiscal`, 11/11/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/observacao-nota-fiscal.test.mts
 *
 * Caso: pedido 25049, a NF precisa levar o nome do projeto e o número de
 * captação da Rouanet. A regra: a observação vai DEPOIS do que já sai hoje
 * ("Pedido N"), em linha própria, sem apagar nada e sem repetir; o bloco 10
 * (obs_proposta) nunca entra. Limites: NF-e 5.000 (infCpl), NFS-e 2.000 (xInfComp).
 */
import { readFileSync } from "node:fs";
import {
  LIMITE_INFORMACOES_COMPLEMENTARES_NFE,
  LIMITE_INFORMACOES_COMPLEMENTARES_NFSE_NACIONAL,
  complementaresComObservacao,
  conferirTamanhoDaObservacao,
  observacaoJaNoTexto,
  observacaoLimpa,
  tamanhoNoXmlDaNfe
} from "../../src/features/fiscal/lib/observacao-nota-fiscal.ts";
import { LIMITE_INFORMACOES_COMPLEMENTARES_NFSE } from "../../src/features/nfse/lib/composicao-nfse.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`}`);
}

const ROUANET = "Projeto Festival de Inverno - PRONAC 123456 (Lei Rouanet)";

// 1. NF-e: rascunho novo
checar("25049: Pedido N e a observacao na linha de baixo", complementaresComObservacao("Pedido 25049", ROUANET), `Pedido 25049\n${ROUANET}`);
checar("sem observacao: nao muda", complementaresComObservacao("Pedido 25049", ""), "Pedido 25049");
checar("observacao so de espacos: nao muda", complementaresComObservacao("Pedido 25049", "  \n "), "Pedido 25049");
checar("observacao nula: nao muda", complementaresComObservacao("Pedido 25049", null), "Pedido 25049");
checar("nao repete a que ja esta", complementaresComObservacao(`Pedido 25049\n${ROUANET}`, ROUANET), `Pedido 25049\n${ROUANET}`);
checar("nao repete mesmo com espacos diferentes", complementaresComObservacao(`Pedido 25049 ${ROUANET.replace(/ /g, "  ")}`, ROUANET), `Pedido 25049 ${ROUANET.replace(/ /g, "  ")}`);
checar("nao apaga o texto editado", complementaresComObservacao("Pedido 25049 | DIFAL recolhido", ROUANET), `Pedido 25049 | DIFAL recolhido\n${ROUANET}`);
checar("texto vazio: so a observacao", complementaresComObservacao("", ROUANET), ROUANET);
checar("ja no texto", [observacaoJaNoTexto(`Pedido 1\n${ROUANET}`, ROUANET), observacaoJaNoTexto("Pedido 1", ROUANET), observacaoJaNoTexto("Pedido 1", "")], [true, false, true]);

// 2. Limpeza
checar("CRLF vira LF, tab vira espaco, sem bordas", observacaoLimpa("  linha 1\r\nlinha\t2  \r\n"), "linha 1\nlinha 2");
checar("nao texto vira vazio", [observacaoLimpa(null), observacaoLimpa(42)], ["", ""]);

// 3. Limites
checar("NF-e 5.000", LIMITE_INFORMACOES_COMPLEMENTARES_NFE, 5000);
checar("NFS-e igual ao da janela", LIMITE_INFORMACOES_COMPLEMENTARES_NFSE_NACIONAL, LIMITE_INFORMACOES_COMPLEMENTARES_NFSE);
checar("xml da NF-e com endereco", tamanhoNoXmlDaNfe("Pedido 1", "Rua A, 1"), "Pedido 1 | Rua A, 1".length);
checar("xml da NF-e sem endereco", tamanhoNoXmlDaNfe("Pedido 1", ""), 8);
const curto = conferirTamanhoDaObservacao(ROUANET, 25049);
checar("25049: cabe nas duas", [curto.nfe.passou, curto.nfse.passou, curto.nfe.tamanho, curto.nfse.tamanho], [false, false, 13 + ROUANET.length, ROUANET.length]);
const medio = conferirTamanhoDaObservacao("x".repeat(2001), 25049);
checar("2.001: passa so da NFS-e", [medio.nfe.passou, medio.nfse.passou], [false, true]);
const longo = conferirTamanhoDaObservacao("x".repeat(4990), 25049);
checar("4.990: passa das duas (com o Pedido N)", [longo.nfe.passou, longo.nfse.passou], [true, true]);

// 4. Quem usa
const nfe = readFileSync("src/features/nfe/services/nfe.service.ts", "utf8");
checar("NF-e: rascunho novo usa a observacao do pedido", /complementaresComObservacao\(`Pedido \$\{idInt\}`, proposta\.obsNotaFiscal\)/.test(nfe), true);
checar("NF-e: bloco 10 nao entra no rascunho", /informacoes_complementares:[^\n]*observacoes/.test(nfe), false);
const modal = readFileSync("src/features/nfse/components/GerarNfseModal.tsx", "utf8");
checar("NFS-e: janela abre com a observacao", /setInfComp\(observacaoLimpa\(lido\.observacaoParaNota\)\)/.test(modal), true);
checar("NFS-e: bloco 10 nao vai para as complementares", /setInfComp\([^)]*observacaoInterna/.test(modal), false);
const servico = readFileSync("src/features/orcamentos/services/orcamentos.service.ts", "utf8");
checar("proposta: as duas gravacoes levam a coluna", (servico.match(/obs_nota_fiscal: formState\.obsNotaFiscal/g) ?? []).length, 2);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
