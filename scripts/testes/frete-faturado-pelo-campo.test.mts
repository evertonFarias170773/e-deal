/**
 * Valor negociado do frete com cobrança faturada a vencer sem título (03/11/2026).
 *
 *   node --experimental-strip-types --no-warnings --import ./scripts/testes/_alias-hook.mjs scripts/testes/frete-faturado-pelo-campo.test.mts
 *
 * Nada vai ao banco: o cliente do Supabase é um banco em memória. O pedido é
 * fictício (#900001), no molde do 24345 (EXPEDICAO, CIF, frete 0, total
 * 13.520,00, uma cobrança E-FATURADO A_VENCER confirmada, nenhum boleto,
 * rascunho de NF PENDENTE sem número).
 *
 * PROVA
 *   (a) ADM muda o frete e a cobrança passa a valer o total novo, com a linha no chat;
 *   (b) repetir a mesma gravação não escreve nada;
 *   (c) sem a permissão da editar-paga: recusado, com a mensagem corrigida;
 *   (d) com boleto (até cancelado), outra cobrança, ENTREGUE ou NF autorizada: recusa de antes;
 *   (e) se a cobrança não acompanhar, o frete é desfeito.
 */
import { readFileSync } from "node:fs";
import { gravarValorFreteNegociado, entradaFaturadoPeloCampo } from "@/features/orcamentos/services/valor-frete-negociado";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok" : "FALHOU"} - ${nome}${ok ? "" : `\n   esperado ${JSON.stringify(esperado)}\n   veio     ${JSON.stringify(real)}`}`);
}
const ler = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

type Linha = Record<string, unknown>;
type Banco = Record<string, Linha[]>;
type Opcoes = {
  /** Tabela cujo UPDATE devolve erro. `aplicaAntes`: grava e mesmo assim devolve erro (resposta perdida). */
  falhaUpdate?: { tabela: string; aplicaAntes?: boolean };
  /** Total que o banco "calcula" depois de gravar (padrão: o valor_total gravado). */
  soberanoDepois?: number;
};

/** Banco em memória com os filtros que o fluxo usa. Registra toda escrita. */
function bancoFalso(banco: Banco, opcoes: Opcoes = {}) {
  const escritas: string[] = [];
  let soberanoLido = 0;
  function consulta(tabela: string) {
    const filtros: Array<(l: Linha) => boolean> = [];
    let patch: Linha | null = null;
    let insercao: Linha[] | null = null;
    let devolveLinhas = false;
    const linhas = () => (banco[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));
    const executar = async () => {
      if (insercao) {
        banco[tabela] = [...(banco[tabela] ?? []), ...insercao];
        escritas.push(`insert ${tabela}`);
        return { data: insercao, error: null };
      }
      if (patch) {
        const alvo = linhas();
        const falha = opcoes.falhaUpdate?.tabela === tabela;
        if (falha && !opcoes.falhaUpdate?.aplicaAntes) {
          escritas.push(`update ${tabela} (falhou)`);
          return { data: null, error: { message: "falha simulada" } };
        }
        for (const l of alvo) Object.assign(l, patch);
        escritas.push(`update ${tabela} (${alvo.length})`);
        if (falha) return { data: null, error: { message: "falha simulada depois de gravar" } };
        return { data: devolveLinhas ? alvo.map((l) => ({ ...l })) : null, error: null };
      }
      return { data: linhas().map((l) => ({ ...l })), error: null };
    };
    const q: Record<string, unknown> = {
      select() { if (patch) devolveLinhas = true; return q; },
      eq(c: string, v: unknown) { filtros.push((l) => l[c] === v); return q; },
      neq(c: string, v: unknown) { filtros.push((l) => l[c] !== v); return q; },
      in(c: string, vs: unknown[]) { filtros.push((l) => vs.includes(l[c])); return q; },
      is(c: string, v: unknown) { filtros.push((l) => (l[c] ?? null) === v); return q; },
      gte(c: string, v: number) { filtros.push((l) => Number(l[c]) >= v); return q; },
      lt(c: string, v: number) { filtros.push((l) => Number(l[c]) < v); return q; },
      or() { return q; },
      order() { return q; },
      limit() { return q; },
      update(p: Linha) { patch = p; return q; },
      insert(rows: Linha | Linha[]) { insercao = Array.isArray(rows) ? rows : [rows]; return q; },
      delete() { throw new Error(`DELETE PROIBIDO em ${tabela}`); },
      upsert() { throw new Error(`UPSERT PROIBIDO em ${tabela}`); },
      maybeSingle: async () => { const r = await executar(); return { data: (r.data as Linha[] | null)?.[0] ?? null, error: r.error }; },
      // A reconciliação de status (best-effort, a mesma da editar-paga) para aqui.
      single: async () => ({ data: null, error: { message: "fora do teste" } }),
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => executar().then(ok, erro)
    };
    return q;
  }
  return {
    escritas,
    from: (tabela: string) => consulta(tabela),
    async rpc(nome: string) {
      if (nome === "cc__total_soberano_proposta") {
        soberanoLido++;
        const total = Number((banco.propostas ?? [])[0]?.valor_total);
        // Primeira leitura é a de antes de gravar; a segunda pode ser forçada.
        return { data: soberanoLido > 1 && opcoes.soberanoDepois !== undefined ? opcoes.soberanoDepois : total, error: null };
      }
      return { data: null, error: { message: `rpc ${nome} fora do teste` } };
    }
  };
}

