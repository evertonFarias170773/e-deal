/**
 * /api/admin/infra-saude/route.ts
 *
 * Números da seção "Saúde da infraestrutura" do Dashboard. Só administrador.
 *
 * SEGURANÇA:
 * - JWT via Authorization: Bearer <token>; somente is_admin / is_super_adm
 *   (public.usuarios), no padrão de /api/orcamentos/abonar-diferenca.
 * - A service role fica no servidor: lê o endpoint de métricas da Supabase
 *   (Basic `service_role:<chave>`) e chama `infra_saude_resumo()`, que só a
 *   service_role executa. O navegador recebe só os números.
 *
 * CACHE: a leitura vale 10 minutos por instância do servidor. O endpoint de
 * métricas e a função varrem o banco inteiro; não há por que repetir a cada
 * abertura do Dashboard.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  LIMITES_SAUDE,
  avaliarNivel,
  type BucketSaude,
  type InfraSaude,
  type MetricaSaude
} from "@/features/dashboard/infra-saude";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALIDADE_MS = 10 * 60 * 1000;
let cache: { expiraEm: number; dados: InfraSaude } | null = null;

type Amostra = { nome: string; rotulos: Record<string, string>; valor: number };

/** Formato texto do Prometheus: `nome{rotulo="x",...} valor`. */
function lerMetricas(texto: string): Amostra[] {
  const amostras: Amostra[] = [];
  for (const linha of texto.split("\n")) {
    if (!linha || linha.startsWith("#")) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(\S+)/.exec(linha);
    if (!m) continue;
    const rotulos: Record<string, string> = {};
    for (const r of (m[2] ?? "").matchAll(/(\w+)="([^"]*)"/g)) rotulos[r[1]] = r[2];
    const valor = Number(m[3]);
    if (Number.isFinite(valor)) amostras.push({ nome: m[1], rotulos, valor });
  }
  return amostras;
}

function primeira(amostras: Amostra[], nome: string, filtro: (r: Record<string, string>) => boolean = () => true) {
  return amostras.find((a) => a.nome === nome && filtro(a.rotulos))?.valor ?? null;
}

function soma(amostras: Amostra[], nome: string) {
  const achadas = amostras.filter((a) => a.nome === nome);
  return achadas.length ? achadas.reduce((t, a) => t + a.valor, 0) : null;
}

function pct(parte: number | null, todo: number | null) {
  return parte === null || !todo ? null : (parte / todo) * 100;
}

function metrica(m: Omit<MetricaSaude, "nivel">): MetricaSaude {
  return { ...m, nivel: avaliarNivel(m.valor, m.sentido, m.amarelo, m.vermelho) };
}

type Resumo = {
  banco?: { bytes?: number; cache_hit_pct?: number | null };
  historico?: { total_bytes?: number; meses?: { mes: string; bytes: number }[] };
  storage?: {
    total_bytes?: number;
    bytes_30d?: number;
    buckets?: { bucket: string; publico: boolean; arquivos: number; bytes: number; bytes_30d: number }[];
  };
};

