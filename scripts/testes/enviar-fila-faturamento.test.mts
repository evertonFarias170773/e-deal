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
  statusDePartidaDoAtalhoEntregue,
  travaDoAprovado
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
for (const s of ["NOVO", "AGUARDANDO", "EM ARTE", "REVISAO PRODUCAO", "EM PRODUCAO", "EXPEDICAO", "ENTREGUE", "CANCELADO", "", null]) {
  const d = decidirEnvioParaFila(est(s));
  checar(`regra: status ${JSON.stringify(s)} e recusado`, [d.acao, d.acao === "recusar" && d.code], ["recusar", "FORA_DE_REVISAO_ATENDENTE"]);
}
for (const liberaNf of [false, true]) {
  const d = decidirEnvioParaFila(est("REVISAO ATENDENTE", liberaNf, true));
  checar(`regra: flag de producao ligada e recusada (libera_nf ${liberaNf})`, [d.acao, d.acao === "recusar" && d.code], ["recusar", "JA_NA_PRODUCAO"]);
}
checar("regra: outro status com libera_nf ligada e recusado, nao idempotente", decidirEnvioParaFila(est("EM PRODUCAO", true, false)).acao, "recusar");

// Desde 16/10/2026 a tela do envio usa o ADM do CADASTRO (isAdmNoCadastro), como a rota.
const ADM = { isAdmNoCadastro: true };
const SUPER = { isAdmNoCadastro: true };
const COMUM = { isAdmNoCadastro: false };
checar("menu Enviar: so ADM e so no estado certo", [
  podeVerEnviarParaFila(ADM, est("REVISAO ATENDENTE")),
  podeVerEnviarParaFila(SUPER, est("REVISAO ATENDENTE")),
  podeVerEnviarParaFila(COMUM, est("REVISAO ATENDENTE")),
  podeVerEnviarParaFila(null, est("REVISAO ATENDENTE")),
  podeVerEnviarParaFila(ADM, est("REVISAO ATENDENTE", true, false)), // ja enviado: some
  podeVerEnviarParaFila(ADM, est("REVISAO ATENDENTE", false, true)),
  podeVerEnviarParaFila(ADM, est("REVISAO PRODUCAO")),
  podeVerEnviarParaFila(ADM, est("LIBERADO")) // desde 15/10/2026 vale tambem em LIBERADO
], [true, true, false, false, false, false, false, true]);
checar("menu Enviar: ADM so no cadastro ve; ADM so no perfil (isAdmin/isSuperAdmin) nao ve", [
  podeVerEnviarParaFila({ isAdmNoCadastro: true }, est("REVISAO ATENDENTE")),
  podeVerEnviarParaFila({ isAdmin: true, isSuperAdmin: true, isAdmNoCadastro: false } as { isAdmNoCadastro: boolean }, est("REVISAO ATENDENTE")),
  podeVerEnviarParaFila({ isAdmin: true, isSuperAdmin: true } as { isAdmNoCadastro?: boolean }, est("APROVADO"))
], [true, false, false]);
checar("ADM no servidor: is_admin ou is_super_adm; sem nenhum, recusado", [ehAdmNoServidor({ is_admin: true }), ehAdmNoServidor({ is_super_adm: true }), ehAdmNoServidor({ is_admin: false, is_super_adm: false }), ehAdmNoServidor(null)], [true, true, false, false]);

