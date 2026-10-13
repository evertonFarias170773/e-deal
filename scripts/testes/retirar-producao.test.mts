/**
 * Testes de "Retirar da Producao": a regra, a gravacao (com banco simulado) e a estrutura.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/retirar-producao.test.mts
 *
 * Nada vai ao banco. Conferem, por pedido, o status e a flag ANTES e DEPOIS, a linha
 * do log e as escritas feitas.
 */
import { readFileSync } from "node:fs";
import {
  ORIGEM_LOG_RETIRAR_PRODUCAO,
  PAYLOAD_DEVOLUCAO_AO_ATENDENTE,
  decidirRetirada,
  podeVerRetirarDaProducao
} from "../../src/features/orcamentos/lib/retirar-producao.ts";
import { retirarPedidoDaProducao } from "../../src/features/orcamentos/services/retirar-producao.server.ts";

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

// ───────────── Supabase falso ─────────────
type Valor = string | number | boolean | null | undefined;
type Linha = Record<string, Valor>;
type Banco = { propostas: Linha[]; propostas_os: Linha[]; propostas_os_setores: Linha[]; os_status_log: Linha[]; notas_fiscais: Linha[]; notas_servico: Linha[] };
type Cliente = Parameters<typeof retirarPedidoDaProducao>[0];
type Opcoes = {
  falhas?: Record<string, { code?: string; message: string }>;
  antes?: Record<string, (banco: Banco) => void>;
};

function criarFalso(banco: Banco, opcoes: Opcoes = {}) {
  const escritas: string[] = [];
  const payloads: Linha[] = [];
  const executar = (tabela: keyof Banco, modo: string, payload: Linha | null, filtros: Array<[string, string, Valor]>, retorna: boolean, limite: number | null) => {
    const linhas = banco[tabela];
    const casa = (l: Linha) => filtros.every(([tipo, col, val]) => (tipo === "eq" ? l[col] === val : l[col] === null || l[col] === undefined));
    if (modo === "select") {
      const chave = `${tabela}.select`;
      const falha = opcoes.falhas?.[chave];
      if (falha) return { data: null, error: falha };
      const achadas = linhas.filter(casa);
      return { data: limite ? achadas.slice(0, limite) : achadas, error: null };
    }
    const chave = `${tabela}.update`;
    opcoes.antes?.[chave]?.(banco);
    escritas.push(chave);
    if (payload) payloads.push({ ...payload });
    const falha = opcoes.falhas?.[chave];
    if (falha) return { data: null, error: falha };
    const alvo = linhas.filter(casa);
    for (const l of alvo) Object.assign(l, payload ?? {});
    return { data: retorna ? alvo.map((l) => ({ id_int: l.id_int })) : null, error: null };
  };

  class Consulta {
    private modo = "select";
    private payload: Linha | null = null;
    private filtros: Array<[string, string, Valor]> = [];
    private retorna = false;
    private limite: number | null = null;
    private tabela: keyof Banco;
    constructor(tabela: keyof Banco) { this.tabela = tabela; }
    select() { if (this.modo === "update") this.retorna = true; return this; }
    update(p: Linha) { this.modo = "update"; this.payload = p; return this; }
    eq(c: string, v: Valor) { this.filtros.push(["eq", c, v]); return this; }
    is(c: string, v: Valor) { this.filtros.push(["is", c, v]); return this; }
    limit(n: number) { this.limite = n; return this; }
    maybeSingle() {
      const r = executar(this.tabela, "select", null, this.filtros, false, null);
      return Promise.resolve({ data: ((r.data as Linha[] | null) ?? [])[0] ?? null, error: r.error });
    }
    then<R1 = unknown, R2 = never>(res?: ((v: unknown) => R1 | PromiseLike<R1>) | null, rej?: ((e: unknown) => R2 | PromiseLike<R2>) | null) {
      return Promise.resolve(executar(this.tabela, this.modo, this.payload, this.filtros, this.retorna, this.limite)).then(res, rej);
    }
  }

  const client = {
    from(tabela: keyof Banco) {
      const q = new Consulta(tabela);
      return Object.assign(q, {
        insert(payload: Linha) {
          const chave = `${tabela}.insert`;
          opcoes.antes?.[chave]?.(banco);
          escritas.push(chave);
          const falha = opcoes.falhas?.[chave];
          if (falha) return Promise.resolve({ error: falha });
          banco[tabela].push({ ...payload });
          return Promise.resolve({ error: null });
        }
      });
    }
  };
  return { client: client as unknown as Cliente, escritas, payloads };
}

