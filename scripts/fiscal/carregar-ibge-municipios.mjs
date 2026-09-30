/**
 * Carrega public.ibge_municipios com a lista OFICIAL do IBGE.
 *
 *   node scripts/fiscal/carregar-ibge-municipios.mjs            (confere e mostra, nao grava)
 *   node scripts/fiscal/carregar-ibge-municipios.mjs --gravar   (grava)
 *
 * Fonte: https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado
 *
 * Antes de gravar, confere: pelo menos 5.570 municipios, as 27 UFs, codigo de 7
 * digitos, UF de 2 letras e nenhuma chave repetida na mesma UF. Falhou uma, nao
 * grava nada. A gravacao e upsert pelo codigo: rodar de novo so atualiza nomes.
 *
 * Precisa de NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (.env.local).
 * A tabela tem RLS sem politica; o service role e o unico que escreve.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });

const FONTE = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado";
const gravar = process.argv.includes("--gravar");

// A MESMA chave da coluna gerada nome_chave (migration 20260930_ibge_municipios).
const DE = "ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ";
const PARA = "AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn";
const chave = (s) =>
  [...String(s)]
    .map((c) => {
      const i = DE.indexOf(c);
      return i >= 0 ? PARA[i] : c;
    })
    .join("")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const resposta = await fetch(FONTE);
if (!resposta.ok) throw new Error(`IBGE respondeu HTTP ${resposta.status}`);
const linhas = (await resposta.json()).map((m) => ({
  codigo_ibge: String(m["municipio-id"]),
  nome: String(m["municipio-nome"] ?? "").trim(),
  uf: String(m["UF-sigla"] ?? "").trim()
}));

const problemas = [];
if (linhas.length < 5570) problemas.push(`so ${linhas.length} municipios`);
const ufs = new Set(linhas.map((l) => l.uf));
if (ufs.size !== 27) problemas.push(`${ufs.size} UFs`);
for (const l of linhas) {
  if (!/^[0-9]{7}$/.test(l.codigo_ibge)) problemas.push(`codigo invalido ${l.codigo_ibge}`);
  if (!/^[A-Z]{2}$/.test(l.uf)) problemas.push(`UF invalida em ${l.codigo_ibge}`);
  if (!l.nome) problemas.push(`nome vazio em ${l.codigo_ibge}`);
}
const vistos = new Map();
for (const l of linhas) {
  const k = `${l.uf}|${chave(l.nome)}`;
  if (vistos.has(k)) problemas.push(`chave repetida ${k}: ${vistos.get(k)} e ${l.codigo_ibge}`);
  vistos.set(k, l.codigo_ibge);
}

console.log(`IBGE: ${linhas.length} municipios, ${ufs.size} UFs`);
if (problemas.length) {
  console.error("NAO GRAVADO. Problemas:\n  " + problemas.slice(0, 20).join("\n  "));
  process.exit(1);
}
if (!gravar) {
  console.log("Conferencia ok. Nada gravado (use --gravar).");
  process.exit(0);
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});
for (let i = 0; i < linhas.length; i += 1000) {
  const lote = linhas.slice(i, i + 1000);
  const { error } = await sb.from("ibge_municipios").upsert(lote, { onConflict: "codigo_ibge" });
  if (error) throw new Error(`lote ${i}: ${error.message}`);
}
const { count, error } = await sb.from("ibge_municipios").select("codigo_ibge", { count: "exact", head: true });
if (error) throw new Error(error.message);
console.log(`Gravado. public.ibge_municipios tem ${count} linhas.`);
