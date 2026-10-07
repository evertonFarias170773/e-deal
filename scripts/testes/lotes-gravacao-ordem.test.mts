/**
 * A ordem das escritas da rota lotes-em-massa — src/features/orcamentos/services/gravar-lotes.server.ts
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/lotes-gravacao-ordem.test.mts
 *
 * Usa um CLIENTE FALSO do Supabase: anota cada comando (tabela, operação,
 * filtros, dados) e responde o que o cenário mandar. Nada vai a banco nenhum.
 *
 * O QUE PROVA
 *   1. Ordem: remoções, depois quantidade, depois alterações e inclusões.
 *   2. Remoção em comando ÚNICO, com todos os ids.
 *   3. Remoção falha: nenhuma quantidade gravada, nada mais é tentado.
 *   4. Reserva de QR (23503 em chave `producao_acesso_*`): mensagem amigável com
 *      o modelo, sem texto técnico; o texto técnico vai para o log.
 *   5. Remoção ok e inclusão falha: a quantidade é devolvida e o valor conferido.
 *   6. Fluxo comum e Mapa de Teatro: mesmos dados gravados que a montagem antiga.
 */
import {
  TEXTO_RESERVA_DE_QR,
  chaveVioladaDoErro,
  ehReservaDeQr,
  gravarLotesDoItem,
  idsCitadosNoErro,
  mensagemDeReservaDeQr,
  type LoteParaGravar
} from "../../src/features/orcamentos/services/gravar-lotes.server.ts";
import { anularColunasEscondidas, checklistVisivel, omitirColunasEscondidas } from "../../src/features/orcamentos/lib/checklist-lote.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : `\n       obtido:   ${JSON.stringify(obtido)}\n       esperado: ${JSON.stringify(esperado)}`}`);
}

/* ------------------------------------------------------------ cliente falso */

type Comando = { tabela: string; operacao: "select" | "insert" | "update" | "delete"; dados?: unknown; colunas?: string; filtros: [string, string, unknown][] };
type Resposta = { data?: unknown; error?: { code?: string; message?: string; details?: string } | null };

function clienteFalso(responder: (comando: Comando, comandos: Comando[]) => Resposta | undefined) {
  const comandos: Comando[] = [];
  const from = (tabela: string) => {
    const comando: Comando = { tabela, operacao: "select", filtros: [] };
    let anotado = false;
    const resolver = () => {
      if (!anotado) { comandos.push(comando); anotado = true; }
      return Promise.resolve({ data: null, error: null, ...(responder(comando, comandos) ?? {}) });
    };
    const construtor: Record<string, unknown> = {
      select(colunas?: string) { if (comando.operacao === "select") comando.colunas = colunas; return construtor; },
      insert(dados: unknown) { comando.operacao = "insert"; comando.dados = dados; return construtor; },
      update(dados: unknown) { comando.operacao = "update"; comando.dados = dados; return construtor; },
      delete() { comando.operacao = "delete"; return construtor; },
      eq(c: string, v: unknown) { comando.filtros.push(["eq", c, v]); return construtor; },
      in(c: string, v: unknown) { comando.filtros.push(["in", c, v]); return construtor; },
      order() { return construtor; },
      limit() { return construtor; },
      returns() { return construtor; },
      maybeSingle() { return resolver(); },
      then(aoResolver: (r: unknown) => unknown, aoFalhar?: (e: unknown) => unknown) { return resolver().then(aoResolver, aoFalhar); }
    };
    return construtor;
  };
  return { cliente: { from } as never, comandos };
}

/** Só as ESCRITAS, em texto curto: é a ordem que interessa. */
const escritas = (comandos: Comando[]) =>
  comandos
    .filter((c) => c.operacao !== "select")
    .map((c) => `${c.operacao} ${c.tabela}${c.tabela === "produtos_proposta" ? ` qtd=${(c.dados as { qtd: number }).qtd}` : ""}`);

