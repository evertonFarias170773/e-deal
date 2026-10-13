/**
 * Testes de "nota fiscal emitida trava a volta ao atendente" (13/10/2026): a regra, a
 * rota nova do "Voltar para Revisao Atendente" (com banco simulado), quem pode e a
 * estrutura. A retirada tem os casos dela em retirar-producao.test.mts.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/nota-impede-devolucao.test.mts
 *
 * Nada vai ao banco.
 */
import { readFileSync } from "node:fs";
import {
  mensagemNotaImpedeDevolucao,
  notasQueImpedemDevolucao,
  rotuloDaNota,
  type NotaDoPedido
} from "../../src/features/orcamentos/lib/nota-impede-devolucao.ts";
import { ORIGEM_LOG_DEVOLVER_ATENDENTE, podeDevolverAoAtendente } from "../../src/features/orcamentos/lib/devolver-atendente.ts";
import { PAYLOAD_DEVOLUCAO_AO_ATENDENTE } from "../../src/features/orcamentos/lib/retirar-producao.ts";
import { devolverPedidoAoAtendente } from "../../src/features/orcamentos/services/devolver-atendente.server.ts";
import { isNotaImpeditiva } from "../../src/features/cobrancas/cancelamento-elegibilidade.ts";

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

// ── 1. A regra pura ──
const nota = (status: string | null, ambiente: string | null = "producao", tipo: NotaDoPedido["tipo"] = "NFE", numero: string | null = "7501"): NotaDoPedido => ({ tipo, numero, status, ambiente });
const MSG = (rotulos: string, plural = false) => `Este pedido tem nota fiscal emitida (${rotulos}). Cancele ${plural ? "as notas" : "a nota"} antes de devolvê-lo ao atendente.`;

checar("regra: sem nota passa", mensagemNotaImpedeDevolucao([]), null);
checar("regra: NF-e autorizada de producao recusa, dizendo qual", mensagemNotaImpedeDevolucao([nota("AUTORIZADA")]), MSG("NF-e 7501"));
checar("regra: NFS-e autorizada de producao recusa", mensagemNotaImpedeDevolucao([nota("AUTORIZADA", "producao", "NFSE", "14")]), MSG("NFS-e 14"));
checar("regra: todas canceladas passa", mensagemNotaImpedeDevolucao([nota("CANCELADA"), nota("CANCELADA", "producao", "NFSE", "3")]), null);
for (const status of ["PENDENTE", "RASCUNHO", "PROCESSANDO", "ERRO_AUTORIZACAO", "REJEITADA", "NAO_ENCONTRADA_FOCUS", "RETORNO_FOCUS", null]) {
  checar(`regra: ${JSON.stringify(status)} passa`, mensagemNotaImpedeDevolucao([nota(status)]), null);
}
checar("regra: autorizada de HOMOLOGACAO passa", mensagemNotaImpedeDevolucao([nota("AUTORIZADA", "homologacao"), nota("AUTORIZADA", "homologacao", "NFSE", "14")]), null);
checar("regra: autorizada sem ambiente gravado passa (nao e de producao)", mensagemNotaImpedeDevolucao([nota("AUTORIZADA", null)]), null);
checar("regra: mista (uma cancelada, uma autorizada) recusa pela autorizada", mensagemNotaImpedeDevolucao([nota("CANCELADA", "producao", "NFE", "7501"), nota("AUTORIZADA", "producao", "NFE", "7502")]), MSG("NF-e 7502"));
checar("regra: duas emitidas, a mensagem cita as duas", mensagemNotaImpedeDevolucao([nota("AUTORIZADA", "producao", "NFE", "7501"), nota("AUTORIZADA", "producao", "NFSE", "14")]), MSG("NF-e 7501 e NFS-e 14", true));
checar("regra: autorizada de producao SEM numero tambem recusa", mensagemNotaImpedeDevolucao([nota("AUTORIZADA", "producao", "NFE", null)]), MSG("NF-e sem número"));
checar("regra: caixa e espaco nao enganam", mensagemNotaImpedeDevolucao([nota(" autorizada ", " Producao ")]), MSG("NF-e 7501"));
checar("regra: a definicao e a MESMA do cancelamento de cobranca (isNotaImpeditiva)", [nota("AUTORIZADA"), nota("AUTORIZADA", "homologacao"), nota("CANCELADA"), nota("PENDENTE")].map((n) => notasQueImpedemDevolucao([n]).length === 1), [nota("AUTORIZADA"), nota("AUTORIZADA", "homologacao"), nota("CANCELADA"), nota("PENDENTE")].map(isNotaImpeditiva));
checar("rotulo da nota", [rotuloDaNota(nota("AUTORIZADA")), rotuloDaNota(nota("AUTORIZADA", "producao", "NFSE", " 14 ")), rotuloDaNota(nota("AUTORIZADA", "producao", "NFSE", ""))], ["NF-e 7501", "NFS-e 14", "NFS-e sem número"]);

