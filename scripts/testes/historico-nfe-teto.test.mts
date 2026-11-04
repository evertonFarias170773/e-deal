/**
 * Histórico de NF-e (aba Produtos) sem o teto de 1.000 linhas (04/11/2026).
 *
 * O QUE PROVA, por condição, contra a base real (só leitura, chave de serviço):
 *   1. toda nota da leitura direta aparece, inclusive as mais antigas, na
 *      ordem da tela (mais nova primeiro);
 *   2. cada nota que a leitura antiga mostrava continua na MESMA posição e com
 *      os mesmos dados (vendedor, status do pedido, cliente principal, sócio
 *      pagador, nome, fantasia); a forma de cobrança só muda de vazia para
 *      preenchida;
 *   3. as notas que entram vêm com vendedor, status, cliente e sócio pagador da
 *      leitura direta, e a busca da tela as acha por esses campos;
 *   4. a forma de cobrança vem preenchida para toda nota com cobrança;
 *   5. duas leituras seguidas dão o mesmo resultado.
 *
 *   node --experimental-transform-types --no-warnings --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/historico-nfe-teto.test.mts
 *
 * transform-types, não strip-types: desde 64563595 o nfe.service tem uma classe
 * com parameter property (ErroDaRotaBancaria), que o modo strip não carrega.
 */
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado).slice(0, 600)}\n  real:     ${JSON.stringify(real).slice(0, 600)}`);
  } else {
    console.log(`ok      ${nome}`);
  }
}

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const URL_DB = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!URL_DB || !SERVICE) {
  console.log("(pulando: .env.local sem chaves)");
} else {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (alvo: string | URL | Request, init?: RequestInit) => {
    const metodo = (init?.method ?? (alvo instanceof Request ? alvo.method : "GET")).toUpperCase();
    if (metodo !== "GET" && metodo !== "HEAD") throw new Error("TESTE TENTOU ESCREVER: " + String(alvo));
    return fetchOriginal(alvo, init);
  }) as typeof fetch;
  const logOriginal = console.log;
  const silencio = () => { console.log = () => {}; };
  const voz = () => { console.log = logOriginal; };

  const { getNfeReadOnlyList } = await import("../../src/features/nfe/services/nfe.service.ts");
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(URL_DB, SERVICE, { auth: { persistSession: false } });

  silencio();
  const r1 = await getNfeReadOnlyList();
  voz();
  checar("lista veio do banco (não do mock)", r1.source, "supabase");
  const lista = r1.nfeList;

  // Leitura direta INDEPENDENTE (offset, 100 ids por lote).
  async function paginado<T>(montar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
    const linhas: T[] = [];
    for (let de = 0; ; de += 500) {
      const { data, error } = await montar(de, de + 499);
      if (error) throw new Error(JSON.stringify(error));
      linhas.push(...(data ?? []));
      if ((data ?? []).length < 500) break;
    }
    return linhas;
  }
  async function emLotes<T>(ids: number[], montar: (lote: number[]) => PromiseLike<{ data: T[] | null; error: unknown }>) {
    const linhas: T[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await montar(ids.slice(i, i + 100));
      if (error) throw new Error(JSON.stringify(error));
      if ((data ?? []).length >= 1000) throw new Error("lote do teste cortou");
      linhas.push(...(data ?? []));
    }
    return linhas;
  }
  type N = { id: string; id_int: number | null; id_cliente: number | null; created_at: string; numero_nf: string | null };
  const notas = await paginado<N>((de, ate) => db.from("notas_fiscais").select("id,id_int,id_cliente,created_at,numero_nf").order("created_at", { ascending: false }).order("id").range(de, ate));
  const { count } = await db.from("notas_fiscais").select("id", { count: "exact", head: true });
  checar("leitura direta tem a contagem exata", notas.length, count);
  console.log(`\n>>> notas na base: ${notas.length}; na lista: ${lista.length}\n`);

  // 1. Todas, na ordem.
  checar("toda nota da leitura direta aparece, na ordem da tela", lista.map((n) => String(n.id)), notas.map((n) => n.id));

  // Dados esperados, lidos direto.
  const idsInt = [...new Set(notas.map((n) => Number(n.id_int)).filter((n) => n > 0))];
  type P = { id_int: number; cliente: string | null; id_cliente: number | null; id_faturado: number | null; vendedor: string | null; status_interno: string | null };
  const props = new Map((await emLotes<P>(idsInt, (l) => db.from("propostas").select("id_int,cliente,id_cliente,id_faturado,vendedor,status_interno").in("id_int", l))).map((p) => [Number(p.id_int), p]));
  type C = { id_int: number; tipo_cobranca: string | null; created_at: string; id: string };
  const cobs = (await emLotes<C>(idsInt, (l) => db.from("pagamentos_v2").select("id,id_int,tipo_cobranca,created_at").in("id_int", l)))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const tipo = new Map<number, string>();
  for (const c of cobs) { const t = String(c.tipo_cobranca ?? "").trim(); if (t) tipo.set(Number(c.id_int), t); }
  const idsCli = [...new Set([...notas.map((n) => Number(n.id_cliente)), ...[...props.values()].map((p) => Number(p.id_faturado))].filter((n) => n > 0))];
  const clis = new Map((await emLotes<{ id_cliente: number; nome: string | null; fantasia: string | null }>(idsCli, (l) => db.from("clientes").select("id_cliente,nome,fantasia").in("id_cliente", l))).map((c) => [Number(c.id_cliente), c]));
  const esperado = (n: N) => {
    const p = props.get(Number(n.id_int));
    const socio = p && p.id_faturado != null && p.id_cliente != null && Number(p.id_faturado) !== Number(p.id_cliente)
      ? ((clis.get(Number(p.id_faturado))?.fantasia || clis.get(Number(p.id_faturado))?.nome || "").trim() || null)
      : null;
    return {
      vendedor_pedido: p?.vendedor ?? null,
      status_pedido: p?.status_interno ?? null,
      cliente_principal_nome: p?.cliente ?? null,
      cliente_principal_id: p?.id_cliente ?? null,
      socio_pagador_nome: socio,
      tipo_cobranca: tipo.get(Number(n.id_int)) ?? null
    };
  };
  const doModelo = (m: Record<string, unknown>) => ({
    vendedor_pedido: m.vendedor_pedido ?? null,
    status_pedido: m.status_pedido ?? null,
    cliente_principal_nome: m.cliente_principal_nome ?? null,
    cliente_principal_id: m.cliente_principal_id ?? null,
    socio_pagador_nome: m.socio_pagador_nome ?? null,
    tipo_cobranca: m.tipo_cobranca ?? null
  });
  const porId = new Map(lista.map((m) => [String(m.id), m as unknown as Record<string, unknown>]));
  const diverge = notas.filter((n) => JSON.stringify(doModelo(porId.get(n.id) ?? {})) !== JSON.stringify(esperado(n))).map((n) => n.id);
  checar("toda nota com vendedor, status, cliente, sócio e cobrança da leitura direta", diverge, []);

  // 2. As que já apareciam: posição e dados de antes (leitura antiga emulada como era).
  const antigas = (await db.from("notas_fiscais").select("id,id_int,created_at").order("created_at", { ascending: false }).limit(2000)).data as N[];
  checar("a leitura antiga de fato cortava", antigas.length < notas.length, notas.length > 1000);
  checar("cada nota antiga continua na mesma posição", antigas.map((n, i) => String(lista[i]?.id) === n.id).every(Boolean), true);
  const idsAntigos = [...new Set(antigas.map((n) => Number(n.id_int)).filter((n) => n > 0))];
  const propsAntes = (await db.from("propostas").select("id_int,vendedor,status_interno,cliente,id_cliente").in("id_int", idsAntigos)).data ?? [];
  const cobsAntes = (await db.from("pagamentos_v2").select("id_int,tipo_cobranca,created_at").in("id_int", idsAntigos).order("created_at", { ascending: true })).data ?? [];
  const tipoAntes = new Map<number, string>();
  for (const c of cobsAntes as C[]) { const t = String(c.tipo_cobranca ?? "").trim(); if (t) tipoAntes.set(Number(c.id_int), t); }
  const propAntes = new Map((propsAntes as P[]).map((p) => [Number(p.id_int), p]));
  const perdeu = antigas.filter((n) => {
    const m = doModelo(porId.get(n.id) ?? {});
    const p = propAntes.get(Number(n.id_int));
    const antes = { vendedor_pedido: p?.vendedor ?? null, status_pedido: p?.status_interno ?? null, cliente_principal_nome: p?.cliente ?? null, cliente_principal_id: p?.id_cliente ?? null };
    const igual = JSON.stringify([m.vendedor_pedido, m.status_pedido, m.cliente_principal_nome, m.cliente_principal_id]) === JSON.stringify(Object.values(antes));
    const tipoA = tipoAntes.get(Number(n.id_int)) ?? null;
    return !igual || (tipoA !== null && m.tipo_cobranca !== tipoA);
  }).map((n) => n.id);
  checar("nenhuma nota antiga perde vendedor, status, cliente ou forma de cobrança", perdeu, []);
  const preenchidas = antigas.filter((n) => tipoAntes.get(Number(n.id_int)) == null && porId.get(n.id)?.tipo_cobranca);
  console.log(`        notas antigas cuja forma de cobrança vinha vazia e agora vem: ${preenchidas.length}`);
  checar("a leitura antiga das cobranças de fato cortava", cobsAntes.length < cobs.filter((c) => idsAntigos.includes(Number(c.id_int))).length, true);

  // 3. As que entram, e a busca da tela (mesmos campos de NotasFiscaisPage).
  const idsAntigasNotas = new Set(antigas.map((n) => n.id));
  const novas = lista.filter((m) => !idsAntigasNotas.has(String(m.id)));
  checar("as notas que entram são as mais antigas", novas.every((m) => String(m.created_at) <= String(antigas.at(-1)?.created_at)), true);
  const acha = (item: Record<string, unknown>, termo: string) => {
    const s = termo.toLowerCase().trim();
    return [item.numero_nf, item.ref, item.id_cliente, item.nome, item.fantasia, item.socio_pagador_nome, item.cliente_principal_nome, item.vendedor_pedido]
      .some((v) => String(v ?? "").toLowerCase().includes(s));
  };
  const comTudo = novas.filter((m) => m.vendedor_pedido && m.status_pedido && m.cliente_principal_nome);
  checar("há nota antiga com vendedor, status e cliente (a prova não é vazia)", comTudo.length > 0, true);
  const comSocio = novas.find((m) => m.socio_pagador_nome);
  for (const [rotulo, nota, termo] of [
    ["número", novas[novas.length - 1], String(novas[novas.length - 1]?.numero_nf ?? novas[novas.length - 1]?.ref)],
    ["cliente principal", comTudo[0], String(comTudo[0]?.cliente_principal_nome)],
    ["vendedor", comTudo[0], String(comTudo[0]?.vendedor_pedido)],
    ...(comSocio ? [["sócio pagador", comSocio, String(comSocio.socio_pagador_nome)]] : [])
  ] as Array<[string, Record<string, unknown>, string]>) {
    checar(`busca acha nota antiga pelo ${rotulo}`, lista.filter((m) => acha(m as unknown as Record<string, unknown>, termo)).some((m) => m.id === nota.id), true);
  }
  if (!comSocio) console.log("        (nenhuma nota antiga com sócio pagador hoje: busca por sócio coberta pela checagem geral)");

  // 4. Forma de cobrança.
  checar("toda nota com cobrança vem com a forma preenchida", notas.filter((n) => tipo.has(Number(n.id_int)) && !porId.get(n.id)?.tipo_cobranca).map((n) => n.id), []);

  // 5. Duas leituras.
  silencio();
  const r2 = await getNfeReadOnlyList();
  voz();
  checar("duas leituras seguidas iguais", JSON.stringify(r2.nfeList), JSON.stringify(lista));
}

console.log(falhas === 0 ? "\ntudo certo" : `\n${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