const ID = 900001;
const ADM = { uid: "adm", nome: "adm@teste", email: "adm@teste" };
const SEM_PERMISSAO = { uid: "exp", nome: "exp@teste", email: "exp@teste" };

function cenario(mudar: (b: Banco) => void = () => {}): Banco {
  const b: Banco = {
    propostas: [{ id_int: ID, id_cliente: 1, status_interno: "EXPEDICAO", modalidade_frete: "CIF", valor_frete: 0, valor_total: 13520, is_avulso: false, id_int_pedido_principal: null }],
    pagamentos_v2: [{ id: "pg1", id_int: ID, id_pagamento: `${ID}-A`, tipo_cobranca: "E-FATURADO", status: "A_VENCER", confirmado: true, paid_at: null, valor: 13520, obs_v2: null }],
    boletos: [],
    notas_fiscais: [{ id_int: ID, status: "PENDENTE", numero_nf: null }],
    conta_corrente_pendencias: [],
    propostas_chat: [],
    produtos_proposta: [],
    // Perfis como os do banco em 03/11/2026: ADM (2) tem editar_paga; Expedidor-like sem nenhuma das duas.
    usuarios: [
      { user_id: "adm", id_perfil: 2, is_super_adm: false, is_admin: true },
      { user_id: "exp", id_perfil: 9, is_super_adm: false, is_admin: false },
      { user_id: "fin", id_perfil: 3, is_super_adm: false, is_admin: false }
    ],
    perfis: [
      { id: 2, ativo: true, permissoes: ["propostas.editar_paga", "expedicao.admin"] },
      { id: 9, ativo: true, permissoes: ["expedicao.admin"] },
      { id: 3, ativo: true, permissoes: ["propostas.editar_faturado"] }
    ]
  };
  mudar(b);
  return b;
}
const proposta = (b: Banco) => b.propostas[0];
const cobranca = (b: Banco) => b.pagamentos_v2[0];

// ── (a) ADM muda o frete; a cobrança acompanha, com a linha no chat ─────────
const bA = cenario();
const cA = bancoFalso(bA);
const rA = await gravarValorFreteNegociado(cA as never, { idInt: ID, valorFrete: 25, ator: ADM });
checar("(a) grava", rA.ok, true);
checar("(a) frete e total novos na proposta", [proposta(bA).valor_frete, proposta(bA).valor_total], [25, 13545]);
checar("(a) cobrança passa a valer o total novo", cobranca(bA).valor, 13545);
checar("(a) cobrança segue em Registro de recebíveis (boleto_enviadoo false)", cobranca(bA).boleto_enviadoo, false);
checar("(a) uma linha no chat", bA.propostas_chat.length, 1);
const msgA = String(bA.propostas_chat[0]?.mensagem ?? "");
checar("(a) chat diz o valor anterior e o novo", msgA.includes("de R$ 13520,00 para R$ 13545,00"), true);
checar("(a) chat diz o responsável", msgA.includes("Responsável: adm@teste"), true);
checar("(a) resposta traz o ajuste e saldo zero", rA.ok ? [rA.faturadoAjustado, rA.saldo] : null, [{ id: "pg1", valorAnterior: 13520, valorNovo: 13545 }, 0]);
checar("(a) escritas: proposta, cobrança, chat — nada em boletos", cA.escritas, ["update propostas (1)", "update pagamentos_v2 (1)", "insert propostas_chat"]);
checar("(a) rascunho de NF não foi tocado", bA.notas_fiscais, [{ id_int: ID, status: "PENDENTE", numero_nf: null }]);