// ── 2. A regra pura do "Marcar como entregue" ampliado ──
checar("entregue: LIBERADO parte de LIBERADO, com qualquer flag", [statusDePartidaDoAtalhoEntregue(est("LIBERADO")), statusDePartidaDoAtalhoEntregue(est("LIBERADO", true, true)), statusDePartidaDoAtalhoEntregue(est("LIBERADO", null, null))], ["LIBERADO", "LIBERADO", "LIBERADO"]);
checar("entregue: REVISAO ATENDENTE na fila sem producao parte de REVISAO ATENDENTE", statusDePartidaDoAtalhoEntregue(est("REVISAO ATENDENTE", true, false)), "REVISAO ATENDENTE");
checar("entregue: REVISAO ATENDENTE fora da fila nao vale", [statusDePartidaDoAtalhoEntregue(est("REVISAO ATENDENTE", false, false)), statusDePartidaDoAtalhoEntregue(est("REVISAO ATENDENTE", null, false))], [null, null]);
checar("entregue: REVISAO ATENDENTE com a flag de producao ligada nao vale", statusDePartidaDoAtalhoEntregue(est("REVISAO ATENDENTE", true, true)), null);
checar("entregue: outros status com libera_nf nao valem", ["REVISAO PRODUCAO", "EM PRODUCAO", "EXPEDICAO", "NOVO"].map((s) => statusDePartidaDoAtalhoEntregue(est(s, true, false))), [null, null, null, null]);
checar("estaNaFilaSemProducao", [estaNaFilaSemProducao(est("REVISAO ATENDENTE", true, false)), estaNaFilaSemProducao(est("REVISAO ATENDENTE", true, null)), estaNaFilaSemProducao(est("REVISAO ATENDENTE", false, false)), estaNaFilaSemProducao(est("REVISAO ATENDENTE", true, true)), estaNaFilaSemProducao(est("LIBERADO", true, false))], [true, true, false, false, false]);
const ADM_CAD = { isAdmNoCadastro: true };
const SEM_ADM_CAD = { isAdmNoCadastro: false };
checar("menu Entregue: sem as flags, so LIBERADO (como antes)", [podeVerMarcarComoEntregue(ADM_CAD, "LIBERADO"), podeVerMarcarComoEntregue(ADM_CAD, "REVISAO ATENDENTE"), podeVerMarcarComoEntregue(ADM_CAD, "APROVADO"), podeVerMarcarComoEntregue(SEM_ADM_CAD, "LIBERADO")], [true, false, false, false]);
checar("menu Entregue: com as flags, LIBERADO e a fila sem producao; so ADM", [
  podeVerMarcarComoEntregue(ADM_CAD, "LIBERADO", { liberaNf: false, isPrdAprovado: false }),
  podeVerMarcarComoEntregue(ADM_CAD, "REVISAO ATENDENTE", { liberaNf: true, isPrdAprovado: false }),
  podeVerMarcarComoEntregue(ADM_CAD, "REVISAO ATENDENTE", { liberaNf: false, isPrdAprovado: false }),
  podeVerMarcarComoEntregue(ADM_CAD, "REVISAO ATENDENTE", { liberaNf: true, isPrdAprovado: true }),
  podeVerMarcarComoEntregue(SEM_ADM_CAD, "REVISAO ATENDENTE", { liberaNf: true, isPrdAprovado: false })
], [true, true, false, false, false]);