const AUTOR = { uid: "uid-gerente", nome: "Gerente Teste" };
const novoBanco = (status: string | null = "REVISAO PRODUCAO", flag: boolean | null = true, extra: Partial<Banco> = {}): Banco => ({
  propostas: [{ id_int: 100, status_interno: status, is_prd_aprovado: flag, liberado_producao_em: "2026-10-09T10:00:00Z" }],
  propostas_os: [],
  propostas_os_setores: [],
  os_status_log: [],
  notas_fiscais: [],
  notas_servico: [],
  ...extra
});
const rodar = (banco: Banco, opcoes: Opcoes = {}, idInt = 100) => {
  const f = criarFalso(banco, opcoes);
  return retirarPedidoDaProducao(f.client, { idInt, autor: AUTOR }).then((r) => ({ r, escritas: f.escritas, payloads: f.payloads }));
};

// ── 1. A regra pura ──
const base = { isPrdAprovado: true, temOs: false, temSetores: false };
checar("regra: REVISAO PRODUCAO sem OS retira", decidirRetirada({ ...base, statusInterno: "REVISAO PRODUCAO" }).acao, "retirar");
checar("regra: ja em REVISAO ATENDENTE (flag desligada) e idempotente", decidirRetirada({ ...base, statusInterno: "REVISAO ATENDENTE", isPrdAprovado: false }).acao, "idempotente");
checar("regra: REVISAO ATENDENTE com flag nula tambem e idempotente", decidirRetirada({ ...base, statusInterno: "REVISAO ATENDENTE", isPrdAprovado: null }).acao, "idempotente");
checar("regra: REVISAO ATENDENTE com a flag ainda ligada so limpa a flag (retira)", decidirRetirada({ ...base, statusInterno: "REVISAO ATENDENTE" }).acao, "retirar");
for (const s of ["EM PRODUCAO", "EM IMPRESSAO", "EM IMPRESSAO / PENDENTE", "EM ACABAMENTO", "EM ACABAMENTO / PENDENTE", "EXPEDICAO", "A RETIRAR", "EM TRANSITO", "RECEBIDO", "ENTREGUE"]) {
  const d = decidirRetirada({ ...base, statusInterno: s });
  checar(`regra: ${s} e recusado (devolucao pela producao)`, [d.acao, d.acao === "recusar" && d.code], ["recusar", "DEVOLUCAO_PELA_PRODUCAO"]);
}
checar("regra: REVISAO PRODUCAO com OS e recusado", decidirRetirada({ ...base, statusInterno: "REVISAO PRODUCAO", temOs: true }).acao, "recusar");
checar("regra: REVISAO PRODUCAO com setores e recusado", decidirRetirada({ ...base, statusInterno: "REVISAO PRODUCAO", temSetores: true }).acao, "recusar");
for (const s of ["NOVO", "AGUARDANDO", "LIBERADO", "CANCELADO", "", null]) {
  const d = decidirRetirada({ ...base, statusInterno: s });
  checar(`regra: ${JSON.stringify(s)} (ainda nao esta na producao) e recusado`, [d.acao, d.acao === "recusar" && d.code], ["recusar", "FORA_DA_PRODUCAO"]);
}
checar("regra: caixa e espaco no status nao enganam", decidirRetirada({ ...base, statusInterno: " revisao producao " }).acao, "retirar");
checar("menu: so em REVISAO PRODUCAO com a flag ligada", [
  podeVerRetirarDaProducao({ statusInterno: "REVISAO PRODUCAO", isPrdAprovado: true }),
  podeVerRetirarDaProducao({ statusInterno: "EM PRODUCAO", isPrdAprovado: true }),
  podeVerRetirarDaProducao({ statusInterno: "REVISAO PRODUCAO", isPrdAprovado: false }),
  podeVerRetirarDaProducao({ statusInterno: "REVISAO ATENDENTE", isPrdAprovado: true })
], [true, false, false, false]);