// Financeiro (só editar_faturado) também pode, como na editar-paga.
const bFin = cenario();
const rFin = await gravarValorFreteNegociado(bancoFalso(bFin) as never, { idInt: ID, valorFrete: 10, ator: { uid: "fin", nome: "fin", email: "fin@teste" } });
checar("(a) editar_faturado também aceita", [rFin.ok, cobranca(bFin).valor], [true, 13530]);

// Reduzir o frete depois: a cobrança desce junto.
const rDesce = await gravarValorFreteNegociado(bancoFalso(bA) as never, { idInt: ID, valorFrete: 5, ator: ADM });
checar("(a) reduzir: cobrança acompanha para baixo", [rDesce.ok, proposta(bA).valor_total, cobranca(bA).valor, bA.propostas_chat.length], [true, 13525, 13525, 2]);

// ── (b) Repetir a mesma gravação não escreve nada ───────────────────────────
const cB = bancoFalso(bA);
const rB = await gravarValorFreteNegociado(cB as never, { idInt: ID, valorFrete: 5, ator: ADM });
checar("(b) mesmo valor: sem alteração", rB.ok && rB.semAlteracao, true);
checar("(b) nenhuma escrita", cB.escritas, []);
checar("(b) nenhuma linha nova no chat", bA.propostas_chat.length, 2);

// ── (c) Sem a permissão: recusado, mensagem corrigida ───────────────────────
const bC = cenario();
const cC = bancoFalso(bC);
const rC = await gravarValorFreteNegociado(cC as never, { idInt: ID, valorFrete: 25, ator: SEM_PERMISSAO });
checar("(c) recusa por permissão", rC.ok ? null : [rC.status, rC.code, rC.gravado], [403, "SEM_PERMISSAO_EDITAR_FATURADO", false]);
const msgC = rC.ok ? "" : rC.mensagem;
checar("(c) mensagem cita Salvar alterações e as duas permissões", ["Salvar alterações", "propostas.editar_faturado", "propostas.editar_paga"].every((t) => msgC.includes(t)), true);
checar("(c) mensagem não cita o botão inexistente", msgC.includes("Editar proposta paga"), false);
checar("(c) nada escrito", [cC.escritas, proposta(bC).valor_frete, cobranca(bC).valor], [[], 0, 13520]);

// ── (d) Fora da trava: recusa de antes ──────────────────────────────────────
const casos: Array<[string, (b: Banco) => void, string]> = [
  ["boleto emitido", (b) => { b.boletos = [{ id: "t1", id_int: ID, status: "A_VENCER", valor: 13520, paid_at: null }]; }, "FATURADO_A_VENCER"],
  ["boleto cancelado (zero linhas exigido)", (b) => { b.boletos = [{ id: "t1", id_int: ID, status: "CANCELADO", valor: 13520, paid_at: null }]; }, "FATURADO_A_VENCER"],
  ["outra cobrança ativa junto", (b) => { b.pagamentos_v2.push({ id: "pg2", id_int: ID, id_pagamento: `${ID}-B`, tipo_cobranca: "PIX", status: "PAID", confirmado: true, paid_at: "2026-11-01", valor: 100, obs_v2: null }); b.propostas[0].valor_total = 13620; }, "FATURADO_A_VENCER"],
  ["pedido ENTREGUE", (b) => { b.propostas[0].status_interno = "ENTREGUE"; }, "PEDIDO_ENTREGUE"],
  ["NF autorizada", (b) => { b.notas_fiscais = [{ id_int: ID, status: "AUTORIZADA", numero_nf: "7501" }]; }, "NF_AUTORIZADA"]
];
for (const [nome, mudar, codigo] of casos) {
  const b = cenario(mudar);
  const c = bancoFalso(b);
  const r = await gravarValorFreteNegociado(c as never, { idInt: ID, valorFrete: 25, ator: ADM });
  const codigoReal = r.ok ? "OK" : r.code;
  checar(`(d) ${nome}: recusado`, codigoReal === codigo || (codigo === "PEDIDO_ENTREGUE" && !r.ok && /ENTREGUE/i.test(codigoReal)), true);
  checar(`(d) ${nome}: nada escrito`, c.escritas, []);
  if (codigo === "FATURADO_A_VENCER" && !r.ok) {
    checar(`(d) ${nome}: mensagem com o caminho real`, r.mensagem.includes("Salvar alterações") && !r.mensagem.includes("Editar proposta paga"), true);
  }
}

