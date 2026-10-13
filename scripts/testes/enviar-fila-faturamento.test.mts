/**
 * Testes de "Enviar para Fila de Faturamento" (13/10/2026) e do segundo estado aceito
 * pelo "Marcar como entregue": a regra, as duas gravacoes (banco simulado), quem pode
 * e a estrutura.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/enviar-fila-faturamento.test.mts
 *
 * Nada vai ao banco.
 */
import { readFileSync } from "node:fs";
import {
  ORIGEM_LOG_ENVIO_FILA_FATURAMENTO,
  decidirEnvioParaFila,
  estaNaFilaSemProducao,
  podeVerEnviarParaFila
} from "../../src/features/orcamentos/lib/enviar-fila-faturamento.ts";
import {
  ORIGEM_LOG_ATALHO_ENTREGUE,
  ehAdmNoServidor,
  podeVerMarcarComoEntregue,
  statusDePartidaDoAtalhoEntregue
} from "../../src/features/orcamentos/lib/marcar-entregue.ts";
import { enviarPedidoParaFilaDeFaturamento } from "../../src/features/orcamentos/services/enviar-fila-faturamento.server.ts";
import { marcarPedidoComoEntregue } from "../../src/features/orcamentos/services/marcar-entregue.server.ts";

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

// ── 1. A regra pura do envio ──
const est = (statusInterno: string | null, liberaNf: boolean | null = false, isPrdAprovado: boolean | null = false) => ({ statusInterno, liberaNf, isPrdAprovado });
checar("regra: REVISAO ATENDENTE com as duas flags desligadas envia", decidirEnvioParaFila(est("REVISAO ATENDENTE")).acao, "enviar");
checar("regra: flags nulas contam como desligadas", decidirEnvioParaFila(est("REVISAO ATENDENTE", null, null)).acao, "enviar");
checar("regra: caixa e espaco no status nao enganam", decidirEnvioParaFila(est(" revisao atendente ")).acao, "enviar");
checar("regra: libera_nf ja ligada (ja enviado) e idempotente", decidirEnvioParaFila(est("REVISAO ATENDENTE", true, false)).acao, "idempotente");
for (const s of ["NOVO", "AGUARDANDO", "EM ARTE", "REVISAO PRODUCAO", "EM PRODUCAO", "EXPEDICAO", "LIBERADO", "ENTREGUE", "CANCELADO", "", null]) {
  const d = decidirEnvioParaFila(est(s));
  checar(`regra: status ${JSON.stringify(s)} e recusado`, [d.acao, d.acao === "recusar" && d.code], ["recusar", "FORA_DE_REVISAO_ATENDENTE"]);
}
for (const liberaNf of [false, true]) {
  const d = decidirEnvioParaFila(est("REVISAO ATENDENTE", liberaNf, true));
  checar(`regra: flag de producao ligada e recusada (libera_nf ${liberaNf})`, [d.acao, d.acao === "recusar" && d.code], ["recusar", "JA_NA_PRODUCAO"]);
}
checar("regra: outro status com libera_nf ligada e recusado, nao idempotente", decidirEnvioParaFila(est("EM PRODUCAO", true, false)).acao, "recusar");

const ADM = { isAdmin: true, isSuperAdmin: false };
const SUPER = { isAdmin: false, isSuperAdmin: true };
const COMUM = { isAdmin: false, isSuperAdmin: false };
checar("menu Enviar: so ADM e so no estado certo", [
  podeVerEnviarParaFila(ADM, est("REVISAO ATENDENTE")),
  podeVerEnviarParaFila(SUPER, est("REVISAO ATENDENTE")),
  podeVerEnviarParaFila(COMUM, est("REVISAO ATENDENTE")),
  podeVerEnviarParaFila(null, est("REVISAO ATENDENTE")),
  podeVerEnviarParaFila(ADM, est("REVISAO ATENDENTE", true, false)), // ja enviado: some
  podeVerEnviarParaFila(ADM, est("REVISAO ATENDENTE", false, true)),
  podeVerEnviarParaFila(ADM, est("REVISAO PRODUCAO")),
  podeVerEnviarParaFila(ADM, est("LIBERADO"))
], [true, true, false, false, false, false, false, false]);
checar("ADM no servidor: is_admin ou is_super_adm; sem nenhum, recusado", [ehAdmNoServidor({ is_admin: true }), ehAdmNoServidor({ is_super_adm: true }), ehAdmNoServidor({ is_admin: false, is_super_adm: false }), ehAdmNoServidor(null)], [true, true, false, false]);