// ── 2. Gravacao: REVISAO PRODUCAO sem OS retira e volta a REVISAO ATENDENTE ──
{
  const banco = novoBanco();
  const { r, escritas, payloads } = await rodar(banco);
  checar("retira: sucesso e nao idempotente", [r.success, r.success && r.idempotente], [true, false]);
  checar("retira: status e flag mudam JUNTOS", [banco.propostas[0].status_interno, banco.propostas[0].is_prd_aprovado], ["REVISAO ATENDENTE", false]);
  checar("retira: a gravacao e exatamente a da devolucao ao atendente", payloads[0], { ...PAYLOAD_DEVOLUCAO_AO_ATENDENTE });
  checar("retira: o carimbo liberado_producao_em e preservado", banco.propostas[0].liberado_producao_em, "2026-10-09T10:00:00Z");
  checar("retira: so um UPDATE em propostas e um registro de log", escritas, ["propostas.update", "os_status_log.insert"]);
  const log = banco.os_status_log[0];
  checar("retira: log com origem, status, autor e tipo", [log.origem, log.status_anterior, log.status_novo, log.resultado, log.ator_uid, log.ator_nome, log.ator_tipo, log.tipo_transicao, log.id_int],
    [ORIGEM_LOG_RETIRAR_PRODUCAO, "REVISAO PRODUCAO", "REVISAO ATENDENTE", "sucesso", "uid-gerente", "Gerente Teste", "USUARIO", "RETORNO", 100]);
  checar("retira: resposta sem aviso e com log gravado", r.success && !r.idempotente ? [r.logGravado, r.aviso, r.statusAnterior] : null, [true, null, "REVISAO PRODUCAO"]);

  // repetir: idempotente
  const antes = JSON.stringify(banco);
  const repetida = await rodar(banco);
  checar("repetir: idempotente, sem escrita e sem segundo log", [repetida.r.success, repetida.r.success && repetida.r.idempotente, repetida.escritas, banco.os_status_log.length], [true, true, [], 1]);
  checar("repetir: banco identico", JSON.stringify(banco), antes);
}

// ── 3. Recusas: nada e gravado ──
for (const status of ["EM PRODUCAO", "EM IMPRESSAO", "EM ACABAMENTO / PENDENTE", "EXPEDICAO", "EM TRANSITO", "ENTREGUE"]) {
  const banco = novoBanco(status, true, { propostas_os: [{ id_int: 100 }], propostas_os_setores: [{ id_int: 100 }] });
  const { r, escritas } = await rodar(banco);
  checar(`recusa ${status}: 409 e nada gravado`, [r.success, !r.success && r.httpStatus, !r.success && r.code, escritas, banco.propostas[0].status_interno, banco.propostas[0].is_prd_aprovado], [false, 409, "DEVOLUCAO_PELA_PRODUCAO", [], status, true]);
  checar(`recusa ${status}: a mensagem diz que a devolucao e da producao`, !r.success && /feita pela produção/.test(r.message), true);
}
{
  const banco = novoBanco("REVISAO PRODUCAO", true, { propostas_os: [{ id_int: 100 }] });
  const { r, escritas } = await rodar(banco);
  checar("pedido com OS (mesmo em REVISAO PRODUCAO): recusado, nada gravado", [r.success, !r.success && r.code, escritas, banco.propostas[0].status_interno], [false, "DEVOLUCAO_PELA_PRODUCAO", [], "REVISAO PRODUCAO"]);
}
{
  const banco = novoBanco("REVISAO PRODUCAO", true, { propostas_os_setores: [{ id_int: 100 }] });
  const { r, escritas } = await rodar(banco);
  checar("pedido com setores (sem OS): recusado, nada gravado", [r.success, !r.success && r.code, escritas], [false, "DEVOLUCAO_PELA_PRODUCAO", []]);
}
for (const status of ["NOVO", "AGUARDANDO", "LIBERADO", "CANCELADO", null]) {
  const banco = novoBanco(status, false);
  const { r, escritas } = await rodar(banco);
  checar(`status ${JSON.stringify(status)}: 409 FORA_DA_PRODUCAO e nada gravado`, [r.success, !r.success && r.httpStatus, !r.success && r.code, escritas], [false, 409, "FORA_DA_PRODUCAO", []]);
}
{
  const { r, escritas } = await rodar(novoBanco(), {}, 999);
  checar("pedido inexistente: 404 sem escrita", [r.success, !r.success && r.httpStatus, escritas], [false, 404, []]);
}

