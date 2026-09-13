/**
 * A condição de pagamento deduzida das parcelas gravadas.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/condicao-das-parcelas.test.mts
 *
 * Existe por causa da NFE-22066-001: geraram com "Prazo 14 dias" e a aba voltou
 * mostrando "Prazo 7/14/21 dias", com um botão que desfaria o que acabara de
 * ser gerado. O teste prova a dedução com as funções REAIS do serviço, e
 * reproduz a ordem de resolução que a tela aplica na abertura.
 *
 * SO LEITURA; roda sem PERMITIR_ESCRITA.
 */
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else {
    console.log(`ok      ${nome}`);
  }
}

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (SERVICE) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;

const {
  combinacaoDasParcelasGravadas,
  correspondeAoModelo,
  modeloCorrespondente,
  listarModelosCobranca,
  buscarModeloCobrancaDaProposta,
  parcelasDoModelo
} = await import("../../src/features/cobrancas/services/modelos-cobranca.ts");
type Modelo = Awaited<ReturnType<typeof listarModelosCobranca>>[number];

const m = (resultado: string, qtd: number, inicio: number, intervalo: number): Modelo =>
  ({ id: resultado, resultado, qtd_parcela: qtd, inicio, intervalo, modelo: "x", entrada_porcento: 0 } as Modelo);
const CATALOGO = [m("Prazo 14 dias", 1, 14, 0), m("Prazo 7/14/21 dias", 3, 7, 7), m("Prazo 28/42 dias", 2, 28, 14)];
const parc = (dias: number | null, intervalo: number | null, tipo = "PARCELA") =>
  ({ tipo_registro: tipo, dias_pra_inicio: dias, intervalo_dias: intervalo });

// ── 1. Com uma parcela so, o intervalo NAO conta ────────────────────────────
checar("1 parcela, 14 dias, intervalo 0 -> Prazo 14 dias",
  modeloCorrespondente({ qtdParcelas: 1, diasPraInicio: 14, intervalo: 0 }, CATALOGO)?.resultado, "Prazo 14 dias");
checar("1 parcela, 14 dias, intervalo 30 (deixado no campo) -> Prazo 14 dias",
  modeloCorrespondente({ qtdParcelas: 1, diasPraInicio: 14, intervalo: 30 }, CATALOGO)?.resultado, "Prazo 14 dias");
checar("com 2+ parcelas o intervalo CONTA: 28/42 com intervalo 7 nao casa",
  modeloCorrespondente({ qtdParcelas: 2, diasPraInicio: 28, intervalo: 7 }, CATALOGO), null);
checar("3 parcelas 7/7 -> Prazo 7/14/21 dias",
  modeloCorrespondente({ qtdParcelas: 3, diasPraInicio: 7, intervalo: 7 }, CATALOGO)?.resultado, "Prazo 7/14/21 dias");

// ── 2. Parcelas gravadas que NAO formam condicao ────────────────────────────
checar("parcela unica (dias 0, intervalo 0) -> null", combinacaoDasParcelasGravadas([parc(0, 0)]), null);
checar("parcela que nasce com o rascunho (dias nulo) -> null", combinacaoDasParcelasGravadas([parc(null, null)]), null);
checar("sem parcela -> null", combinacaoDasParcelasGravadas([]), null);
checar("parcelas que discordam nos dias -> null", combinacaoDasParcelasGravadas([parc(7, 7), parc(14, 7)]), null);
checar("parcelas que discordam no intervalo -> null", combinacaoDasParcelasGravadas([parc(7, 7), parc(7, 14)]), null);
checar("a ENTRADA nao conta na quantidade",
  combinacaoDasParcelasGravadas([parc(0, 7, "ENTRADA"), parc(7, 7), parc(7, 7), parc(7, 7)]),
  { qtdParcelas: 3, diasPraInicio: 7, intervalo: 7 });