// ── (e) A cobrança não acompanha: o frete não fica sozinho ──────────────────
const bE = cenario();
const cE = bancoFalso(bE, { falhaUpdate: { tabela: "pagamentos_v2" } });
const rE = await gravarValorFreteNegociado(cE as never, { idInt: ID, valorFrete: 25, ator: ADM });
checar("(e) recusado sem gravado", rE.ok ? null : [rE.code, rE.gravado], ["FALHA_AJUSTE_FATURADO", false]);
checar("(e) frete e total voltaram", [proposta(bE).valor_frete, proposta(bE).valor_total], [0, 13520]);
checar("(e) cobrança intacta e sem chat", [cobranca(bE).valor, bE.propostas_chat.length], [13520, 0]);
checar("(e) escritas: grava, cobrança falha, desfaz", cE.escritas, ["update propostas (1)", "update pagamentos_v2 (falhou)", "update propostas (1)"]);

// Total do banco não confere depois de gravar: a cobrança nem é tocada e o frete é desfeito.
const bE2 = cenario();
const cE2 = bancoFalso(bE2, { soberanoDepois: 99999 });
const rE2 = await gravarValorFreteNegociado(cE2 as never, { idInt: ID, valorFrete: 25, ator: ADM });
checar("(e) total divergente: desfeito, cobrança intacta", [rE2.ok ? null : rE2.gravado, proposta(bE2).valor_frete, cobranca(bE2).valor], [false, 0, 13520]);

// A cobrança mudou mas a resposta se perdeu: NÃO desfaz (cobrança nova com frete velho seria pior) e avisa.
const bE3 = cenario();
const cE3 = bancoFalso(bE3, { falhaUpdate: { tabela: "pagamentos_v2", aplicaAntes: true } });
const rE3 = await gravarValorFreteNegociado(cE3 as never, { idInt: ID, valorFrete: 25, ator: ADM });
checar("(e) resposta perdida: não desfaz, avisa como gravado", [rE3.ok ? null : rE3.gravado, proposta(bE3).valor_frete, cobranca(bE3).valor], [true, 25, 13545]);

// ── A trava, em função pura ─────────────────────────────────────────────────
const fat = { id: "x", tipo_cobranca: "E-Faturado", status: "A_VENCER", paid_at: null, valor: 10 };
checar("trava: só a faturada, sem título", entradaFaturadoPeloCampo({ cobrancas: [fat], titulos: [] })?.id, "x");
checar("trava: com título", entradaFaturadoPeloCampo({ cobrancas: [fat], titulos: [{}] }), null);
checar("trava: paga", entradaFaturadoPeloCampo({ cobrancas: [{ ...fat, paid_at: "2026-11-01" }], titulos: [] }), null);
checar("trava: E-Retrabalho não", entradaFaturadoPeloCampo({ cobrancas: [{ ...fat, tipo_cobranca: "E-RETRABALHO" }], titulos: [] }), null);
checar("trava: cancelada ao lado não conta", entradaFaturadoPeloCampo({ cobrancas: [fat, { ...fat, id: "y", status: "CANCELADO" }], titulos: [] })?.id, "x");

// ── Estático: a frase do botão inexistente sumiu; a editar-paga usa a mesma permissão ──
const servico = ler("src/features/orcamentos/services/valor-frete-negociado.ts");
checar("o serviço não manda mais usar 'Editar proposta paga'", /Use "Editar proposta paga"|decidido em "Editar proposta paga"/.test(servico), false);
const rota = ler("src/app/api/orcamentos/editar-paga/route.ts");
checar("editar-paga importa a permissão extraída", rota.includes('from "@/lib/auth/permissao-editar-paga"') && !rota.includes("async function verificarPermissaoEditarPaga"), true);
checar("o campo exige as mesmas duas permissões", servico.includes("verificarPermissaoEditarPaga(supabase, ator.uid, [PERMISSAO_PROPOSTA_PAGA, PERMISSAO_FATURADO])"), true);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