// ── 4. Estados fora do comum ──
{
  const banco = novoBanco("REVISAO PRODUCAO", false); // o estado "preso": REVISAO PRODUCAO sem a flag
  const { r } = await rodar(banco);
  checar("REVISAO PRODUCAO com a flag ja desligada (o estado preso) volta ao atendente", [r.success, banco.propostas[0].status_interno, banco.propostas[0].is_prd_aprovado], [true, "REVISAO ATENDENTE", false]);
}
{
  const banco = novoBanco("REVISAO ATENDENTE", true);
  const { r } = await rodar(banco);
  checar("REVISAO ATENDENTE com a flag ligada: so a flag cai", [r.success, banco.propostas[0].status_interno, banco.propostas[0].is_prd_aprovado], [true, "REVISAO ATENDENTE", false]);
}
{
  const banco = novoBanco("REVISAO PRODUCAO", null);
  const { r } = await rodar(banco);
  checar("flag nula: o UPDATE guardado usa IS NULL e funciona", [r.success, banco.propostas[0].status_interno, banco.propostas[0].is_prd_aprovado], [true, "REVISAO ATENDENTE", false]);
}

// ── 5. Corrida e falhas ──
{
  const banco = novoBanco();
  const { r, escritas } = await rodar(banco, { antes: { "propostas.update": (b) => { b.propostas[0].status_interno = "EM PRODUCAO"; } } });
  checar("status mudou no meio: 409 STATUS_MUDOU, sem gravar e sem log", [r.success, !r.success && r.code, banco.propostas[0].status_interno, banco.propostas[0].is_prd_aprovado, banco.os_status_log.length], [false, "STATUS_MUDOU", "EM PRODUCAO", true, 0]);
  checar("status mudou no meio: so tentou o UPDATE (que nao casou)", escritas, ["propostas.update"]);
}
{
  const banco = novoBanco();
  const { r } = await rodar(banco, { antes: { "propostas.update": (b) => { b.propostas[0].status_interno = "REVISAO ATENDENTE"; b.propostas[0].is_prd_aprovado = false; } } });
  checar("outro clique chegou primeiro: idempotente, sem log", [r.success, r.success && r.idempotente, banco.os_status_log.length], [true, true, 0]);
}
{
  const banco = novoBanco();
  const { r } = await rodar(banco, { falhas: { "propostas.update": { message: "erro de teste" } } });
  checar("UPDATE falhou: 500, nada muda, sem log", [r.success, !r.success && r.httpStatus, banco.propostas[0].status_interno, banco.os_status_log.length], [false, 500, "REVISAO PRODUCAO", 0]);
}
{
  const banco = novoBanco();
  const { r, escritas } = await rodar(banco, { falhas: { "propostas_os.select": { message: "sem acesso" } } });
  checar("nao conseguiu conferir a OS: nao decide e nao grava", [r.success, !r.success && r.code, escritas], [false, "LEITURA_OS_FALHOU", []]);
}
{
  const banco = novoBanco();
  const { r } = await rodar(banco, { falhas: { "os_status_log.insert": { message: "sem permissao" } } });
  checar("log falhou: a retirada vale e a resposta avisa", [banco.propostas[0].status_interno, r.success && !r.idempotente ? [r.logGravado, Boolean(r.aviso)] : null], ["REVISAO ATENDENTE", [false, true]]);
}