const SEM_REGRA = checklistVisivel([]);
const AGORA = "2026-10-07T15:00:00.000Z";
const lote = (extra: Partial<LoteParaGravar>): LoteParaGravar => ({
  nome_modelo: "Lote A", quantidade: 100, padrao: "Azul", tipo_numeracao: "SEQUENCIAL", numeracao_inicio: 1, numeracao_fim: 100,
  verso_tipo: "SÓ FRENTE", bloco: "50", gabarito_operacional: "001", variacoes_texto: null, ...extra
});

function entrada(extra: { lotes: LoteParaGravar[]; removerIds?: number[]; qtdAtual: number; vinculos?: Map<LoteParaGravar, object>; visivel?: typeof SEM_REGRA }) {
  const log: string[] = [];
  let reconsolidacoes = 0;
  return {
    log,
    reconsolidacoes: () => reconsolidacoes,
    dados: {
      idInt: 900001,
      idProdutoProposta: 7001,
      lotes: extra.lotes,
      removerIds: extra.removerIds ?? [],
      vinculos: (extra.vinculos ?? new Map()) as Map<LoteParaGravar, object>,
      visivel: extra.visivel ?? SEM_REGRA,
      qtdAtual: extra.qtdAtual,
      soma: extra.lotes.reduce((t, l) => t + Number(l.quantidade), 0),
      agora: AGORA,
      reconsolidar: async () => { reconsolidacoes += 1; },
      registrar: (mensagem: string, detalhe?: unknown) => { log.push(`${mensagem} ${JSON.stringify(detalhe ?? "")}`); }
    }
  };
}

const ERRO_QR = {
  code: "23503",
  message: 'update or delete on table "pedidos_modelos" violates foreign key constraint "producao_acesso_qr_contratos_modelo_fkey" on table "producao_acesso_qr_contratos"',
  details: 'Key (id)=(5002) is still referenced from table "producao_acesso_qr_contratos".'
};

/* ----------------------------------------------- 0. leitura do erro do banco */
checar("chave violada sai do texto do banco", chaveVioladaDoErro(ERRO_QR), "producao_acesso_qr_contratos_modelo_fkey");
checar("23503 em chave producao_acesso_ e reserva de QR", ehReservaDeQr(ERRO_QR), true);
checar(
  "outra chave, outro codigo ou erro vazio NAO sao reserva de QR",
  [
    ehReservaDeQr({ code: "23503", message: 'violates foreign key constraint "producao_volume_itens_modelo_id_fkey" on table "x"' }),
    ehReservaDeQr({ code: "42501", message: ERRO_QR.message }),
    ehReservaDeQr({ code: "23503", message: "sem nome de chave" }),
    ehReservaDeQr(null)
  ],
  [false, false, false, false]
);
checar("id citado no detalhe do erro", idsCitadosNoErro(ERRO_QR), [5002]);
checar("mensagem com um modelo", mensagemDeReservaDeQr([{ id: 5002, nome: "Pista" }], true, 0), `${TEXTO_RESERVA_DE_QR} Modelo bloqueado: #5002 Pista. Nada foi gravado.`);
checar(
  "mensagem quando o banco nao disse qual",
  mensagemDeReservaDeQr([{ id: 5001, nome: "A" }, { id: 5002, nome: null }], false, 0),
  `${TEXTO_RESERVA_DE_QR} Um ou mais destes modelos estão bloqueados: #5001 A; #5002. Nada foi gravado.`
);

/* ------------------------------------------ 1 e 2. ordem e comando único */
{
  const { cliente, comandos } = clienteFalso((c) => (c.tabela === "propostas" ? { data: { valor: 100, valor_total: 120 } } : c.colunas === "ordem" ? { data: [{ ordem: 4 }] } : undefined));
  const e = entrada({ lotes: [lote({ id: 5001, quantidade: 300 }), lote({ nome_modelo: "Novo", quantidade: 200 })], removerIds: [5002, 5003, 5004], qtdAtual: 1000 });
  const r = await gravarLotesDoItem(cliente, e.dados);
  checar("fluxo completo grava", r, { ok: true });
  checar("ordem: remocao, quantidade, alteracao, inclusao", escritas(comandos), ["delete pedidos_modelos", "update produtos_proposta qtd=500", "update pedidos_modelos", "insert pedidos_modelos"]);
  const remocoes = comandos.filter((c) => c.operacao === "delete");
  checar("remocao em UM comando, com todos os ids e presa ao item", [remocoes.length, remocoes[0].filtros], [1, [["in", "id", [5002, 5003, 5004]], ["eq", "id_produto_proposta_origem", 7001]]]);
  checar("nada foi devolvido nem reconsolidado no fluxo bom", e.reconsolidacoes(), 0);
}