async function montar(url: string, serviceKey: string): Promise<InfraSaude> {
  const avisos: string[] = [];

  let amostras: Amostra[] = [];
  try {
    const resposta = await fetch(`${url}/customer/v1/privileged/metrics`, {
      headers: { Authorization: `Basic ${Buffer.from(`service_role:${serviceKey}`).toString("base64")}` },
      cache: "no-store"
    });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    amostras = lerMetricas(await resposta.text());
  } catch (err) {
    console.error("[infra-saude] métricas da Supabase indisponíveis:", err);
    avisos.push("Não foi possível ler memória, disco, processador, conexões e Realtime agora.");
  }

  let resumo: Resumo = {};
  const admin = createSupabaseClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc("infra_saude_resumo");
  if (error) {
    console.error("[infra-saude] infra_saude_resumo falhou:", error.message);
    avisos.push("Não foi possível ler o tamanho do banco, o histórico e os arquivos agora.");
  } else {
    resumo = (data ?? {}) as Resumo;
  }

  const doBanco = (r: Record<string, string>) => r.service_type === "db";
  const memTotal = primeira(amostras, "node_memory_MemTotal_bytes", doBanco);
  const memLivre = primeira(amostras, "node_memory_MemAvailable_bytes", doBanco);
  const swapTotal = primeira(amostras, "node_memory_SwapTotal_bytes", doBanco);
  const swapLivre = primeira(amostras, "node_memory_SwapFree_bytes", doBanco);
  const discoDados = (r: Record<string, string>) => r.mountpoint === "/data";
  const discoTotal = primeira(amostras, "node_filesystem_size_bytes", discoDados);
  const discoLivre = primeira(amostras, "node_filesystem_avail_bytes", discoDados);
  const carga5 = primeira(amostras, "node_load5");
  const nucleos = new Set(amostras.filter((a) => a.nome === "node_cpu_seconds_total").map((a) => a.rotulos.cpu)).size || null;
  const conexoes = soma(amostras, "connection_stats_connection_count");
  const conexoesMax = primeira(amostras, "max_connections_connection_count");
  const realtime = primeira(amostras, "realtime_postgres_changes_total_subscriptions");

  const L = LIMITES_SAUDE;
  const meses = resumo.historico?.meses ?? [];
  const mesAtual = meses.length ? meses[meses.length - 1].bytes : null;

  const metricas: MetricaSaude[] = [
    metrica({
      chave: "memoria",
      titulo: "Memória livre",
      explicacao: "Quanto da memória do servidor do banco ainda está sobrando. Com pouca memória, as telas ficam lentas.",
      unidade: "pct",
      valor: pct(memLivre, memTotal),
      limite: 100,
      sentido: "abaixo",
      amarelo: L.memoriaLivrePct.amarelo,
      vermelho: L.memoriaLivrePct.vermelho
    }),
    metrica({
      chave: "swap",
      titulo: "Memória de emergência em uso",
      explicacao: "Quando a memória acaba, o servidor passa a usar o disco no lugar dela, o que é bem mais lento.",
      unidade: "pct",
      valor: swapTotal ? pct(swapTotal - (swapLivre ?? swapTotal), swapTotal) : null,
      limite: 100,
      sentido: "acima",
      amarelo: L.swapPct.amarelo,
      vermelho: L.swapPct.vermelho
    }),
    metrica({
      chave: "processador",
      titulo: "Carga do processador",
      explicacao: `Quanto trabalho o processador está fazendo na média dos últimos 5 minutos. ${nucleos ?? 2} é o máximo que ele aguenta sem fila.`,
      unidade: "carga",
      valor: carga5,
      limite: nucleos,
      sentido: "acima",
      amarelo: (nucleos ?? 2) * L.cargaFracao.amarelo,
      vermelho: (nucleos ?? 2) * L.cargaFracao.vermelho
    }),
    metrica({
      chave: "disco",
      titulo: "Disco do banco ocupado",
      explicacao: "Espaço usado no disco onde ficam os dados. A Supabase aumenta o disco sozinha, mas cobra a mais.",
      unidade: "pct",
      valor: discoTotal && discoLivre !== null ? pct(discoTotal - discoLivre, discoTotal) : null,
      limite: 100,
      sentido: "acima",
      amarelo: L.discoPct.amarelo,
      vermelho: L.discoPct.vermelho
    }),
    metrica({
      chave: "conexoes",
      titulo: "Conexões abertas no banco",
      explicacao: "Quantos programas estão conectados ao banco agora. Se chegar ao máximo, novos acessos são recusados.",
      unidade: "contagem",
      valor: conexoes,
      limite: conexoesMax,
      sentido: "acima",
      amarelo: (conexoesMax ?? 60) * L.conexoesFracao.amarelo,
      vermelho: (conexoesMax ?? 60) * L.conexoesFracao.vermelho
    }),
    metrica({
      chave: "realtime",
      titulo: "Telas atualizando ao vivo",
      explicacao: "Assinaturas de atualização automática (chat e pendências). O plano aguenta 500 ao mesmo tempo.",
      unidade: "contagem",
      valor: realtime,
      limite: L.realtime.limite,
      sentido: "acima",
      amarelo: L.realtime.amarelo,
      vermelho: L.realtime.vermelho
    }),
    metrica({
      chave: "storage",
      titulo: "Arquivos guardados",
      explicacao: "Soma de artes, PDFs, instaladores e anexos deste sistema. Os 100 GB do plano valem para a conta toda.",
      unidade: "bytes",
      valor: resumo.storage?.total_bytes ?? null,
      limite: L.storage.limite,
      sentido: "acima",
      amarelo: L.storage.amarelo,
      vermelho: L.storage.vermelho
    }),
    metrica({
      chave: "storage30d",
      titulo: "Arquivos novos em 30 dias",
      explicacao: "Quanto os arquivos cresceram no último mês. É o ritmo que diz quando os 100 GB acabam.",
      unidade: "bytes",
      valor: resumo.storage?.bytes_30d ?? null,
      limite: null,
      sentido: "acima",
      amarelo: L.storage30d.amarelo,
      vermelho: L.storage30d.vermelho
    }),
    metrica({
      chave: "historico",
      titulo: "Histórico de alterações do mês",
      explicacao: "Registro de quem mudou o quê. Correções em massa fazem este número saltar de uma vez.",
      unidade: "bytes",
      valor: mesAtual,
      limite: null,
      sentido: "acima",
      amarelo: L.historicoMes.amarelo,
      vermelho: L.historicoMes.vermelho
    }),
    metrica({
      chave: "cache",
      titulo: "Leituras atendidas pela memória",
      explicacao: "Quanto das consultas o banco responde sem ir ao disco. Abaixo de 99% as telas começam a pesar.",
      unidade: "pct",
      valor: resumo.banco?.cache_hit_pct ?? null,
      limite: 100,
      sentido: "abaixo",
      amarelo: L.cacheHitPct.amarelo,
      vermelho: L.cacheHitPct.vermelho
    })
  ];

  const buckets: BucketSaude[] = (resumo.storage?.buckets ?? []).map((b) => ({
    bucket: b.bucket,
    publico: Boolean(b.publico),
    arquivos: Number(b.arquivos) || 0,
    bytes: Number(b.bytes) || 0,
    bytes30d: Number(b.bytes_30d) || 0
  }));

  const agora = Date.now();
  return {
    geradoEm: new Date(agora).toISOString(),
    validoAte: new Date(agora + VALIDADE_MS).toISOString(),
    metricas,
    buckets,
    historicoMeses: meses.map((m) => ({ mes: m.mes, bytes: Number(m.bytes) || 0 })),
    avisos
  };
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceKey) {
    console.error("[infra-saude] ENV AUSENTE");
    return NextResponse.json({ success: false, error: "Configuração de ambiente incompleta." }, { status: 500 });
  }
  if (!token) {
    return NextResponse.json({ success: false, error: "Sessão não encontrada." }, { status: 401 });
  }

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, error: "Sessão inválida ou expirada." }, { status: 401 });
  }

  // ── Permissão: somente administrador ─────────────────────────────────────
  const { data: usuarioRow, error: usuarioErr } = await supabase
    .from("usuarios")
    .select("is_admin, is_super_adm")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (usuarioErr || !usuarioRow) {
    return NextResponse.json({ success: false, error: "Usuário não encontrado em public.usuarios." }, { status: 403 });
  }
  if (!usuarioRow.is_admin && !usuarioRow.is_super_adm) {
    return NextResponse.json({ success: false, error: "Somente administradores veem a saúde da infraestrutura." }, { status: 403 });
  }

  if (!cache || cache.expiraEm <= Date.now()) {
    const dados = await montar(url, serviceKey);
    // Leitura com falha não fica 10 minutos presa: tenta de novo em 1 minuto.
    const validade = dados.avisos.length ? 60 * 1000 : VALIDADE_MS;
    cache = { expiraEm: Date.now() + validade, dados: { ...dados, validoAte: new Date(Date.now() + validade).toISOString() } };
  }

  return NextResponse.json(
    { success: true, data: cache.dados },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