// ── 5b. Nota fiscal emitida trava a retirada (13/10/2026) ──
{
  const banco = novoBanco("REVISAO PRODUCAO", true, { notas_fiscais: [{ id_int: 100, numero_nf: "7501", status: "AUTORIZADA", ambiente: "producao" }] });
  const { r, escritas } = await rodar(banco);
  checar("nota autorizada de producao: 409 NOTA_EMITIDA e nada gravado", [r.success, !r.success && r.httpStatus, !r.success && r.code, escritas, banco.propostas[0].status_interno, banco.propostas[0].is_prd_aprovado], [false, 409, "NOTA_EMITIDA", [], "REVISAO PRODUCAO", true]);
  checar("nota autorizada: a mensagem diz qual nota e manda cancelar", !r.success && r.message, "Este pedido tem nota fiscal emitida (NF-e 7501). Cancele a nota antes de devolvê-lo ao atendente.");
}
{
  const banco = novoBanco("REVISAO PRODUCAO", true, { notas_fiscais: [{ id_int: 100, numero_nf: "7501", status: "CANCELADA", ambiente: "producao" }, { id_int: 100, numero_nf: "9", status: "AUTORIZADA", ambiente: "homologacao" }, { id_int: 100, numero_nf: null, status: "ERRO_AUTORIZACAO", ambiente: "producao" }] });
  const { r } = await rodar(banco);
  checar("so cancelada, homologacao e erro: retira normalmente", [r.success, banco.propostas[0].status_interno, banco.propostas[0].is_prd_aprovado], [true, "REVISAO ATENDENTE", false]);
}
{
  const banco = novoBanco("REVISAO PRODUCAO", true, { notas_fiscais: [{ id_int: 200, numero_nf: "1", status: "AUTORIZADA", ambiente: "producao" }] });
  const { r } = await rodar(banco);
  checar("nota de OUTRO pedido nao trava este", [r.success, banco.propostas[0].status_interno], [true, "REVISAO ATENDENTE"]);
}
{
  const banco = novoBanco("REVISAO PRODUCAO", true);
  const { r, escritas } = await rodar(banco, { falhas: { "notas_fiscais.select": { message: "sem acesso" } } });
  checar("nao conseguiu ler as notas: recusa e nao grava", [r.success, !r.success && r.code, escritas, banco.propostas[0].status_interno], [false, "LEITURA_NOTAS_FALHOU", [], "REVISAO PRODUCAO"]);
}
{
  const banco = novoBanco("REVISAO ATENDENTE", false, { notas_fiscais: [{ id_int: 100, numero_nf: "7501", status: "AUTORIZADA", ambiente: "producao" }] });
  const { r, escritas } = await rodar(banco);
  checar("ja com o atendente e com nota: continua idempotente, sem escrita", [r.success, r.success && r.idempotente, escritas], [true, true, []]);
}
{
  const banco = novoBanco("EM PRODUCAO", true, { propostas_os: [{ id_int: 100 }], notas_fiscais: [{ id_int: 100, numero_nf: "7501", status: "AUTORIZADA", ambiente: "producao" }] });
  const { r } = await rodar(banco);
  checar("EM PRODUCAO com nota: a recusa continua sendo a da producao", !r.success && r.code, "DEVOLUCAO_PELA_PRODUCAO");
}

// ── 6. Estrutura ──
const le = (c: string) => readFileSync(c, "utf8").replace(/\r\n/g, "\n");
const servico = le("src/features/orcamentos/services/orcamentos.service.ts");
const rota = le("src/app/api/orcamentos/retirar-producao/route.ts");
const servidor = le("src/features/orcamentos/services/retirar-producao.server.ts");
const gravacao = le("src/features/orcamentos/services/devolver-atendente.server.ts");
const lista = le("src/features/orcamentos/OrcamentosListPageReal.tsx");
const proposta = le("src/features/orcamentos/OrcamentoFormPage.tsx");
const modal = le("src/features/orcamentos/components/RetirarProducaoModal.tsx");