// ── 2. A regra pura do "Marcar como entregue" ampliado ──
checar("entregue: LIBERADO parte de LIBERADO, com qualquer flag", [statusDePartidaDoAtalhoEntregue(est("LIBERADO")), statusDePartidaDoAtalhoEntregue(est("LIBERADO", true, true)), statusDePartidaDoAtalhoEntregue(est("LIBERADO", null, null))], ["LIBERADO", "LIBERADO", "LIBERADO"]);
checar("entregue: REVISAO ATENDENTE na fila sem producao parte de REVISAO ATENDENTE", statusDePartidaDoAtalhoEntregue(est("REVISAO ATENDENTE", true, false)), "REVISAO ATENDENTE");
checar("entregue: REVISAO ATENDENTE fora da fila nao vale", [statusDePartidaDoAtalhoEntregue(est("REVISAO ATENDENTE", false, false)), statusDePartidaDoAtalhoEntregue(est("REVISAO ATENDENTE", null, false))], [null, null]);
checar("entregue: REVISAO ATENDENTE com a flag de producao ligada nao vale", statusDePartidaDoAtalhoEntregue(est("REVISAO ATENDENTE", true, true)), null);
checar("entregue: outros status com libera_nf nao valem", ["REVISAO PRODUCAO", "EM PRODUCAO", "EXPEDICAO", "NOVO", "APROVADO"].map((s) => statusDePartidaDoAtalhoEntregue(est(s, true, false))), [null, null, null, null, null]);
checar("estaNaFilaSemProducao", [estaNaFilaSemProducao(est("REVISAO ATENDENTE", true, false)), estaNaFilaSemProducao(est("REVISAO ATENDENTE", true, null)), estaNaFilaSemProducao(est("REVISAO ATENDENTE", false, false)), estaNaFilaSemProducao(est("REVISAO ATENDENTE", true, true)), estaNaFilaSemProducao(est("LIBERADO", true, false))], [true, true, false, false, false]);
checar("menu Entregue: sem as flags, so LIBERADO (como antes)", [podeVerMarcarComoEntregue(ADM, "LIBERADO"), podeVerMarcarComoEntregue(ADM, "REVISAO ATENDENTE"), podeVerMarcarComoEntregue(COMUM, "LIBERADO")], [true, false, false]);
checar("menu Entregue: com as flags, LIBERADO e a fila sem producao; so ADM", [
  podeVerMarcarComoEntregue(ADM, "LIBERADO", { liberaNf: false, isPrdAprovado: false }),
  podeVerMarcarComoEntregue(ADM, "REVISAO ATENDENTE", { liberaNf: true, isPrdAprovado: false }),
  podeVerMarcarComoEntregue(ADM, "REVISAO ATENDENTE", { liberaNf: false, isPrdAprovado: false }),
  podeVerMarcarComoEntregue(ADM, "REVISAO ATENDENTE", { liberaNf: true, isPrdAprovado: true }),
  podeVerMarcarComoEntregue(COMUM, "REVISAO ATENDENTE", { liberaNf: true, isPrdAprovado: false })
], [true, true, false, false, false]);

// ── 3. Supabase falso ──
type Valor = string | number | boolean | null | undefined;
type Linha = Record<string, Valor>;
type Banco = { propostas: Linha[]; expedicoes: Linha[]; os_status_log: Linha[] };
type Cliente = Parameters<typeof enviarPedidoParaFilaDeFaturamento>[0];
type Opcoes = { falhas?: Record<string, { code?: string; message: string }>; antes?: Record<string, (banco: Banco) => void> };