// ── 2. Quem pode devolver: o espelho de quem ve o botao ──
const pode = (permissoesDoPerfil: string[] | null, isAdmin = false, isSuperAdm = false) => podeDevolverAoAtendente({ permissoesDoPerfil, isAdmin, isSuperAdm });
checar("permissao: perfil com * (super admin) pode", pode(["*"]), true);
checar("permissao: perfil com admin.usuarios.view (admin) pode", pode(["admin.usuarios.view"]), true);
checar("permissao: perfil com pedidos.admin pode", pode(["pedidos.view", "pedidos.admin"]), true);
checar("permissao: perfil sem nenhuma das tres nao pode", pode(["pedidos.view", "pedidos.edit", "propostas.release_producao"]), false);
checar("permissao: perfil ativo sem a chave NAO pode, mesmo com is_admin / is_super_adm no cadastro (a tela tambem nao mostra)", [pode(["propostas.view"], true, false), pode(["propostas.view"], true, true), pode([], true, true)], [false, false, false]);
checar("permissao: sem perfil ativo vale o cadastro (legado)", [pode(null, true, false), pode(null, false, true), pode(null, false, false)], [true, true, false]);

// ── 3. Supabase falso ──
type Valor = string | number | boolean | null | undefined;
type Linha = Record<string, Valor>;
type Banco = { propostas: Linha[]; os_status_log: Linha[]; notas_fiscais: Linha[]; notas_servico: Linha[] };
type Cliente = Parameters<typeof devolverPedidoAoAtendente>[0];
type Opcoes = { falhas?: Record<string, { message: string }>; antes?: Record<string, (banco: Banco) => void> };

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
      return Promise.resolve({ data: ((r.data as Linha[] | null) ?? [])[0] ?? null, error: r.error });
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

const AUTOR = { uid: "uid-producao", nome: "Gerente Teste" };
const novoBanco = (status: string | null = "EM PRODUCAO", flag: boolean | null = true, extra: Partial<Banco> = {}): Banco => ({
  propostas: [{ id_int: 100, status_interno: status, is_prd_aprovado: flag, liberado_producao_em: "2026-10-09T10:00:00Z" }],
  os_status_log: [],
  notas_fiscais: [],
  notas_servico: [],
  ...extra
});
const rodar = (banco: Banco, opcoes: Opcoes = {}, idInt = 100) => {
  const f = criarFalso(banco, opcoes);
  return devolverPedidoAoAtendente(f.client, { idInt, autor: AUTOR }).then((r) => ({ r, escritas: f.escritas, payloads: f.payloads }));
};
const nfe = (status: string, ambiente = "producao", numero: string | null = "7501", idInt = 100): Linha => ({ id_int: idInt, numero_nf: numero, status, ambiente });
const nfse = (status: string, ambiente = "producao", numero: string | null = "14", idInt = 100): Linha => ({ id_int: idInt, numero_nfse: numero, status, ambiente });
const estado = (b: Banco) => [b.propostas[0].status_interno, b.propostas[0].is_prd_aprovado];