const iDevolver = servico.indexOf("export async function devolverPropostaParaRevisaoAtendente");
const corpoDevolver = servico.slice(iDevolver, servico.indexOf("\n}\n", iDevolver));
checar('"Devolver para o atendente" nao grava mais do navegador: chama a rota', [corpoDevolver.includes('fetch("/api/orcamentos/devolver-atendente"'), corpoDevolver.includes(".update(")], [true, false]);
checar("a retirada grava pela gravacao compartilhada (sem copia do UPDATE)", [servidor.includes("gravarDevolucaoAoAtendente(supabase, {"), servidor.includes(".update("), servidor.includes('"REVISAO ATENDENTE"')], [true, false, false]);
checar("a gravacao compartilhada usa o payload unico", gravacao.includes(".update({ ...PAYLOAD_DEVOLUCAO_AO_ATENDENTE })") && !gravacao.includes('"REVISAO ATENDENTE"'), true);
checar("a retirada confere nota emitida pelo helper unico, antes de gravar", servidor.indexOf("recusaPorNotaEmitida(supabase, idInt)") > 0 && servidor.indexOf("recusaPorNotaEmitida(supabase, idInt)") < servidor.indexOf("gravarDevolucaoAoAtendente(supabase, {"), true);
checar("a rota nao grava mais so a flag: chama o servico da retirada", rota.includes("retirarPedidoDaProducao(") && !rota.includes(".update("), true);
checar("a rota continua conferindo sessao e permissao no servidor", rota.includes("verificarPermissaoServerSide") && rota.includes("propostas.release_producao") && rota.includes("SEM_PERMISSAO"), true);
checar("o UPDATE e guardado pelo status e pela flag lidos", ['consulta.eq("status_interno", statusLido)', 'consulta.eq("is_prd_aprovado", flagLida)', 'consulta.is("is_prd_aprovado", null)'].map((t) => gravacao.includes(t)), [true, true, true]);
checar("o carimbo liberado_producao_em fica de fora da gravacao (o UPDATE leva so o payload compartilhado)", !JSON.stringify(PAYLOAD_DEVOLUCAO_AO_ATENDENTE).includes("liberado_producao_em"), true);
checar("lista e proposta: com nota emitida o item fica desligado, com o motivo", [lista, proposta].map((t) => t.includes('label: "Retirar da Produção (nota emitida)", destructive: true, disabled: true, title: notaQueImpedeRetirar.get(')), [true, true]);

checar("lista: o menu abre o modal (nao retira no clique) e nao usa window.confirm para retirar", [lista.includes("onClick: () => setPedidoParaRetirar(item)"), /RETIRAR a proposta #/.test(lista)], [true, false]);
checar("lista: o modal chama a rota so no Confirmar", [lista.includes("<RetirarProducaoModal"), lista.includes("onConfirm={() => void confirmarRetirarProducao()}")], [true, true]);
checar("lista: o item so aparece onde a retirada vale", lista.includes("podeVerRetirarDaProducao({ statusInterno: item.statusInterno, isPrdAprovado: item.is_prd_aprovado })"), true);
checar("proposta: o menu abre o modal e nao usa window.confirm", [proposta.includes("onClick: () => setRetirarModalAberto(true)"), proposta.includes("Deseja RETIRAR a proposta")], [true, false]);
checar("proposta: o modal chama a rota so no Confirmar", [proposta.includes("<RetirarProducaoModal"), proposta.includes("onConfirm={() => void handleRetirarDaProducaoNaProposta()}")], [true, true]);
checar("modal: diz que o pedido volta ao atendente e sai da fila de Producao", ["volta ao atendente", "sai da fila de Produção", "REVISAO ATENDENTE", "NÃO é a ação de liberar"].map((t) => modal.includes(t)), [true, true, true, true]);
checar("modal: o foco inicial fica no Cancelar", /autoFocus\s+onClick=\{onClose\}/.test(modal), true);
checar("o item continua sendo o ultimo do menu nos dois lugares", [
  lista.indexOf('label: "Retirar da Produção"') > lista.indexOf('label: "Marcar como entregue"'),
  proposta.indexOf('"Retirar da Produção"') > proposta.indexOf('"Gerar OC"')
], [true, true]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
