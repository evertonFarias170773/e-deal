/**
 * "Pedido do sistema antigo" no modal Criar cobrança (16/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/sistema-antigo.test.mts
 *
 * SEM banco: cliente Supabase falso, que só anota o que foi pedido.
 *   A. a regra da tela: desmarcado não exige OS e manda a cobrança sem OS;
 *      marcado sem OS recusa; marcado com OS manda o número;
 *   B. a gravação na proposta: só quando o valor muda, nunca em avulsa sem
 *      valor_total, e o UPDATE leva só a coluna nova com a trava da avulsa.
 */
const { falso, getSupabaseClient } = await import("./_supabase-falso.mts");
const {
  CORTE_PEDIDO_VIBE_ISO,
  MENSAGEM_OS_IDEAL_OBRIGATORIA,
  decidirMarcaVibe,
  gravarMarcaVibePelaAreaCliente,
  checkboxInicialSistemaAntigo,
  decidirGravacaoMarca,
  gravarMarcaSistemaAntigo,
  osIdealDaCobranca,
  validarOsIdeal
} = await import("../../src/features/cobrancas/lib/sistema-antigo.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

// ── A. a regra da tela ──────────────────────────────────────────────────────
console.log("== A. a regra da tela");
confere("checkbox abre desmarcado em proposta nao classificada (NULL)", checkboxInicialSistemaAntigo({ isSistemaAntigo: null, isAvulso: false, valorTotal: 100 }) === false);
confere("checkbox abre desmarcado sem leitura", checkboxInicialSistemaAntigo(null) === false);
confere("checkbox abre desmarcado em proposta gravada false", checkboxInicialSistemaAntigo({ isSistemaAntigo: false, isAvulso: false, valorTotal: 100 }) === false);
confere("checkbox abre MARCADO em proposta gravada true", checkboxInicialSistemaAntigo({ isSistemaAntigo: true, isAvulso: false, valorTotal: 100 }) === true);
confere("desmarcado, sem OS: deixa criar", validarOsIdeal(false, "") === null);
confere("desmarcado: a cobranca sai SEM OS mesmo com o campo pre-preenchido", osIdealDaCobranca(false, "2101") === "");
confere("marcado sem OS: recusa com a mensagem", validarOsIdeal(true, "   ") === MENSAGEM_OS_IDEAL_OBRIGATORIA);
confere("marcado com OS: deixa criar e manda o numero", validarOsIdeal(true, "2101") === null && osIdealDaCobranca(true, " 2101 ") === "2101");

// ── B. a gravação na proposta ───────────────────────────────────────────────
console.log("== B. a gravacao na proposta");
const normal = { isAvulso: false, valorTotal: 350 };
confere("NULL -> false: grava", decidirGravacaoMarca({ ...normal, isSistemaAntigo: null }, false) === "GRAVAR");
confere("NULL -> true: grava", decidirGravacaoMarca({ ...normal, isSistemaAntigo: null }, true) === "GRAVAR");
confere("false -> false: nao grava (valor igual)", decidirGravacaoMarca({ ...normal, isSistemaAntigo: false }, false) === "IGUAL");
confere("true -> true: nao grava (valor igual)", decidirGravacaoMarca({ ...normal, isSistemaAntigo: true }, true) === "IGUAL");
confere("avulsa com valor_total NULO: nunca grava", decidirGravacaoMarca({ isSistemaAntigo: null, isAvulso: true, valorTotal: null }, false) === "AVULSA_SEM_TOTAL");
confere("avulsa com valor_total ZERO: nunca grava", decidirGravacaoMarca({ isSistemaAntigo: null, isAvulso: true, valorTotal: 0 }, true) === "AVULSA_SEM_TOTAL");
confere("avulsa com valor_total preenchido: grava", decidirGravacaoMarca({ isSistemaAntigo: null, isAvulso: true, valorTotal: 120 }, false) === "GRAVAR");

const client = getSupabaseClient() as never;

type RespostaUpdate = { data: unknown; error: { message: string; code?: string } | null };
async function gravar(
  linha: Record<string, unknown> | null,
  novo: boolean,
  respostaUpdate: RespostaUpdate = { data: [{ id_int: 23800, is_avulso: false, valor_total: 350 }], error: null }
) {
  falso.zerar();
  falso.responder("propostas:select", { data: linha, error: null });
  falso.responder("propostas:update", respostaUpdate);
  const r = await gravarMarcaSistemaAntigo(client, 23800, novo);
  const updates = falso.chamadas.filter((c) => c.tabela === "propostas" && c.op === "update");
  return { r, updates };
}

{
  const { r, updates } = await gravar({ is_sistema_antigo: null, is_avulso: false, valor_total: 350 }, false);
  confere("desmarcado em proposta NULL: grava false, UM update", r.gravou && updates.length === 1, { r, updates });
  confere("o update leva SO is_sistema_antigo=false", JSON.stringify(updates[0]?.payload) === JSON.stringify({ is_sistema_antigo: false }), updates[0]?.payload);
  const filtros = JSON.stringify(updates[0]?.filtros);
  confere("o update filtra pelo id_int e leva a trava da avulsa", filtros.includes('["eq",["id_int",23800]]') && filtros.includes("valor_total.gt.0"), updates[0]?.filtros);
}
{
  const { r, updates } = await gravar({ is_sistema_antigo: null, is_avulso: false, valor_total: 350 }, true);
  confere("marcado em proposta NULL: grava true", r.gravou && JSON.stringify(updates[0]?.payload) === JSON.stringify({ is_sistema_antigo: true }), { r, updates });
}
{
  const { r, updates } = await gravar({ is_sistema_antigo: false, is_avulso: false, valor_total: 350 }, false);
  confere("valor igual: nenhum update", r.decisao === "IGUAL" && updates.length === 0, { r, updates });
}
{
  const { r, updates } = await gravar({ is_sistema_antigo: null, is_avulso: true, valor_total: null }, false);
  confere("avulsa antiga sem valor_total: nenhum update (a proposta nao e tocada)", r.decisao === "AVULSA_SEM_TOTAL" && updates.length === 0, { r, updates });
}
{
  // O modal so mostra "Cobranca criada, mas a marca do sistema antigo nao foi
  // gravada" quando `erro` vem preenchido (PropostaCobrancaPanel).
  const { r } = await gravar({ is_sistema_antigo: null, is_avulso: false, valor_total: 350 }, false, {
    data: null,
    error: { message: "column propostas.is_avulso does not exist", code: "42703" }
  });
  confere("UPDATE com erro do banco: devolve o erro (o aviso aparece)", r.gravou === false && r.erro === "column propostas.is_avulso does not exist", r);
}
{
  const { r } = await gravar({ is_sistema_antigo: null, is_avulso: false, valor_total: 350 }, true);
  confere("UPDATE que grava: sem erro (o aviso NAO aparece)", r.gravou === true && r.erro === undefined, r);
}
{
  // A linha virou avulsa sem total entre a leitura e a escrita: a trava do
  // UPDATE a recusa. Nada gravado, e isso nao e falha.
  const { r } = await gravar({ is_sistema_antigo: null, is_avulso: false, valor_total: 350 }, true, { data: [], error: null });
  confere("UPDATE recusado pela trava (zero linhas, sem erro): nao grava e o aviso NAO aparece", r.gravou === false && r.erro === undefined, r);
}
{
  const { r, updates } = await gravar(null, true);
  confere("proposta nao encontrada: nenhum update", r.decisao === "SEM_PROPOSTA" && updates.length === 0, { r, updates });
}

// ── C. a área do cliente (cobrança criada fora do modal) ────────────────────
console.log("== C. a area do cliente");
const NOVA = "2026-10-16T15:30:00+00:00";
const ANTIGA = "2026-10-16T14:49:59+00:00";
confere("o corte e 16/10/2026 14:50 UTC", CORTE_PEDIDO_VIBE_ISO === "2026-10-16T14:50:00Z");
confere("nova e NULL: grava", decidirMarcaVibe({ isSistemaAntigo: null, isAvulso: false, valorTotal: 120, createdAt: NOVA }) === "GRAVAR");
confere("criada exatamente no corte: grava", decidirMarcaVibe({ isSistemaAntigo: null, isAvulso: false, valorTotal: 120, createdAt: "2026-10-16T14:50:00+00:00" }) === "GRAVAR");
confere("anterior ao corte (1 s antes): NAO grava", decidirMarcaVibe({ isSistemaAntigo: null, isAvulso: false, valorTotal: 120, createdAt: ANTIGA }) === "ANTERIOR_AO_CORTE");
confere("sem created_at: NAO grava", decidirMarcaVibe({ isSistemaAntigo: null, isAvulso: false, valorTotal: 120, createdAt: null }) === "ANTERIOR_AO_CORTE");
confere("true ja gravado: NAO sobrescreve", decidirMarcaVibe({ isSistemaAntigo: true, isAvulso: false, valorTotal: 120, createdAt: NOVA }) === "JA_MARCADA");
confere("false ja gravado: NAO regrava", decidirMarcaVibe({ isSistemaAntigo: false, isAvulso: false, valorTotal: 120, createdAt: NOVA }) === "JA_MARCADA");
confere("avulsa nova sem valor_total: NAO grava", decidirMarcaVibe({ isSistemaAntigo: null, isAvulso: true, valorTotal: null, createdAt: NOVA }) === "AVULSA_SEM_TOTAL");

async function gravarArea(linha: Record<string, unknown> | null, respostaUpdate: RespostaUpdate = { data: [{ id_int: 23900 }], error: null }) {
  falso.zerar();
  falso.responder("propostas:select", { data: linha, error: null });
  falso.responder("propostas:update", respostaUpdate);
  const r = await gravarMarcaVibePelaAreaCliente(client, 23900);
  const updates = falso.chamadas.filter((c) => c.tabela === "propostas" && c.op === "update");
  return { r, updates };
}
{
  const { r, updates } = await gravarArea({ is_sistema_antigo: null, is_avulso: false, valor_total: 120, created_at: NOVA });
  confere("proposta nova NULL vira false: UM update", r.gravou && updates.length === 1, { r, updates });
  confere("o update leva SO is_sistema_antigo=false (nada de valor_total nem status)", JSON.stringify(updates[0]?.payload) === JSON.stringify({ is_sistema_antigo: false }), updates[0]?.payload);
  const f = JSON.stringify(updates[0]?.filtros);
  confere("as tres condicoes vao DENTRO do update: is null, created_at >= corte e trava da avulsa",
    f.includes('["eq",["id_int",23900]]') && f.includes('["is",["is_sistema_antigo",null]]') &&
    f.includes('["gte",["created_at","2026-10-16T14:50:00Z"]]') && f.includes("valor_total.gt.0"), updates[0]?.filtros);
}
for (const [nome, linha] of [
  ["anterior ao corte fica NULL", { is_sistema_antigo: null, is_avulso: false, valor_total: 120, created_at: ANTIGA }],
  ["true existente nao muda", { is_sistema_antigo: true, is_avulso: false, valor_total: 120, created_at: NOVA }],
  ["false existente nao recebe outro update", { is_sistema_antigo: false, is_avulso: false, valor_total: 120, created_at: NOVA }],
  ["avulsa sem valor_total nao recebe update", { is_sistema_antigo: null, is_avulso: true, valor_total: null, created_at: NOVA }]
] as const) {
  const { r, updates } = await gravarArea(linha as Record<string, unknown>);
  confere(`${nome}: nenhum update`, updates.length === 0 && r.gravou === false && !r.erro, { r, updates });
}
{
  const { r } = await gravarArea({ is_sistema_antigo: null, is_avulso: false, valor_total: 120, created_at: NOVA }, { data: null, error: { message: "falha simulada" } });
  confere("erro do banco na marca: devolve o erro, nao lanca (a cobranca segue)", r.gravou === false && r.erro === "falha simulada", r);
}
{
  falso.zerar();
  const quebrado = { from: () => { throw new Error("cliente quebrado"); } } as never;
  let lancou = false;
  let r: Awaited<ReturnType<typeof gravarMarcaVibePelaAreaCliente>> | null = null;
  try { r = await gravarMarcaVibePelaAreaCliente(quebrado, 23900); } catch { lancou = true; }
  confere("excecao inesperada tambem nao lanca (a cobranca segue)", !lancou && r?.erro === "cliente quebrado", r);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
if (falhas > 0) process.exitCode = 1;