// ── 4. Devolver: sem nota passa, e grava o mesmo de antes ──
for (const status of ["REVISAO PRODUCAO", "EM PRODUCAO", "EM IMPRESSAO", "EM ACABAMENTO / PENDENTE", "EXPEDICAO"]) {
  const banco = novoBanco(status);
  const { r, escritas, payloads } = await rodar(banco);
  checar(`sem nota, ${status}: devolve (qualquer status, como antes)`, [r.success, r.success && r.idempotente, ...estado(banco)], [true, false, "REVISAO ATENDENTE", false]);
  checar(`sem nota, ${status}: a gravacao e a mesma de antes, um UPDATE e um log`, [payloads[0], escritas], [{ ...PAYLOAD_DEVOLUCAO_AO_ATENDENTE }, ["propostas.update", "os_status_log.insert"]]);
}
{
  const banco = novoBanco();
  const { r } = await rodar(banco);
  const log = banco.os_status_log[0];
  checar("trilha: origem, status, autor e tipo", [log.origem, log.status_anterior, log.status_novo, log.resultado, log.ator_uid, log.ator_nome, log.ator_tipo, log.tipo_transicao, log.id_int],
    [ORIGEM_LOG_DEVOLVER_ATENDENTE, "EM PRODUCAO", "REVISAO ATENDENTE", "sucesso", "uid-producao", "Gerente Teste", "USUARIO", "RETORNO", 100]);
  checar("o carimbo liberado_producao_em e preservado", banco.propostas[0].liberado_producao_em, "2026-10-09T10:00:00Z");
  checar("resposta sem aviso e com log gravado", r.success && !r.idempotente ? [r.logGravado, r.aviso, r.statusAnterior] : null, [true, null, "EM PRODUCAO"]);

  // repeticao nao grava
  const antes = JSON.stringify(banco);
  const repetida = await rodar(banco);
  checar("repetir: idempotente, sem escrita e sem segundo log", [repetida.r.success, repetida.r.success && repetida.r.idempotente, repetida.escritas, banco.os_status_log.length], [true, true, [], 1]);
  checar("repetir: banco identico", JSON.stringify(banco), antes);
}

// ── 5. Devolver: nota emitida recusa, nada e gravado ──
{
  const banco = novoBanco("EM PRODUCAO", true, { notas_fiscais: [nfe("AUTORIZADA")] });
  const { r, escritas } = await rodar(banco);
  checar("NF-e autorizada de producao: 409 NOTA_EMITIDA, nada gravado, sem log", [r.success, !r.success && r.httpStatus, !r.success && r.code, escritas, ...estado(banco), banco.os_status_log.length], [false, 409, "NOTA_EMITIDA", [], "EM PRODUCAO", true, 0]);
  checar("NF-e autorizada: a mensagem diz qual nota e manda cancelar", !r.success && r.message, MSG("NF-e 7501"));
}
{
  const banco = novoBanco("EM IMPRESSAO", true, { notas_servico: [nfse("AUTORIZADA")] });
  const { r, escritas } = await rodar(banco);
  checar("NFS-e autorizada de producao: recusa", [!r.success && r.code, !r.success && r.message, escritas], ["NOTA_EMITIDA", MSG("NFS-e 14"), []]);
}
{
  const banco = novoBanco("EM PRODUCAO", true, { notas_fiscais: [nfe("CANCELADA"), nfe("AUTORIZADA", "producao", "7502")] });
  const { r, escritas } = await rodar(banco);
  checar("mista (cancelada + autorizada): recusa pela autorizada", [!r.success && r.message, escritas], [MSG("NF-e 7502"), []]);
}
{
  const banco = novoBanco("EM PRODUCAO", true, { notas_fiscais: [nfe("CANCELADA"), nfe("CANCELADA", "producao", "7502")], notas_servico: [nfse("CANCELADA")] });
  const { r } = await rodar(banco);
  checar("todas canceladas: devolve normalmente", [r.success, ...estado(banco)], [true, "REVISAO ATENDENTE", false]);
}
{
  const banco = novoBanco("EM PRODUCAO", true, { notas_fiscais: [nfe("PENDENTE", "producao", null), nfe("ERRO_AUTORIZACAO"), nfe("NAO_ENCONTRADA_FOCUS")], notas_servico: [nfse("RETORNO_FOCUS"), nfse("ERRO_AUTORIZACAO")] });
  const { r } = await rodar(banco);
  checar("rascunho, em processamento e rejeitada: devolve normalmente", [r.success, ...estado(banco)], [true, "REVISAO ATENDENTE", false]);
}
{
  const banco = novoBanco("EM PRODUCAO", true, { notas_fiscais: [nfe("AUTORIZADA", "homologacao")], notas_servico: [nfse("AUTORIZADA", "homologacao")] });
  const { r } = await rodar(banco);
  checar("autorizadas de homologacao: devolve normalmente", [r.success, ...estado(banco)], [true, "REVISAO ATENDENTE", false]);
}
{
  const banco = novoBanco("EM PRODUCAO", true, { notas_fiscais: [nfe("AUTORIZADA", "producao", "1", 200)] });
  const { r } = await rodar(banco);
  checar("nota de OUTRO pedido nao trava este", [r.success, ...estado(banco)], [true, "REVISAO ATENDENTE", false]);
}
{
  const banco = novoBanco("REVISAO ATENDENTE", false, { notas_fiscais: [nfe("AUTORIZADA")] });
  const { r, escritas } = await rodar(banco);
  checar("ja com o atendente e com nota: idempotente, sem escrita", [r.success, r.success && r.idempotente, escritas], [true, true, []]);
}
for (const tabela of ["notas_fiscais", "notas_servico"]) {
  const banco = novoBanco();
  const { r, escritas } = await rodar(banco, { falhas: { [`${tabela}.select`]: { message: "sem acesso" } } });
  checar(`nao conseguiu ler ${tabela}: recusa (500) e nao grava`, [r.success, !r.success && r.httpStatus, !r.success && r.code, escritas, ...estado(banco)], [false, 500, "LEITURA_NOTAS_FALHOU", [], "EM PRODUCAO", true]);
}