/* --------------------------------------------- 3. remoção falha: nada gravado */
{
  const { cliente, comandos } = clienteFalso((c) => (c.operacao === "delete" ? { error: { code: "40001", message: "could not serialize access" } } : undefined));
  const e = entrada({ lotes: [lote({ id: 5001, quantidade: 300 }), lote({ nome_modelo: "Novo", quantidade: 200 })], removerIds: [5002], qtdAtual: 1000 });
  const r = await gravarLotesDoItem(cliente, e.dados);
  checar("remocao falha: so o delete foi tentado; quantidade NAO gravada", escritas(comandos), ["delete pedidos_modelos"]);
  checar("remocao falha: resposta diz que nada foi gravado, sem texto do banco", r.ok ? null : [r.code, r.message, r.extra], ["REMOCAO_FALHOU", "Não foi possível remover os lotes. Nada foi gravado.", { nadaGravado: true }]);
  checar("remocao falha: o texto do banco foi para o log", e.log.some((l) => l.includes("could not serialize access")), true);
}

/* -------------------------------------------------------- 4. reserva de QR */
{
  const { cliente, comandos } = clienteFalso((c) =>
    c.operacao === "delete" ? { error: ERRO_QR } : c.colunas === "id, nome_modelo" ? { data: [{ id: 5002, nome_modelo: "Pista Premium" }] } : undefined
  );
  const e = entrada({ lotes: [lote({ id: 5001, quantidade: 9800 })], removerIds: [5002], qtdAtual: 10300 });
  const r = await gravarLotesDoItem(cliente, e.dados);
  checar("reserva de QR: nenhuma escrita alem do delete recusado (quantidade intacta)", escritas(comandos), ["delete pedidos_modelos"]);
  checar("reserva de QR: codigo, status e modelos", r.ok ? null : [r.code, r.status, r.extra], ["RESERVA_QR", 409, { modelosBloqueados: [{ id: 5002, nome: "Pista Premium" }], nadaGravado: true }]);
  checar("reserva de QR: mensagem amigavel com id e nome", r.ok ? null : r.message, `${TEXTO_RESERVA_DE_QR} Modelo bloqueado: #5002 Pista Premium. Nada foi gravado.`);
  checar("reserva de QR: sem texto tecnico na tela", r.ok ? null : /foreign key|constraint|producao_acesso|23503|fkey/i.test(r.message), false);
  checar("reserva de QR: o texto tecnico esta no log", e.log.some((l) => l.includes("producao_acesso_qr_contratos_modelo_fkey")), true);
  checar("reserva de QR: nenhum comando toca tabela do parceiro", comandos.some((c) => c.tabela.startsWith("producao_acesso")), false);
}
{
  // Vários lotes na remoção: o banco cita um; os outros também não saem.
  const { cliente } = clienteFalso((c) => (c.operacao === "delete" ? { error: ERRO_QR } : c.colunas === "id, nome_modelo" ? { data: [{ id: 5002, nome_modelo: "Pista" }] } : undefined));
  const r = await gravarLotesDoItem(cliente, entrada({ lotes: [lote({ id: 5001 })], removerIds: [5002, 5003], qtdAtual: 600 }).dados);
  checar("reserva de QR com varios lotes: cita o bloqueado e avisa dos outros", r.ok ? null : r.message, `${TEXTO_RESERVA_DE_QR} Modelo bloqueado: #5002 Pista. Os outros lotes marcados para remoção também não foram removidos. Nada foi gravado.`);
}
{
  // O banco não disse qual: lista todos os que estavam saindo.
  const { cliente } = clienteFalso((c) => (c.operacao === "delete" ? { error: { ...ERRO_QR, details: "" } } : c.colunas === "id, nome_modelo" ? { data: [{ id: 5002, nome_modelo: "Pista" }, { id: 5003, nome_modelo: "Camarote" }] } : undefined));
  const r = await gravarLotesDoItem(cliente, entrada({ lotes: [lote({ id: 5001 })], removerIds: [5002, 5003], qtdAtual: 600 }).dados);
  checar("reserva de QR sem detalhe: lista os candidatos", r.ok ? null : r.message, `${TEXTO_RESERVA_DE_QR} Um ou mais destes modelos estão bloqueados: #5002 Pista; #5003 Camarote. Nada foi gravado.`);
}