function criarFalso(banco: Banco, opcoes: Opcoes = {}) {
  const escritas: string[] = [];
  const payloads: Linha[] = [];
  const executar = (tabela: keyof Banco, modo: string, payload: Linha | null, filtros: Array<[string, string, Valor]>, retorna: boolean) => {
    const casa = (l: Linha) => filtros.every(([tipo, col, val]) => (tipo === "eq" ? l[col] === val : l[col] === null || l[col] === undefined));
    if (modo === "select") {
      const falha = opcoes.falhas?.[`${tabela}.select`];
      if (falha) return { data: null, error: falha };
      return { data: banco[tabela].filter(casa), error: null };
    }
    const chave = `${tabela}.update`;
    opcoes.antes?.[chave]?.(banco);
    escritas.push(chave);
    if (payload) payloads.push({ ...payload });
    const falha = opcoes.falhas?.[chave];
    if (falha) return { data: null, error: falha };
    const alvo = banco[tabela].filter(casa);
    for (const l of alvo) Object.assign(l, payload ?? {});
    return { data: retorna ? alvo.map((l) => ({ id_int: l.id_int })) : null, error: null };
  };

  class Consulta {
    private modo = "select";
    private payload: Linha | null = null;
    private filtros: Array<[string, string, Valor]> = [];
    private retorna = false;
    private tabela: keyof Banco;
    constructor(tabela: keyof Banco) { this.tabela = tabela; }
    select() { if (this.modo === "update") this.retorna = true; return this; }
    update(p: Linha) { this.modo = "update"; this.payload = p; return this; }
    eq(c: string, v: Valor) { this.filtros.push(["eq", c, v]); return this; }
    is(c: string, v: Valor) { this.filtros.push(["is", c, v]); return this; }
    maybeSingle() {
      const r = executar(this.tabela, "select", null, this.filtros, false);
      const linha = ((r.data as Linha[] | null) ?? [])[0];
      // Copia: quem le nao segura a linha viva do banco simulado.
      return Promise.resolve({ data: linha ? { ...linha } : null, error: r.error });
    }
    then<R1 = unknown, R2 = never>(res?: ((v: unknown) => R1 | PromiseLike<R1>) | null, rej?: ((e: unknown) => R2 | PromiseLike<R2>) | null) {
      return Promise.resolve(executar(this.tabela, this.modo, this.payload, this.filtros, this.retorna)).then(res, rej);
    }
  }

  const client = {
    from(tabela: keyof Banco) {
      const q = new Consulta(tabela);
      return Object.assign(q, {
        insert(payload: Linha) {
          const chave = `${tabela}.insert`;
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

const AUTOR = { uid: "uid-adm", nome: "ADM Teste" };
const novoBanco = (status: string | null = "REVISAO ATENDENTE", liberaNf: boolean | null = false, flag: boolean | null = false): Banco => ({
  propostas: [{ id_int: 100, status_interno: status, libera_nf: liberaNf, is_prd_aprovado: flag, liberado_producao_em: null, valor_total: 1500 }],
  expedicoes: [],
  os_status_log: []
});
const enviar = (banco: Banco, opcoes: Opcoes = {}, idInt = 100) => {
  const f = criarFalso(banco, opcoes);
  return enviarPedidoParaFilaDeFaturamento(f.client, { idInt, autor: AUTOR }).then((r) => ({ r, escritas: f.escritas, payloads: f.payloads }));
};
const entregar = (banco: Banco, opcoes: Opcoes = {}, idInt = 100) => {
  const f = criarFalso(banco, opcoes);
  return marcarPedidoComoEntregue(f.client, { idInt, autor: AUTOR, agora: new Date("2026-10-13T15:00:00Z") }).then((r) => ({ r, escritas: f.escritas, payloads: f.payloads }));
};
const linha = (b: Banco) => b.propostas[0];

// ── 4. Envio: grava SO libera_nf ──
{
  const banco = novoBanco();
  const { r, escritas, payloads } = await enviar(banco);
  checar("envia: sucesso e nao idempotente", [r.success, r.success && r.idempotente], [true, false]);
  checar("envia: a gravacao e SO libera_nf = true", payloads, [{ libera_nf: true }]);
  checar("envia: status, flag de producao, carimbo e valor intocados", [linha(banco).status_interno, linha(banco).is_prd_aprovado, linha(banco).liberado_producao_em, linha(banco).valor_total, linha(banco).libera_nf], ["REVISAO ATENDENTE", false, null, 1500, true]);
  checar("envia: um UPDATE em propostas e um registro de log, nada mais", escritas, ["propostas.update", "os_status_log.insert"]);
  const log = banco.os_status_log[0];
  checar("envia: log com origem, autor e status inalterado", [log.origem, log.status_anterior, log.status_novo, log.resultado, log.ator_uid, log.ator_nome, log.ator_tipo, log.id_int],
    [ORIGEM_LOG_ENVIO_FILA_FATURAMENTO, "REVISAO ATENDENTE", "REVISAO ATENDENTE", "sucesso", "uid-adm", "ADM Teste", "USUARIO", 100]);
  checar("envia: resposta sem aviso e com log gravado", r.success && !r.idempotente ? [r.logGravado, r.aviso] : null, [true, null]);

  const antes = JSON.stringify(banco);
  const repetida = await enviar(banco);
  checar("repetir: idempotente, sem escrita e sem segundo log", [repetida.r.success, repetida.r.success && repetida.r.idempotente, repetida.escritas, banco.os_status_log.length], [true, true, [], 1]);
  checar("repetir: banco identico", JSON.stringify(banco), antes);
}
{
  const banco = novoBanco("REVISAO ATENDENTE", null, null);
  const { r } = await enviar(banco);
  checar("flags nulas: o UPDATE guardado usa IS NULL e funciona", [r.success, linha(banco).libera_nf, linha(banco).is_prd_aprovado], [true, true, null]);
}

// ── 5. Envio: recusas, nada e gravado ──
for (const status of ["NOVO", "AGUARDANDO", "REVISAO PRODUCAO", "EM PRODUCAO", "LIBERADO", "ENTREGUE", "CANCELADO", null]) {
  const banco = novoBanco(status);
  const { r, escritas } = await enviar(banco);
  checar(`status ${JSON.stringify(status)}: 409 e nada gravado`, [r.success, !r.success && r.httpStatus, !r.success && r.code, escritas, linha(banco).libera_nf], [false, 409, "FORA_DE_REVISAO_ATENDENTE", [], false]);
}
for (const [status, liberaNf] of [["REVISAO ATENDENTE", false], ["REVISAO ATENDENTE", true], ["REVISAO PRODUCAO", true]] as Array<[string, boolean]>) {
  const banco = novoBanco(status, liberaNf, true);
  const { r, escritas } = await enviar(banco);
  checar(`flag de producao ligada (${status}, libera_nf ${liberaNf}): 409 JA_NA_PRODUCAO e nada gravado`, [r.success, !r.success && r.code, escritas], [false, "JA_NA_PRODUCAO", []]);
}
{
  const { r, escritas } = await enviar(novoBanco(), {}, 999);
  checar("pedido inexistente: 404 sem escrita", [r.success, !r.success && r.httpStatus, escritas], [false, 404, []]);
}

// ── 6. Envio: corrida e falhas ──
{
  const banco = novoBanco();
  const { r } = await enviar(banco, { antes: { "propostas.update": (b) => { b.propostas[0].is_prd_aprovado = true; b.propostas[0].status_interno = "REVISAO PRODUCAO"; b.propostas[0].libera_nf = true; } } });
  checar("liberado para a producao no meio: 409 ESTADO_MUDOU, sem log", [r.success, !r.success && r.code, banco.os_status_log.length], [false, "ESTADO_MUDOU", 0]);
}
{
  const banco = novoBanco();
  const { r } = await enviar(banco, { antes: { "propostas.update": (b) => { b.propostas[0].libera_nf = true; } } });
  checar("outro clique chegou primeiro: idempotente, sem log", [r.success, r.success && r.idempotente, banco.os_status_log.length], [true, true, 0]);
}
{
  const banco = novoBanco();
  const { r } = await enviar(banco, { antes: { "propostas.update": (b) => { b.propostas[0].status_interno = "AGUARDANDO"; } } });
  checar("status mudou no meio: 409, libera_nf segue desligada", [r.success, !r.success && r.code, linha(banco).libera_nf, banco.os_status_log.length], [false, "ESTADO_MUDOU", false, 0]);
}
{
  const banco = novoBanco();
  const { r } = await enviar(banco, { falhas: { "propostas.update": { message: "erro de teste" } } });
  checar("UPDATE falhou: 500, nada muda, sem log", [r.success, !r.success && r.httpStatus, linha(banco).libera_nf, banco.os_status_log.length], [false, 500, false, 0]);
}
{
  const banco = novoBanco();
  const { r } = await enviar(banco, { falhas: { "os_status_log.insert": { message: "sem permissao" } } });
  checar("log falhou: o envio vale e a resposta avisa", [linha(banco).libera_nf, r.success && !r.idempotente ? [r.logGravado, Boolean(r.aviso)] : null], [true, [false, true]]);
}

// ── 7. Marcar como entregue: LIBERADO (como antes) e o novo estado ──
{
  const banco = novoBanco("LIBERADO", false, false);
  const { r, escritas, payloads } = await entregar(banco);
  checar("entregue em LIBERADO: como antes (data, status, log)", [r.success, linha(banco).status_interno, escritas, payloads[0]], [true, "ENTREGUE", ["expedicoes.insert", "propostas.update", "os_status_log.insert"], { status_interno: "ENTREGUE" }]);
  checar("entregue em LIBERADO: log parte de LIBERADO", [banco.os_status_log[0].status_anterior, banco.os_status_log[0].origem], ["LIBERADO", ORIGEM_LOG_ATALHO_ENTREGUE]);
}
{
  const banco = novoBanco("REVISAO ATENDENTE", true, false);
  const { r, escritas, payloads } = await entregar(banco);
  checar("entregue na fila sem producao: aceita e vira ENTREGUE", [r.success, r.success && r.idempotente, linha(banco).status_interno], [true, false, "ENTREGUE"]);
  checar("entregue na fila sem producao: grava a data de entrega e so o status", [banco.expedicoes[0]?.data_entrega, payloads[0], escritas], ["2026-10-13T15:00:00.000Z", { status_interno: "ENTREGUE" }, ["expedicoes.insert", "propostas.update", "os_status_log.insert"]]);
  checar("entregue na fila sem producao: libera_nf e flag de producao intocadas", [linha(banco).libera_nf, linha(banco).is_prd_aprovado], [true, false]);
  checar("entregue na fila sem producao: log parte de REVISAO ATENDENTE", [banco.os_status_log[0].status_anterior, banco.os_status_log[0].status_novo, banco.os_status_log[0].origem, banco.os_status_log[0].ator_nome], ["REVISAO ATENDENTE", "ENTREGUE", ORIGEM_LOG_ATALHO_ENTREGUE, "ADM Teste"]);
  const repetida = await entregar(banco);
  checar("entregue: repetir e idempotente, sem escrita", [repetida.r.success, repetida.r.success && repetida.r.idempotente, repetida.escritas], [true, true, []]);
}
for (const [status, liberaNf, flag, rotulo] of [
  ["REVISAO ATENDENTE", false, false, "REVISAO ATENDENTE fora da fila"],
  ["REVISAO ATENDENTE", true, true, "REVISAO ATENDENTE com a flag de producao"],
  ["REVISAO PRODUCAO", true, true, "REVISAO PRODUCAO"],
  ["EM PRODUCAO", true, true, "EM PRODUCAO"],
  ["NOVO", false, false, "NOVO"]
] as Array<[string, boolean, boolean, string]>) {
  const banco = novoBanco(status, liberaNf, flag);
  const { r, escritas } = await entregar(banco);
  checar(`entregue recusado em ${rotulo}: 409 e nada gravado`, [r.success, !r.success && r.httpStatus, escritas, linha(banco).status_interno, banco.expedicoes.length], [false, 409, [], status, 0]);
}
{
  const banco = novoBanco("REVISAO ATENDENTE", true, false);
  const { r } = await entregar(banco, { antes: { "propostas.update": (b) => { b.propostas[0].is_prd_aprovado = true; b.propostas[0].status_interno = "REVISAO PRODUCAO"; } } });
  checar("entregue: liberado para a producao no meio -> nao grava e desfaz a data", [r.success, !r.success && r.code, linha(banco).status_interno, banco.expedicoes[0]?.data_entrega ?? null, banco.os_status_log.length], [false, "STATUS_MUDOU", "REVISAO PRODUCAO", null, 0]);
}
{
  const banco = novoBanco("REVISAO ATENDENTE", true, false);
  const { r } = await entregar(banco, { antes: { "propostas.update": (b) => { b.propostas[0].is_prd_aprovado = true; } } });
  checar("entregue: so a flag de producao ligou no meio (status igual) -> a guarda das flags barra", [r.success, linha(banco).status_interno, banco.os_status_log.length], [false, "REVISAO ATENDENTE", 0]);
}

// ── 8. Estrutura ──
const le = (c: string) => readFileSync(c, "utf8").replace(/\r\n/g, "\n");
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const rota = semComentarios(le("src/app/api/orcamentos/enviar-fila-faturamento/route.ts"));
const servidor = semComentarios(le("src/features/orcamentos/services/enviar-fila-faturamento.server.ts"));
const servidorEntregue = semComentarios(le("src/features/orcamentos/services/marcar-entregue.server.ts"));
const lista = semComentarios(le("src/features/orcamentos/OrcamentosListPageReal.tsx"));
const proposta = semComentarios(le("src/features/orcamentos/OrcamentoFormPage.tsx"));
const fila = semComentarios(le("src/features/fiscal/NotasFiscaisPage.tsx"));
const modal = le("src/features/orcamentos/components/EnviarFilaFaturamentoModal.tsx");
const liberar = le("src/features/orcamentos/services/orcamentos.service.ts");

checar("rota: sessao e ADM conferidos no servidor; nao-ADM recebe 403", [rota.includes("supabase.auth.getUser()"), rota.includes("if (!ehAdmNoServidor(usuario))"), rota.includes('"SEM_PERMISSAO"'), rota.includes("status: 403")], [true, true, true, true]);
checar("rota: nao grava por conta propria", /\.(update|insert|delete|upsert|rpc)\(/.test(rota), false);
checar("servidor: o UNICO update e libera_nf = true", [(servidor.match(/\.update\(/g) ?? []).length, servidor.includes(".update({ libera_nf: true })")], [1, true]);
checar("servidor: nao escreve flag de producao, status nem carimbo", [/is_prd_aprovado:\s*(true|false)/.test(servidor), /status_interno:\s*["'`A-Z]/.test(servidor), servidor.includes("liberado_producao_em")], [false, false, false]);
checar("servidor: UPDATE guardado pelo estado lido", ['.eq("status_interno", statusLido)', 'consulta.eq("libera_nf", liberaNfLida)', 'consulta.eq("is_prd_aprovado", flagProducaoLida)'].map((t) => servidor.includes(t)), [true, true, true]);
checar("servidor: so toca em propostas e os_status_log", Array.from(new Set((servidor.match(/\.from\("([a-z_0-9]+)"\)/g) ?? []))).sort(), ['.from("os_status_log")', '.from("propostas")']);
checar("entregue: em LIBERADO a guarda continua sendo so o status; as flags entram so no novo estado", [servidorEntregue.includes('.eq("status_interno", statusOrigem)'), servidorEntregue.includes("if (partiuDaFila) {"), servidorEntregue.includes('consultaStatus.eq("libera_nf", true)')], [true, true, true]);
checar("liberarPropostaParaProducao intocada: continua gravando as quatro colunas", liberar.includes('      is_prd_aprovado: true,\n      status_interno: "REVISAO PRODUCAO",\n      libera_nf: true,\n      liberado_producao_em: new Date().toISOString()'), true);

checar("lista: o item abre o modal (nao envia no clique) e so aparece pelo teste unico", [lista.includes('{ label: "Enviar para Fila de Faturamento", onClick: () => setPedidoParaEnviarAFila(item) }'), lista.includes("podeVerEnviarParaFila(user, { statusInterno: item.statusInterno, liberaNf: item.libera_nf, isPrdAprovado: item.is_prd_aprovado })")], [true, true]);
checar("lista: a rota so e chamada no Confirmar do modal", [lista.includes("<EnviarFilaFaturamentoModal"), lista.includes("onConfirm={() => void confirmarEnviarAFila()}"), (lista.match(/enviarPedidoParaFilaPeloServidor\(/g) ?? []).length], [true, true, 1]);
checar("lista: Marcar como entregue recebe as duas flags", lista.includes("podeVerMarcarComoEntregue(user, item.statusInterno, { liberaNf: item.libera_nf, isPrdAprovado: item.is_prd_aprovado })"), true);
checar("proposta: o item abre o modal e a rota so e chamada no Confirmar", [proposta.includes('{ label: "Enviar para Fila de Faturamento", onClick: () => setEnviarFilaModalAberto(true) }'), proposta.includes("onConfirm={() => void handleEnviarParaFilaNaProposta()}"), (proposta.match(/enviarPedidoParaFilaPeloServidor\(/g) ?? []).length], [true, true, 1]);
checar("Fila: Marcar como entregue so para ADM, no estado certo, com modal", [fila.includes("podeVerMarcarComoEntregue(user, item.status_interno, { liberaNf: true, isPrdAprovado: item.is_prd_aprovado })"), fila.includes("<MarcarEntregueModal"), (fila.match(/\{renderBotaoMarcarEntregue\(item\)\}/g) ?? []).length], [true, true, 2]);
checar("modal: diz que nao passa pela Producao nem pela Expedicao, e o foco fica no Cancelar", [modal.includes("não passa pela Produção nem pela Expedição"), /autoFocus\s+onClick=\{onClose\}/.test(modal)], [true, true]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