// ── 6. Corrida, falhas e estados fora do comum ──
{
  const { r, escritas } = await rodar(novoBanco(), {}, 999);
  checar("pedido inexistente: 404 sem escrita", [r.success, !r.success && r.httpStatus, escritas], [false, 404, []]);
}
{
  const banco = novoBanco();
  const { r } = await rodar(banco, { antes: { "propostas.update": (b) => { b.propostas[0].status_interno = "EXPEDICAO"; } } });
  checar("status mudou no meio: 409 STATUS_MUDOU, sem gravar e sem log", [r.success, !r.success && r.code, ...estado(banco), banco.os_status_log.length], [false, "STATUS_MUDOU", "EXPEDICAO", true, 0]);
}
{
  const banco = novoBanco();
  const { r } = await rodar(banco, { antes: { "propostas.update": (b) => { b.propostas[0].status_interno = "REVISAO ATENDENTE"; b.propostas[0].is_prd_aprovado = false; } } });
  checar("outro clique chegou primeiro: idempotente, sem log", [r.success, r.success && r.idempotente, banco.os_status_log.length], [true, true, 0]);
}
{
  const banco = novoBanco();
  const { r } = await rodar(banco, { falhas: { "propostas.update": { message: "erro de teste" } } });
  checar("UPDATE falhou: 500, nada muda, sem log", [r.success, !r.success && r.httpStatus, ...estado(banco), banco.os_status_log.length], [false, 500, "EM PRODUCAO", true, 0]);
}
{
  const banco = novoBanco();
  const { r } = await rodar(banco, { falhas: { "os_status_log.insert": { message: "sem permissao" } } });
  checar("log falhou: a devolucao vale e a resposta avisa", [banco.propostas[0].status_interno, r.success && !r.idempotente ? [r.logGravado, Boolean(r.aviso)] : null], ["REVISAO ATENDENTE", [false, true]]);
}
{
  const banco = novoBanco(null, null);
  const { r } = await rodar(banco);
  checar("status e flag nulos: o UPDATE guardado usa IS NULL e funciona", [r.success, ...estado(banco)], [true, "REVISAO ATENDENTE", false]);
}
{
  const banco = novoBanco("REVISAO ATENDENTE", true);
  const { r } = await rodar(banco);
  checar("REVISAO ATENDENTE com a flag ainda ligada: so a flag cai", [r.success, r.success && r.idempotente, ...estado(banco)], [true, false, "REVISAO ATENDENTE", false]);
}