// ── 3. Supabase falso ──
type Valor = string | number | boolean | null | undefined;
type Linha = Record<string, Valor>;
type Banco = { propostas: Linha[]; expedicoes: Linha[]; os_status_log: Linha[]; propostas_os: Linha[]; propostas_os_setores: Linha[]; notas_fiscais: Linha[]; notas_servico: Linha[] };
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
    limit() { return this; }
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
  propostas: [{ id_int: 100, status_interno: status, libera_nf: liberaNf, is_prd_aprovado: flag, liberado_producao_em: null, valor_total: 1500, faturado_fora_em: null }],
  expedicoes: [],
  os_status_log: [],
  propostas_os: [],
  propostas_os_setores: [],
  notas_fiscais: [],
  notas_servico: []
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
for (const status of ["NOVO", "AGUARDANDO", "REVISAO PRODUCAO", "EM PRODUCAO", "ENTREGUE", "CANCELADO", null]) {
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

// ── 6b. APROVADO e LIBERADO (15/10/2026) ──
checar("regra: APROVADO e LIBERADO com as flags desligadas enviam", [decidirEnvioParaFila(est("APROVADO")).acao, decidirEnvioParaFila(est("LIBERADO")).acao, decidirEnvioParaFila(est(" aprovado ")).acao], ["enviar", "enviar", "enviar"]);
checar("regra: APROVADO com OS, nota ou faturado fora recusa", [
  decidirEnvioParaFila({ ...est("APROVADO"), temOs: true }),
  decidirEnvioParaFila({ ...est("APROVADO"), notasEmitidas: ["NF-e 7540"] }),
  decidirEnvioParaFila({ ...est("LIBERADO"), faturadoForaEm: "2026-10-14T18:00:00Z" })
].map((d) => d.acao === "recusar" && d.code), ["TEM_OS", "NOTA_EMITIDA", "FATURADO_NO_SISTEMA_ANTIGO"]);
checar("regra: APROVADO com a flag de producao ligada recusa; com libera_nf ligada e idempotente", [decidirEnvioParaFila(est("APROVADO", false, true)).acao, decidirEnvioParaFila(est("APROVADO", true, false)).acao], ["recusar", "idempotente"]);
checar("regra: REVISAO ATENDENTE segue igual (OS, nota e faturado fora nao contam ali)", decidirEnvioParaFila({ ...est("REVISAO ATENDENTE"), temOs: true, notasEmitidas: ["NF-e 1"], faturadoForaEm: "2026-10-14" }).acao, "enviar");
checar("menu: APROVADO aparece para ADM e some com faturado fora ou para nao ADM", [podeVerEnviarParaFila(ADM, est("APROVADO")), podeVerEnviarParaFila(ADM, { ...est("APROVADO"), faturadoForaEm: "2026-10-14" }), podeVerEnviarParaFila(COMUM, est("APROVADO"))], [true, false, false]);
checar("marcar entregue: APROVADO parte de APROVADO desde 15/10/2026, com ou sem libera_nf", [statusDePartidaDoAtalhoEntregue(est("APROVADO", true, false)), statusDePartidaDoAtalhoEntregue(est("APROVADO", false, false)), statusDePartidaDoAtalhoEntregue(est("LIBERADO", true, false))], ["APROVADO", "APROVADO", "LIBERADO"]);
for (const status of ["APROVADO", "LIBERADO"]) {
  const banco = novoBanco(status);
  const { r, escritas, payloads } = await enviar(banco);
  checar(`${status} sem OS, sem nota e sem faturado fora: envia, grava so libera_nf e o status nao muda`, [r.success, payloads, linha(banco).status_interno, linha(banco).is_prd_aprovado, escritas], [true, [{ libera_nf: true }], status, false, ["propostas.update", "os_status_log.insert"]]);
  checar(`${status}: o log registra o status lido como anterior e novo`, [banco.os_status_log[0].status_anterior, banco.os_status_log[0].status_novo, banco.os_status_log[0].origem], [status, status, ORIGEM_LOG_ENVIO_FILA_FATURAMENTO]);
  const repetida = await enviar(banco);
  checar(`${status}: repetir e idempotente e nao grava`, [repetida.r.success && repetida.r.idempotente, repetida.escritas], [true, []]);
}
for (const [rotulo, extra, code] of [
  ["com OS", { propostas_os: [{ id_int: 100 }] }, "TEM_OS"],
  ["com setores de OS", { propostas_os_setores: [{ id_int: 100 }] }, "TEM_OS"],
  ["com NF-e autorizada de producao", { notas_fiscais: [{ id_int: 100, numero_nf: "7540", status: "AUTORIZADA", ambiente: "producao" }] }, "NOTA_EMITIDA"],
  ["com NFS-e autorizada de producao", { notas_servico: [{ id_int: 100, numero_nfse: "21", status: "AUTORIZADA", ambiente: "producao" }] }, "NOTA_EMITIDA"]
] as Array<[string, Partial<Banco>, string]>) {
  const banco = { ...novoBanco("APROVADO"), ...extra };
  const { r, escritas } = await enviar(banco);
  checar(`APROVADO ${rotulo}: 409 ${code} e nada gravado`, [r.success, !r.success && r.httpStatus, !r.success && r.code, escritas, linha(banco).libera_nf], [false, 409, code, [], false]);
}
{
  const banco = { ...novoBanco("APROVADO"), notas_fiscais: [{ id_int: 100, numero_nf: "7540", status: "CANCELADA", ambiente: "producao" }, { id_int: 100, numero_nf: "9", status: "AUTORIZADA", ambiente: "homologacao" }] };
  const { r } = await enviar(banco);
  checar("APROVADO so com nota cancelada ou de homologacao: envia", [r.success, linha(banco).libera_nf], [true, true]);
}
{
  const banco = novoBanco("APROVADO");
  linha(banco).faturado_fora_em = "2026-10-14T18:00:00Z";
  const { r, escritas } = await enviar(banco);
  checar("APROVADO com faturado no sistema antigo: 409 e nada gravado", [r.success, !r.success && r.code, escritas], [false, "FATURADO_NO_SISTEMA_ANTIGO", []]);
}
{
  const banco = novoBanco("LIBERADO", false, true);
  const { r, escritas } = await enviar(banco);
  checar("LIBERADO com a flag de producao ligada: 409 JA_NA_PRODUCAO e nada gravado", [r.success, !r.success && r.code, escritas], [false, "JA_NA_PRODUCAO", []]);
}
{
  const banco = novoBanco("APROVADO");
  const { r, escritas } = await enviar(banco, { falhas: { "notas_fiscais.select": { message: "sem acesso" } } });
  checar("APROVADO sem conseguir ler as notas: recusa (500) e nao grava", [r.success, !r.success && r.httpStatus, escritas], [false, 500, []]);
}
{
  const banco = novoBanco("REVISAO ATENDENTE");
  const { r, escritas } = await enviar(banco, { falhas: { "notas_fiscais.select": { message: "sem acesso" } } });
  checar("REVISAO ATENDENTE nem le as notas (segue igual): envia mesmo com a leitura de notas falhando", [r.success, escritas], [true, ["propostas.update", "os_status_log.insert"]]);
}
{
  const banco = novoBanco("APROVADO");
  const { r } = await enviar(banco, { antes: { "propostas.update": (b) => { b.propostas[0].faturado_fora_em = "2026-10-15T10:00:00Z"; } } });
  checar("APROVADO marcado faturado fora no meio: a guarda barra, nada gravado", [r.success, linha(banco).libera_nf, banco.os_status_log.length], [false, false, 0]);
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

// ── 7b. Marcar como entregue em APROVADO (15/10/2026) ──
checar("trava APROVADO: limpa passa; producao, OS e nota recusam", [
  travaDoAprovado({ isPrdAprovado: false }),
  travaDoAprovado({ isPrdAprovado: true })?.code,
  travaDoAprovado({ isPrdAprovado: false, temOs: true })?.code,
  travaDoAprovado({ isPrdAprovado: null, notasEmitidas: ["NF-e 7540"] })?.code
], [null, "JA_NA_PRODUCAO", "TEM_OS", "NOTA_EMITIDA"]);
checar("tela: APROVADO sem producao aparece para ADM do cadastro; com producao ou sem ADM do cadastro, nao", [
  podeVerMarcarComoEntregue(ADM_CAD, "APROVADO", { liberaNf: false, isPrdAprovado: false }),
  podeVerMarcarComoEntregue(ADM_CAD, "APROVADO", { liberaNf: true, isPrdAprovado: null }),
  podeVerMarcarComoEntregue(ADM_CAD, "APROVADO", { liberaNf: false, isPrdAprovado: true }),
  podeVerMarcarComoEntregue(SEM_ADM_CAD, "APROVADO", { liberaNf: false, isPrdAprovado: false })
], [true, true, false, false]);
checar("tela: ADM so no cadastro ve; ADM so no perfil (isAdmin/isSuperAdmin do perfil) nao ve", [
  podeVerMarcarComoEntregue({ isAdmNoCadastro: true }, "LIBERADO", { liberaNf: false, isPrdAprovado: false }),
  podeVerMarcarComoEntregue({ isAdmin: true, isSuperAdmin: true, isAdmNoCadastro: false } as { isAdmNoCadastro: boolean }, "LIBERADO", { liberaNf: false, isPrdAprovado: false }),
  podeVerMarcarComoEntregue({ isAdmin: true, isSuperAdmin: true } as { isAdmNoCadastro?: boolean }, "LIBERADO", { liberaNf: false, isPrdAprovado: false })
], [true, false, false]);
{
  const banco = novoBanco("APROVADO", false, false);
  const { r, escritas, payloads } = await entregar(banco);
  checar("entregue em APROVADO limpo: aceita e vira ENTREGUE com a mesma gravacao", [r.success, linha(banco).status_interno, payloads[0], escritas], [true, "ENTREGUE", { status_interno: "ENTREGUE" }, ["expedicoes.insert", "propostas.update", "os_status_log.insert"]]);
  checar("entregue em APROVADO: data de entrega gravada, flags intocadas, log parte de APROVADO", [banco.expedicoes[0]?.data_entrega, linha(banco).libera_nf, linha(banco).is_prd_aprovado, banco.os_status_log[0].status_anterior, banco.os_status_log[0].origem], ["2026-10-13T15:00:00.000Z", false, false, "APROVADO", ORIGEM_LOG_ATALHO_ENTREGUE]);
  const repetida = await entregar(banco);
  checar("entregue em APROVADO: repetir e idempotente, sem escrita", [repetida.r.success && repetida.r.idempotente, repetida.escritas], [true, []]);
}
{
  const banco = novoBanco("APROVADO", true, false);
  const { r } = await entregar(banco);
  checar("entregue em APROVADO ja na Fila (libera_nf ligada): aceita", [r.success, linha(banco).status_interno], [true, "ENTREGUE"]);
}
for (const [rotulo, extra, flag, code] of [
  ["com a flag de producao", {}, true, "JA_NA_PRODUCAO"],
  ["com OS", { propostas_os: [{ id_int: 100 }] }, false, "TEM_OS"],
  ["com setores de OS", { propostas_os_setores: [{ id_int: 100 }] }, false, "TEM_OS"],
  ["com NF-e autorizada de producao", { notas_fiscais: [{ id_int: 100, numero_nf: "7540", status: "AUTORIZADA", ambiente: "producao" }] }, false, "NOTA_EMITIDA"],
  ["com NFS-e autorizada de producao", { notas_servico: [{ id_int: 100, numero_nfse: "21", status: "AUTORIZADA", ambiente: "producao" }] }, false, "NOTA_EMITIDA"]
] as Array<[string, Partial<Banco>, boolean, string]>) {
  const banco = { ...novoBanco("APROVADO", false, flag), ...extra };
  const { r, escritas } = await entregar(banco);
  checar(`entregue em APROVADO ${rotulo}: 409 ${code}, nada gravado`, [r.success, !r.success && r.httpStatus, !r.success && r.code, escritas, linha(banco).status_interno, banco.expedicoes.length], [false, 409, code, [], "APROVADO", 0]);
}
{
  const banco = { ...novoBanco("APROVADO"), notas_fiscais: [{ id_int: 100, numero_nf: "1", status: "CANCELADA", ambiente: "producao" }, { id_int: 100, numero_nf: "2", status: "AUTORIZADA", ambiente: "homologacao" }] };
  const { r } = await entregar(banco);
  checar("entregue em APROVADO so com nota cancelada ou de homologacao: aceita", [r.success, linha(banco).status_interno], [true, "ENTREGUE"]);
}
{
  const banco = novoBanco("APROVADO");
  const { r, escritas } = await entregar(banco, { falhas: { "notas_servico.select": { message: "sem acesso" } } });
  checar("entregue em APROVADO sem conseguir ler as notas: 500, nada gravado", [r.success, !r.success && r.httpStatus, escritas], [false, 500, []]);
}
{
  const banco = novoBanco("APROVADO");
  const { r } = await entregar(banco, { antes: { "propostas.update": (b) => { b.propostas[0].is_prd_aprovado = true; } } });
  checar("entregue em APROVADO: flag de producao ligou no meio -> a guarda barra e a data e desfeita", [r.success, linha(banco).status_interno, banco.expedicoes[0]?.data_entrega ?? null, banco.os_status_log.length], [false, "APROVADO", null, 0]);
}
{
  // LIBERADO e REVISAO ATENDENTE seguem sem as travas novas: com OS e nota, continuam aceitos como antes.
  const comTudo = { propostas_os: [{ id_int: 100 }], notas_fiscais: [{ id_int: 100, numero_nf: "7540", status: "AUTORIZADA", ambiente: "producao" }] };
  const lib = { ...novoBanco("LIBERADO", false, true), ...comTudo };
  const ra = { ...novoBanco("REVISAO ATENDENTE", true, false), ...comTudo };
  const r1 = await entregar(lib);
  const r2 = await entregar(ra);
  checar("LIBERADO e REVISAO ATENDENTE seguem iguais: OS, nota e flag de producao nao travam ali", [r1.r.success, linha(lib).status_interno, r2.r.success, linha(ra).status_interno], [true, "ENTREGUE", true, "ENTREGUE"]);
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

checar("lista: o item abre o modal (nao envia no clique) e so aparece pelo teste unico", [lista.includes('{ label: "Enviar para Fila de Faturamento", onClick: () => setPedidoParaEnviarAFila(item) }'), lista.includes("podeVerEnviarParaFila(user, { statusInterno: item.statusInterno, liberaNf: item.libera_nf, isPrdAprovado: item.is_prd_aprovado, faturadoForaEm: item.faturadoForaEm })")], [true, true]);
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
