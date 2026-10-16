/**
 * Barra `.or()` / `.and()` em PATCH/DELETE/upsert cujo retorno (`.select(...)`) nao
 * traz as colunas do filtro.
 *
 *   node --experimental-strip-types scripts/testes/patch-sem-or-em-retorno-estreito.test.mts
 *
 * POR QUE EXISTE (14/10/2026, o "Autorizar e conferir" do 23681)
 *   Em escrita que devolve linhas (`return=representation`), o PostgREST REPETE os
 *   filtros de arvore logica (`or`/`and`) no SELECT EXTERNO:
 *
 *     WITH pgrst_source AS (UPDATE ... WHERE ... RETURNING "t"."id")
 *     SELECT ... FROM (SELECT "t"."id" FROM "pgrst_source" AS "t"
 *                      WHERE ("t"."confirmado" IS NULL OR "t"."confirmado" = $4)) ...
 *
 *   A CTE so tem as colunas do `.select(...)`. Com `.select("id")` e um `.or()` em
 *   `confirmado`, o banco responde 42703: column pagamentos_v2.confirmado does not
 *   exist. Filtro `eq`/`is` simples NAO e repetido. O cliente falso dos testes de
 *   rota nao enxerga esse SQL, entao a regra e conferida aqui, no codigo-fonte.
 *
 * O QUE FAZ
 *   1. Controles: o codigo do bug original e flagrado; as formas corretas nao.
 *   2. Varre src/ e exige zero achados. Lista os PATCH com `or` que existem hoje e
 *      passam por ter o filtro no retorno.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

type Achado = { onde: string; filtro: string; colunasFora: string[]; retorno: string };
type Exame = { achados: Achado[]; examinados: string[] };

/** Conteudo entre o parentese que abre em `abre` e o que o fecha (ciente de aspas). */
function conteudoBalanceado(t: string, abre: number): string | null {
  let prof = 0;
  let aspas: string | null = null;
  for (let i = abre; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === "\\") i++;
      else if (c === aspas) aspas = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") aspas = c;
    else if (c === "(") prof++;
    else if (c === ")") {
      prof--;
      if (prof === 0) return t.slice(abre + 1, i);
    }
  }
  return null;
}

/** `const NOME = "texto"` do arquivo, para resolver `.or(NOME)` e `.select(NOME)`. */
function constantesDe(src: string): Map<string, string> {
  const mapa = new Map<string, string>();
  const re = /const\s+([A-Za-z_]\w*)\s*(?::\s*[\w<>[\]| ]+)?=\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) mapa.set(m[1], m[2].slice(1, -1));
  return mapa;
}

/** O argumento como texto: literal, ou constante do arquivo. `null` se nao der para resolver. */
function resolver(arg: string, constantes: Map<string, string>): string | null {
  const a = arg.trim();
  if (a === "") return "";
  const lit = /^("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`)$/.exec(a);
  if (lit) return a.slice(1, -1).replace(/\$\{[^}]*\}/g, "x");
  if (/^[A-Za-z_]\w*$/.test(a) && constantes.has(a)) return constantes.get(a)!.replace(/\$\{[^}]*\}/g, "x");
  return null;
}