// ── 7. Estrutura ──
const le = (c: string) => readFileSync(c, "utf8").replace(/\r\n/g, "\n");
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const rota = semComentarios(le("src/app/api/orcamentos/devolver-atendente/route.ts"));
const rotaRetirar = semComentarios(le("src/app/api/orcamentos/retirar-producao/route.ts"));
const servidorDevolver = semComentarios(le("src/features/orcamentos/services/devolver-atendente.server.ts"));
const servidorRetirar = semComentarios(le("src/features/orcamentos/services/retirar-producao.server.ts"));
const helper = semComentarios(le("src/features/orcamentos/services/nota-impede-devolucao.server.ts"));
const regra = semComentarios(le("src/features/orcamentos/lib/nota-impede-devolucao.ts"));
const telaProducao = semComentarios(le("src/features/pedidos/PedidosListPage.tsx"));
const servico = le("src/features/orcamentos/services/orcamentos.service.ts");

checar("UM helper de servidor, usado pelas duas portas", [servidorDevolver.includes("recusaPorNotaEmitida(supabase, idInt)"), servidorRetirar.includes("recusaPorNotaEmitida(supabase, idInt)")], [true, true]);
checar("a regra reaproveita isNotaImpeditiva (sem segunda definicao de emitida)", [regra.includes("notas.filter(isNotaImpeditiva)"), /AUTORIZADA|PRODUCAO/.test(regra)], [true, false]);
checar("o helper so le as duas tabelas de nota, pelo id_int", [helper.includes('from("notas_fiscais")'), helper.includes('from("notas_servico")'), /\.(update|insert|delete|upsert|rpc)\(/.test(helper)], [true, true, false]);
checar("as duas rotas nao gravam por conta propria", [/\.(update|insert|delete|upsert)\(/.test(rota), /\.(update|insert|delete|upsert)\(/.test(rotaRetirar)], [false, false]);
checar("rota do Devolver: sessao e permissao no servidor, pelo espelho da tela", [rota.includes("supabase.auth.getUser()"), rota.includes("podeDevolverAoAtendente({ permissoesDoPerfil, isAdmin: usuario.is_admin, isSuperAdm: usuario.is_super_adm })"), rota.includes('"SEM_PERMISSAO"'), rota.includes("verificarPermissaoServerSide")], [true, true, true, false]);
checar("rota do Devolver: o perfil lido e o ATIVO, como a tela", rota.includes('.eq("ativo", true)'), true);
checar("as duas portas gravam pela mesma funcao", [servidorDevolver.includes("gravarDevolucaoAoAtendente(supabase, {"), servidorRetirar.includes("gravarDevolucaoAoAtendente(supabase, {")], [true, true]);
const iDevolver = servico.indexOf("export async function devolverPropostaParaRevisaoAtendente");
const corpoDevolver = servico.slice(iDevolver, servico.indexOf("\n}\n", iDevolver));
checar("a tela Producao passa pela rota (o servico nao grava do navegador)", [corpoDevolver.includes('fetch("/api/orcamentos/devolver-atendente"'), corpoDevolver.includes(".update(")], [true, false]);
checar("tela Producao: quem ve o botao nao mudou", telaProducao.includes('const canVoltarRevisao = Boolean(user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "pedidos.admin"));'), true);
checar("tela Producao: com nota emitida a acao fica desligada, com o motivo (menu e cartao)", [telaProducao.includes('{ label: "Voltar para Revisão Atendente (nota emitida)", destructive: true, disabled: true, title: motivoNota }'), telaProducao.includes("disabled={notaQueImpedeDevolver.has(proposta.id_int)}")], [true, true]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
