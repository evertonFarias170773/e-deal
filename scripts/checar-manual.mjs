#!/usr/bin/env node
/**
 * Checagem do manual de uso (docs/manual/).
 *
 * AVISA quando uma ficha do manual pode ter ficado desatualizada. NAO bloqueia:
 * sai sempre com codigo 0. A decisao de atualizar o manual e de quem esta
 * commitando — mudanca so interna nao precisa.
 *
 * DE ONDE VEM A LIGACAO ENTRE CODIGO E FICHA
 *   De cada ficha: a secao "## Arquivos de origem" lista, entre crases, os
 *   arquivos de codigo de onde ela saiu (pasta termina com "/" e vale para
 *   tudo dentro). Nao ha tabela aqui dentro para manter: quem escreve a ficha
 *   diz de onde ela saiu.
 *
 * O QUE ELE AVISA
 *   1. Arquivo de origem de uma ficha alterado, e a ficha nao alterada junto.
 *   2. Arquivo de TELA alterado (.tsx em src/app fora de api, src/features ou
 *      src/components) que nao e origem de nenhuma ficha — tela sem ficha.
 *
 * Uso:
 *   node scripts/checar-manual.mjs            # tudo que mudou na arvore (com e sem stage, e arquivos novos)
 *   node scripts/checar-manual.mjs --staged   # so o que esta no stage (e o que o hook de pre-commit usa)
 *   node scripts/checar-manual.mjs --origens  # confere as listas: caminho que nao existe mais, ficha sem lista
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const PASTA_MANUAL = "docs/manual";
const soStaged = process.argv.includes("--staged");
const conferirOrigens = process.argv.includes("--origens");

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function listarAlterados() {
  const saidas = soStaged
    ? [git(["diff", "--cached", "--name-only", "--diff-filter=ACMRD"])]
    : [
        git(["diff", "--cached", "--name-only", "--diff-filter=ACMRD"]),
        git(["diff", "--name-only", "--diff-filter=ACMRD"]),
        git(["ls-files", "--others", "--exclude-standard"])
      ];
  const arquivos = new Set();
  for (const saida of saidas) {
    for (const linha of saida.split(/\r?\n/)) {
      const caminho = linha.trim().replace(/^"|"$/g, "").replace(/\\/g, "/");
      if (caminho) arquivos.add(caminho);
    }
  }
  return [...arquivos].sort();
}

/** Fichas do manual: tudo em docs/manual/*.md, menos o indice e o modelo. */
function listarFichas() {
  if (!existsSync(PASTA_MANUAL)) return [];
  return readdirSync(PASTA_MANUAL)
    .filter((nome) => nome.endsWith(".md") && nome !== "README.md" && !nome.startsWith("_"))
    .sort();
}

/** Caminhos entre crases nos itens de lista da secao "## Arquivos de origem". */
function origensDaFicha(nome) {
  const texto = readFileSync(`${PASTA_MANUAL}/${nome}`, "utf8");
  const inicio = texto.search(/^## Arquivos de origem\s*$/m);
  if (inicio < 0) return null;
  const resto = texto.slice(inicio).split(/\r?\n/).slice(1);
  const origens = [];
  for (const linha of resto) {
    if (/^## /.test(linha)) break;
    const item = /^\s*[-*]\s+`([^`]+)`/.exec(linha);
    if (item) origens.push(item[1].trim().replace(/\\/g, "/").replace(/^\.\//, ""));
  }
  return origens;
}

const casa = (origem, caminho) => (origem.endsWith("/") ? caminho.startsWith(origem) : caminho === origem);

const ehTela = (caminho) =>
  caminho.endsWith(".tsx") &&
  !caminho.startsWith("src/app/api/") &&
  (caminho.startsWith("src/app/") || caminho.startsWith("src/features/") || caminho.startsWith("src/components/"));

const fichas = listarFichas().map((nome) => ({ nome, origens: origensDaFicha(nome) }));

// ── Modo --origens: as listas ainda apontam para arquivos que existem? ──────
if (conferirOrigens) {
  const linhas = [];
  for (const { nome, origens } of fichas) {
    if (origens === null) {
      linhas.push(`  ${PASTA_MANUAL}/${nome}: sem a secao "## Arquivos de origem"`);
      continue;
    }
    if (origens.length === 0) linhas.push(`  ${PASTA_MANUAL}/${nome}: secao "Arquivos de origem" vazia`);
    for (const origem of origens) {
      if (!existsSync(origem)) linhas.push(`  ${PASTA_MANUAL}/${nome}: nao existe mais -> ${origem}`);
    }
  }
  if (linhas.length > 0) {
    console.warn(`\nAVISO (manual): listas de "Arquivos de origem" a corrigir.\n\n${linhas.join("\n")}\n`);
  } else {
    console.log(`Manual: ${fichas.length} fichas, todas com "Arquivos de origem" apontando para arquivos que existem.`);
  }
  process.exit(0);
}

// ── Modo normal: o que mudou sem a ficha mudar junto ────────────────────────
const alterados = listarAlterados();
const fichasAlteradas = new Set(
  alterados.filter((c) => c.startsWith(`${PASTA_MANUAL}/`) && c.endsWith(".md")).map((c) => c.slice(PASTA_MANUAL.length + 1))
);
const codigoAlterado = alterados.filter((c) => !c.startsWith("docs/"));

/** ficha -> arquivos de origem dela que mudaram, quando a ficha nao mudou. */
const desatualizadas = new Map();
const cobertos = new Set();
for (const caminho of codigoAlterado) {
  for (const { nome, origens } of fichas) {
    if (!origens || !origens.some((origem) => casa(origem, caminho))) continue;
    cobertos.add(caminho);
    if (fichasAlteradas.has(nome)) continue;
    desatualizadas.set(nome, [...(desatualizadas.get(nome) ?? []), caminho]);
  }
}
const telasSemFicha = codigoAlterado.filter((c) => ehTela(c) && !cobertos.has(c));

if (desatualizadas.size === 0 && telasSemFicha.length === 0) process.exit(0);

const linhas = [""];
if (desatualizadas.size > 0) {
  linhas.push("AVISO (manual): arquivo de origem alterado e a ficha do manual nao.");
  linhas.push("Se a mudanca aparece para o usuario (tela, botao, aviso, fluxo ou regra visivel),");
  linhas.push('atualize a ficha e a data de "Ultima revisao" no mesmo commit. Mudanca so interna nao precisa.');
  linhas.push("");
  for (const [nome, arquivos] of [...desatualizadas.entries()].sort()) {
    linhas.push(`  ${PASTA_MANUAL}/${nome}`);
    for (const arquivo of arquivos) linhas.push(`      <- ${arquivo}`);
  }
  linhas.push("");
}
if (telasSemFicha.length > 0) {
  linhas.push("AVISO (manual): arquivo de tela alterado que nao e origem de nenhuma ficha.");
  linhas.push(`Se for tela de uso, crie a ficha a partir de ${PASTA_MANUAL}/_MODELO.md ou acrescente o arquivo`);
  linhas.push('na secao "Arquivos de origem" da ficha que trata dele.');
  linhas.push("");
  for (const tela of telasSemFicha) linhas.push(`  ${tela}`);
  linhas.push("");
}
linhas.push("Este aviso nao bloqueia o commit.");
linhas.push("");
console.warn(linhas.join("\n"));
process.exit(0);