const OPERADORES = "eq|neq|gt|gte|lt|lte|like|ilike|is|in|not|imatch|match|cs|cd|fts|plfts|phfts|wfts";
function colunasDoFiltro(expr: string): string[] {
  const colunas = new Set<string>();
  const re = new RegExp(`(?:^|[,(])\\s*([A-Za-z_][A-Za-z0-9_]*)\\.(?:${OPERADORES})\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr))) colunas.add(m[1]);
  return [...colunas];
}

function colunasDoSelect(expr: string): string[] | "*" {
  const cols: string[] = [];
  let prof = 0;
  let atual = "";
  for (const c of expr) {
    if (c === "(") prof++;
    if (c === ")") prof--;
    if (c === "," && prof === 0) { cols.push(atual); atual = ""; } else atual += c;
  }
  cols.push(atual);
  const nomes = cols.map((c) => c.trim()).filter(Boolean).map((c) => c.replace(/^[A-Za-z_]\w*\s*:\s*/, ""));
  if (nomes.length === 0 || nomes.includes("*")) return "*";
  return nomes.map((n) => n.replace(/[!(].*$/, ""));
}

/** Examina um arquivo: toda cadeia de escrita com `.or(`/`.and(` e `.select(`, e todo `buildRestUrl` com `or:`. */
export function examinar(src: string, arquivo: string): Exame {
  const achados: Achado[] = [];
  const examinados: string[] = [];
  const constantes = constantesDe(src);
  const linhaDe = (i: number) => src.slice(0, i).split("\n").length;

  // --- supabase-js encadeado
  const re = /\.(or|and)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const inicio = src.lastIndexOf(".from(", m.index);
    if (inicio === -1) continue;
    const fimBruto = src.indexOf(";", m.index);
    const cadeia = src.slice(inicio, fimBruto === -1 ? m.index + 800 : fimBruto);
    const escrita = /\.(update|delete|upsert)\(/.exec(cadeia);
    if (!escrita) continue; // leitura: o SELECT externo e o proprio SELECT

    const onde = `${arquivo}:${linhaDe(m.index)}`;
    const argFiltro = conteudoBalanceado(src, m.index + m[0].length - 1);
    const filtro = argFiltro === null ? null : resolver(argFiltro, constantes);

    // o `.select(` que vem DEPOIS da escrita (o que define o retorno)
    let retorno: string | null | undefined;
    const reSel = /\.select\(/g;
    let s: RegExpExecArray | null;
    while ((s = reSel.exec(cadeia))) {
      if (s.index < escrita.index) continue;
      const argSel = conteudoBalanceado(cadeia, s.index + s[0].length - 1);
      retorno = argSel === null ? null : resolver(argSel, constantes);
    }
    if (retorno === undefined) { examinados.push(`${onde} (sem retorno: nada a repetir)`); continue; }

    if (filtro === null || retorno === null) {
      achados.push({ onde, filtro: String(argFiltro), colunasFora: ["(nao foi possivel resolver o filtro ou o retorno)"], retorno: "?" });
      continue;
    }
    const cols = colunasDoSelect(retorno);
    const fora = cols === "*" ? [] : colunasDoFiltro(filtro).filter((c) => !cols.includes(c));
    examinados.push(`${onde} (filtro em ${colunasDoFiltro(filtro).join(", ")}; retorno ${cols === "*" ? "*" : fora.length ? `SEM ${fora.join(", ")}` : "inclui as colunas"})`);
    if (fora.length) achados.push({ onde, filtro, colunasFora: fora, retorno });
  }

  // --- PATCH montado na mao: buildRestUrl("tabela", { ..., or: "(...)", select: "..." })
  const reUrl = /buildRestUrl\(/g;
  while ((m = reUrl.exec(src))) {
    const corpo = conteudoBalanceado(src, m.index + m[0].length - 1);
    if (!corpo) continue;
    const mOr = /\bor:\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`)/.exec(corpo);
    if (!mOr) continue;
    const mSel = /\bselect:\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`)/.exec(corpo);
    const onde = `${arquivo}:${linhaDe(m.index)} (buildRestUrl)`;
    const filtro = mOr[1].slice(1, -1);
    if (!mSel) { examinados.push(`${onde} (sem select)`); continue; }
    const cols = colunasDoSelect(mSel[1].slice(1, -1));
    const fora = cols === "*" ? [] : colunasDoFiltro(filtro).filter((c) => !cols.includes(c));
    examinados.push(`${onde} (filtro em ${colunasDoFiltro(filtro).join(", ")}; retorno ${cols === "*" ? "*" : fora.length ? `SEM ${fora.join(", ")}` : "inclui as colunas"})`);
    if (fora.length) achados.push({ onde, filtro, colunasFora: fora, retorno: mSel[1].slice(1, -1) });
  }
  return { achados, examinados };
}

// ------------------------------------------------------------------ 1. CONTROLES
console.log("== 1. controles: o bug e flagrado, o correto passa ==");
{
  const bug = `
    const { data } = await supabase
      .from("pagamentos_v2")
      .update(payload)
      .eq("id", idCobranca)
      .eq("status", cobranca.status)
      .or("confirmado.is.null,confirmado.eq.false")
      .select("id");`;
  const r = examinar(bug, "bug.ts");
  confere("o codigo do 23681 (.or em confirmado + .select(\"id\")) e flagrado", r.achados.length === 1 && r.achados[0].colunasFora.includes("confirmado"), r);
}
{
  const certo = `
    const { data } = await supabase.from("pagamentos_v2").update(payload).eq("id", i).eq("status", s).eq("confirmado", false).select("id");`;
  confere("a correcao (.eq confirmado false + .select id) passa", examinar(certo, "certo.ts").achados.length === 0);
}
{
  const largo = `
    await supabase.from("pagamentos_v2").update(p).eq("id", i).or("confirmado.is.null,confirmado.eq.false").select("id, confirmado");`;
  confere("or + retorno que TRAZ a coluna passa", examinar(largo, "largo.ts").achados.length === 0);
}
{
  const estrela = `
    await supabase.from("t").update(p).eq("id", i).or("a.is.null,a.eq.1").select();`;
  confere("or + .select() sem lista (todas as colunas) passa", examinar(estrela, "estrela.ts").achados.length === 0);
}
{
  const semRetorno = `
    await supabase.from("t").update(p).eq("id", i).or("a.is.null,a.eq.1");`;
  confere("or sem .select() (retorno minimo) passa", examinar(semRetorno, "sem-retorno.ts").achados.length === 0);
}
{
  const leitura = `
    const { data } = await supabase.from("t").select("id").or("confirmado.is.null,confirmado.eq.false");`;
  confere("or numa LEITURA com select estreito passa (o SELECT externo e o proprio)", examinar(leitura, "leitura.ts").achados.length === 0);
}
{
  const apagar = `
    await supabase.from("t").delete().eq("id", i).or("status.eq.A,status.eq.B").select("id");`;
  confere("DELETE com or fora do retorno e flagrado", examinar(apagar, "apagar.ts").achados.length === 1);
}
{
  const aninhado = `
    await supabase.from("t").update(p).eq("id", i).or("x.is.null,and(status.eq.A,tipo.neq.B)").select("id, status");`;
  const r = examinar(aninhado, "aninhado.ts");
  confere("or com and() aninhado: acha as colunas de dentro (tipo fica fora)", r.achados.length === 1 && r.achados[0].colunasFora.sort().join(",") === "tipo,x", r);
}
{
  const comConstante = `
    const COLUNAS = "id, cep, tipo_endereco";
    const FILTRO = "tipo_endereco.is.null,tipo_endereco.not.ilike.*principal*";
    await client.from("enderecos").update(p).eq("id", id).or(FILTRO).select(COLUNAS).maybeSingle();`;
  confere("constantes do arquivo sao resolvidas (retorno com a coluna: passa)", examinar(comConstante, "const.ts").achados.length === 0);
  const constanteRuim = comConstante.replace("id, cep, tipo_endereco", "id, cep");
  confere("constantes do arquivo sao resolvidas (retorno sem a coluna: flagra)", examinar(constanteRuim, "const-ruim.ts").achados.length === 1);
}
{
  const url = `const url = buildRestUrl("pagamentos_v2", { id: "eq.1", or: "(confirmado.is.null,confirmado.eq.false)", select: "id" });`;
  confere("PATCH montado na mao (buildRestUrl) com or e select estreito e flagrado", examinar(url, "url.ts").achados.length === 1);
  const urlOk = `const url = buildRestUrl("pagamentos_v2", { id: "eq.1", or: "(confirmado.is.null,confirmado.eq.false)", select: "id,confirmado" });`;
  confere("buildRestUrl com a coluna no select passa", examinar(urlOk, "url-ok.ts").achados.length === 0);
}
{
  // 16/10/2026: a marca do sistema antigo (lib/sistema-antigo) nunca gravava.
  // O teste ja acusava; o erro foi publicar sem roda-lo. Fica o caso exato.
  const marca = `
    const { data, error } = await client
      .from("propostas")
      .update({ is_sistema_antigo: novo })
      .eq("id_int", idInt)
      .or("is_avulso.is.null,is_avulso.is.false,valor_total.gt.0")
      .select("id_int");`;
  const r = examinar(marca, "marca.ts");
  confere("a marca do sistema antigo (.or em is_avulso/valor_total + .select(\"id_int\")) e flagrada",
    r.achados.length === 1 && r.achados[0].colunasFora.sort().join(",") === "is_avulso,valor_total", r);
  confere("a etiqueta do caso flagrado diz SEM as colunas (nao \"inclui as colunas\")",
    r.examinados.some((e) => e.includes("SEM is_avulso, valor_total")), r.examinados);
  const corrigida = marca.replace('.select("id_int")', '.select("id_int, is_avulso, valor_total")');
  confere("a correcao (retorno com is_avulso e valor_total) passa", examinar(corrigida, "marca-ok.ts").achados.length === 0);
}
{
  const naoResolvido = `await supabase.from("t").update(p).eq("id", i).or("a.is.null,a.eq.1").select(listaMontadaEmTempoDeExecucao);`;
  confere("retorno que nao da para ler no codigo e flagrado (na duvida, falha)", examinar(naoResolvido, "dinamico.ts").achados.length === 1);
}

// --------------------------------------------------------- 2. O CODIGO DE HOJE
console.log("== 2. o codigo de src/ ==");
{
  const AQUI = path.dirname(fileURLToPath(import.meta.url));
  const RAIZ = path.join(AQUI, "..", "..", "src");
  const arquivos: string[] = [];
  (function andar(d: string) {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) andar(p);
      else if (/\.(ts|tsx)$/.test(n)) arquivos.push(p);
    }
  })(RAIZ);

  const todosAchados: Achado[] = [];
  const todosExaminados: string[] = [];
  for (const arq of arquivos) {
    const src = readFileSync(arq, "utf8");
    if (!/\.(or|and)\(|buildRestUrl\(/.test(src)) continue;
    const rel = path.relative(path.join(AQUI, "..", ".."), arq).replace(/\\/g, "/");
    const r = examinar(src, rel);
    todosAchados.push(...r.achados);
    todosExaminados.push(...r.examinados);
  }
  for (const e of todosExaminados) console.log(`      escrita com or/and examinada: ${e}`);
  confere(`nenhum PATCH/DELETE com or/and em coluna fora do retorno (${arquivos.length} arquivos varridos)`, todosAchados.length === 0, todosAchados);
  // Sem os comentarios: a propria rota explica o erro citando o `.or(...)` antigo.
  const semComentarios = readFileSync(path.join(RAIZ, "app", "api", "cobrancas", "confirmar", "route.ts"), "utf8")
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join(" ");
  confere("a rota de confirmar nao usa mais .or em confirmado", !/\.or\(\s*["'`]confirmado\./.test(semComentarios));
  confere("a rota de confirmar grava com .eq(\"confirmado\", false)", /\.eq\(\s*"confirmado"\s*,\s*false\s*\)/.test(semComentarios));
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