/* ------------------------ 5. remoção ok, inclusão falha: quantidade devolvida */
{
  let valor = { valor: 2718, valor_total: 2836.94 };
  const { cliente, comandos } = clienteFalso((c) => {
    if (c.tabela === "produtos_proposta" && c.operacao === "update") {
      // O gatilho do banco recalcula a proposta quando a quantidade muda.
      valor = (c.dados as { qtd: number }).qtd === 1000 ? { valor: 2718, valor_total: 2836.94 } : { valor: 2588, valor_total: 2706.94 };
      return undefined;
    }
    if (c.tabela === "propostas") return { data: { ...valor } };
    if (c.operacao === "insert") return { error: { code: "23502", message: 'null value in column "x" violates not-null constraint' } };
    return undefined;
  });
  const e = entrada({ lotes: [lote({ id: 5001, quantidade: 300 }), lote({ nome_modelo: "Novo", quantidade: 200 })], removerIds: [5002], qtdAtual: 1000 });
  const r = await gravarLotesDoItem(cliente, e.dados);
  checar("inclusao falha: a quantidade e gravada e depois DEVOLVIDA", escritas(comandos), ["delete pedidos_modelos", "update produtos_proposta qtd=500", "update pedidos_modelos", "insert pedidos_modelos", "update produtos_proposta qtd=1000"]);
  checar("inclusao falha: a proposta foi reconsolidada uma vez", e.reconsolidacoes(), 1);
  checar("inclusao falha: o que ficou", r.ok ? null : [r.code, r.extra], ["PARCIAL", { lotesRemovidos: 1, lotesAlterados: 1, quantidadeDevolvida: true, valorConferido: true }]);
  checar(
    "inclusao falha: a mensagem conta o que ficou, sem texto do banco",
    r.ok ? null : r.message,
    "Os 1 lote(s) novo(s) não foram incluídos. A quantidade do item voltou para 1000 e o valor da proposta voltou a R$ 2836,94. O que já tinha sido gravado continua: 1 lote(s) removido(s) e 1 alterado(s)."
  );
}
{
  // A quantidade volta, mas o valor da proposta não: a mensagem pede conferência.
  let leituras = 0;
  const { cliente } = clienteFalso((c) => {
    if (c.tabela === "propostas") { leituras += 1; return { data: leituras === 1 ? { valor: 100, valor_total: 120 } : { valor: 90, valor_total: 110 } }; }
    if (c.tabela === "pedidos_modelos" && c.operacao === "update") return { error: { code: "XX000", message: "falha simulada" } };
    return undefined;
  });
  const r = await gravarLotesDoItem(cliente, entrada({ lotes: [lote({ id: 5001, quantidade: 300 })], qtdAtual: 1000 }).dados);
  checar("valor nao voltou: avisa e marca como nao conferido", r.ok ? null : [r.message, r.extra], ['O lote "Lote A" não foi alterado. A quantidade do item voltou para 1000 e o valor da proposta ficou em R$ 110,00 (antes era R$ 120,00): confira.', { lotesRemovidos: 0, lotesAlterados: 0, quantidadeDevolvida: true, valorConferido: false }]);
}
{
  // A devolução também falha: a mensagem diz com que quantidade ficou.
  let gravacoesDeQtd = 0;
  const { cliente } = clienteFalso((c) => {
    if (c.tabela === "produtos_proposta" && c.operacao === "update") { gravacoesDeQtd += 1; return gravacoesDeQtd === 2 ? { error: { message: "queda de conexao" } } : undefined; }
    if (c.operacao === "insert") return { error: { message: "falha simulada" } };
    return undefined;
  });
  const r = await gravarLotesDoItem(cliente, entrada({ lotes: [lote({ nome_modelo: "Novo", quantidade: 200 })], qtdAtual: 1000 }).dados);
  checar("devolucao falhou: diz que a quantidade ficou na nova", r.ok ? null : [r.message, r.extra?.quantidadeDevolvida], ["Os 1 lote(s) novo(s) não foram incluídos. A quantidade do item ficou em 200 e não pôde ser devolvida a 1000: confira a quantidade e o valor da proposta.", false]);
}
{
  // Soma igual à quantidade atual: a quantidade nem é tocada, e não há o que devolver.
  const { cliente, comandos } = clienteFalso((c) => (c.operacao === "insert" ? { error: { message: "falha simulada" } } : undefined));
  const e = entrada({ lotes: [lote({ nome_modelo: "Novo", quantidade: 200 })], qtdAtual: 200 });
  const r = await gravarLotesDoItem(cliente, e.dados);
  checar("soma igual: nenhuma escrita em produtos_proposta", escritas(comandos), ["insert pedidos_modelos"]);
  checar("soma igual: mensagem diz que a quantidade nao mudou", r.ok ? null : r.message, "Os 1 lote(s) novo(s) não foram incluídos. A quantidade do item não mudou (200).");
}
{
  // Remoção ok e a quantidade falha: os lotes saíram, e a mensagem diz isso.
  const { cliente } = clienteFalso((c) => (c.tabela === "produtos_proposta" && c.operacao === "update" ? { error: { message: "falha simulada" } } : undefined));
  const r = await gravarLotesDoItem(cliente, entrada({ lotes: [lote({ id: 5001, quantidade: 300 })], removerIds: [5002], qtdAtual: 1000 }).dados);
  checar("quantidade falha depois da remocao: avisa o que ficou", r.ok ? null : r.message, "1 lote(s) foram removidos, mas a quantidade do item não foi gravada: continua em 1000. Grave de novo para acertar a quantidade.");
}