// ── 3. O caminho de ida e volta fecha para TODO o catalogo ──────────────────
for (const modelo of CATALOGO) {
  const p = parcelasDoModelo(modelo);
  checar(`ida e volta: ${modelo.resultado}`, correspondeAoModelo(p, modelo), true);
}

// ── 4. Contra o banco ───────────────────────────────────────────────────────
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !SERVICE) {
  console.log("\n(pulando a parte do banco: .env.local sem chaves)");
} else {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);
  const catalogo = await listarModelosCobranca();

  // O catalogo real, pela regra, nao pode ter duas condicoes com a mesma combinacao.
  const chaves = catalogo.map((x) => {
    const p = parcelasDoModelo(x);
    return `${p.qtdParcelas}|${p.diasPraInicio}|${p.qtdParcelas === 1 ? "-" : p.intervalo}`;
  });
  checar(`o catalogo real (${catalogo.length}) nao tem combinacao repetida`, new Set(chaves).size, catalogo.length);

  /** A MESMA ordem de resolucao que a aba aplica na abertura (NfeDetailPage, 4c). */
  async function oQueOSelectMostra(ref: string) {
    const { data: nota } = await sb.from("notas_fiscais").select("id_int, pgto_is_configurado").eq("ref", ref).single();
    const { data: parcelas } = await sb
      .from("notas_fiscais_pagamentos").select("tipo_registro, dias_pra_inicio, intervalo_dias").eq("ref", ref);
    const n = nota as { id_int: number; pgto_is_configurado: boolean };
    const linhas = parcelas ?? [];

    if (n.pgto_is_configurado) {
      const comb = combinacaoDasParcelasGravadas(linhas);
      const modelo = comb ? modeloCorrespondente(comb, catalogo) : null;
      // Os campos da tela espelham as parcelas gravadas quando ja configuradas.
      const campos = comb ?? null;
      const aviso = Boolean(modelo) && campos !== null
        && !correspondeAoModelo(campos, modelo!) && !modeloCorrespondente(campos, catalogo);
      return { select: modelo?.resultado ?? "Selecionar condição", degrau: modelo ? "1 (parcelas)" : "2 (nao formam condicao)", aviso };
    }
    const idCob = await buscarModeloCobrancaDaProposta(Number(n.id_int));
    const daCobranca = idCob ? catalogo.find((x) => String(x.id) === idCob) ?? null : null;
    return { select: daCobranca?.resultado ?? "Selecionar condição", degrau: daCobranca ? "3 (cobranca)" : "4 (nada)", aviso: false };
  }

  const r22066 = await oQueOSelectMostra("NFE-22066-001");
  console.log(`\n  NFE-22066-001 -> select: "${r22066.select}" | degrau ${r22066.degrau} | aviso: ${r22066.aviso}`);
  checar("a NFE-22066-001 abre com Prazo 14 dias", r22066.select, "Prazo 14 dias");
  checar("a NFE-22066-001 abre SEM o aviso", r22066.aviso, false);
  checar("e nao por causa da cobranca (degrau 1)", r22066.degrau, "1 (parcelas)");

  // O retrato de todas as notas nao emitidas.
  const { data: pend } = await sb.from("notas_fiscais").select("ref, status")
    .in("status", ["RASCUNHO", "PENDENTE", "PRONTA_PARA_ENVIO", "ERRO_VALIDACAO", "ERRO_ENVIO", "ERRO_AUTORIZACAO", "REJEITADA", "RETORNO_FOCUS"])
    .order("ref");
  console.log(`\n  ${"nota".padEnd(16)} ${"o select mostra".padEnd(24)} degrau                    aviso`);
  let comAviso = 0;
  for (const nota of pend ?? []) {
    const r = await oQueOSelectMostra(nota.ref);
    if (r.aviso) comAviso += 1;
    console.log(`  ${nota.ref.padEnd(16)} ${r.select.padEnd(24)} ${r.degrau.padEnd(25)} ${r.aviso}`);
  }
  checar("nenhuma nota abre com o aviso", comAviso, 0);
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