/* ------------------------- 6. fluxo comum e Mapa de Teatro: dados idênticos */
/** A montagem do INSERT como a rota fazia antes desta mudança. */
function linhaAntiga(l: LoteParaGravar, ordem: number, visivel: typeof SEM_REGRA, vinculo?: object) {
  return {
    ...anularColunasEscondidas(
      {
        id_int: 900001, id_produto_proposta_origem: 7001, nome_modelo: String(l.nome_modelo).trim(), padrao: l.padrao?.trim() || null,
        quantidade: Number(l.quantidade), tipo_numeracao: l.tipo_numeracao || "SEM_NUMERACAO", numeracao_inicio: l.numeracao_inicio ?? null,
        numeracao_fim: l.numeracao_fim ?? null, verso_tipo: l.verso_tipo?.trim() || null, bloco: l.bloco?.trim() || null,
        gabarito_operacional: l.gabarito_operacional?.trim() || null, variacoes_texto: l.variacoes_texto?.trim() || null,
        Q_CAM: l.Q_CAM ?? null, L_CAM: l.L_CAM ?? null, C_INI: l.C_INI ?? null, status_arte: "PENDENTE", status_producao: "PENDENTE",
        ordem, created_at: AGORA, updated_at: AGORA
      },
      visivel
    ),
    ...(vinculo ? { ...vinculo, numeracao_inicio: null, numeracao_fim: null } : {})
  };
}
function patchAntigo(l: LoteParaGravar, visivel: typeof SEM_REGRA) {
  return omitirColunasEscondidas(
    {
      nome_modelo: String(l.nome_modelo).trim(), quantidade: Number(l.quantidade), padrao: l.padrao?.trim() || null,
      tipo_numeracao: l.tipo_numeracao || "SEM_NUMERACAO", numeracao_inicio: l.numeracao_inicio ?? null, numeracao_fim: l.numeracao_fim ?? null,
      verso_tipo: l.verso_tipo?.trim() || null, bloco: l.bloco?.trim() || null, gabarito_operacional: l.gabarito_operacional?.trim() || null,
      variacoes_texto: l.variacoes_texto?.trim() || null, Q_CAM: l.Q_CAM ?? null, L_CAM: l.L_CAM ?? null, C_INI: l.C_INI ?? null, updated_at: AGORA
    },
    visivel
  );
}
for (const [rotulo, visivel] of [["produto sem checklist", SEM_REGRA], ["produto que nao imprime numeracao nem verso", checklistVisivel(["cor", "imagem"])]] as const) {
  const existente = lote({ id: 5001, nome_modelo: "  Existente ", quantidade: 300 });
  const novoA = lote({ nome_modelo: "Novo A", quantidade: 120, Q_CAM: 2, L_CAM: 3, C_INI: 1 });
  const novoB = lote({ nome_modelo: "Novo B", quantidade: 80, tipo_numeracao: "" });
  const { cliente, comandos } = clienteFalso((c) => (c.colunas === "ordem" ? { data: [{ ordem: 7 }] } : undefined));
  const r = await gravarLotesDoItem(cliente, entrada({ lotes: [existente, novoA, novoB], qtdAtual: 500, visivel }).dados);
  checar(`comum (${rotulo}): grava`, r, { ok: true });
  checar(`comum (${rotulo}): soma igual nao regrava a quantidade`, escritas(comandos), ["update pedidos_modelos", "insert pedidos_modelos"]);
  checar(`comum (${rotulo}): UPDATE identico a montagem antiga`, comandos.find((c) => c.operacao === "update")?.dados, patchAntigo(existente, visivel));
  checar(`comum (${rotulo}): UPDATE preso ao lote e ao item`, comandos.find((c) => c.operacao === "update")?.filtros, [["eq", "id", 5001], ["eq", "id_produto_proposta_origem", 7001]]);
  checar(`comum (${rotulo}): INSERT identico a montagem antiga, em um comando`, comandos.filter((c) => c.operacao === "insert").map((c) => c.dados), [[linhaAntiga(novoA, 8, visivel), linhaAntiga(novoB, 9, visivel)]]);
}
{
  const setor = lote({ nome_modelo: "Plateia", quantidade: 240, mapa_teatro_id: "11111111-1111-4111-8111-111111111111", mapa_teatro_setor_id: "s1" });
  const vinculo = { mapa_teatro_id: "11111111-1111-4111-8111-111111111111", mapa_teatro_setor_id: "s1", mapa_teatro_revisao: "abc", mapa_teatro_snapshot: { mapa: { nome: "Teatro" } } };
  const comum = lote({ nome_modelo: "Comum", quantidade: 60 });
  const { cliente, comandos } = clienteFalso((c) => (c.tabela === "propostas" ? { data: { valor: 1, valor_total: 2 } } : undefined));
  const r = await gravarLotesDoItem(cliente, entrada({ lotes: [setor, comum], qtdAtual: 0, vinculos: new Map([[setor, vinculo]]) }).dados);
  checar("mapa teatro: grava", r, { ok: true });
  checar("mapa teatro: quantidade antes da inclusao, como antes", escritas(comandos), ["update produtos_proposta qtd=300", "insert pedidos_modelos"]);
  checar("mapa teatro: INSERT identico a montagem antiga (vinculo no setor, sem numeracao; lote comum sem vinculo)", comandos.find((c) => c.operacao === "insert")?.dados, [linhaAntiga(setor, 1, SEM_REGRA, vinculo), linhaAntiga(comum, 2, SEM_REGRA)]);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
