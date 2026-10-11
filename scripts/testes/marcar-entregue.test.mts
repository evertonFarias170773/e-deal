/**
 * Testes do atalho "Marcar como entregue" (miolo do servidor + regras da tela).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/marcar-entregue.test.mts
 *
 * Usa um Supabase falso em memoria: nada vai ao banco. Confere, por pedido, o
 * status e a data_entrega ANTES e DEPOIS, a linha do log, a ordem das escritas e
 * o que acontece quando uma escrita falha ou o status muda no meio.
 */
import {
  ORIGEM_LOG_ATALHO_ENTREGUE,
  ehAdmNoServidor,
  podeVerMarcarComoEntregue
} from "../../src/features/orcamentos/lib/marcar-entregue.ts";
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

// ───────────── Supabase falso ─────────────
type Valor = string | number | boolean | null | undefined;
type Linha = Record<string, Valor>;
type Banco = { propostas: Linha[]; expedicoes: Linha[]; os_status_log: Linha[] };
type Cliente = Parameters<typeof marcarPedidoComoEntregue>[0];
type Opcoes = {
  /** "tabela.insert" / "tabela.update" -> erro devolvido no lugar da escrita. */
  falhas?: Record<string, { code?: string; message: string }>;
  /** Roda antes de uma escrita, para simular outra pessoa mexendo no meio. */
  antes?: Record<string, (banco: Banco) => void>;
};

function criarFalso(banco: Banco, opcoes: Opcoes = {}) {
  const escritas: string[] = [];
  const executar = (tabela: keyof Banco, modo: string, payload: Linha | null, filtros: Array<[string, string, Valor]>, retorna: boolean) => {
    const linhas = banco[tabela];
    const casa = (l: Linha) =>
      filtros.every(([tipo, col, val]) => (tipo === "eq" ? l[col] === val : l[col] === null || l[col] === undefined));
    if (modo === "select") return { data: linhas.filter(casa), error: null };
    if (modo === "update") {
      const chave = `${tabela}.update`;
      opcoes.antes?.[chave]?.(banco);
      escritas.push(chave);
      const falha = opcoes.falhas?.[chave];
      if (falha) return { data: null, error: falha };
      const alvo = linhas.filter(casa);
      for (const l of alvo) Object.assign(l, payload ?? {});
      return { data: retorna ? alvo.map((l) => ({ id_int: l.id_int })) : null, error: null };
    }
    return { data: null, error: null };
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
    maybeSingle() { const r = executar(this.tabela, "select", null, this.filtros, false); return Promise.resolve({ data: (r.data as Linha[])[0] ?? null, error: r.error }); }
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
          opcoes.antes?.[chave]?.(banco);
          escritas.push(chave);
          const falha = opcoes.falhas?.[chave];
          if (falha) return Promise.resolve({ error: falha });
          if (tabela === "expedicoes" && banco.expedicoes.some((l) => l.id_int === payload.id_int)) {
            return Promise.resolve({ error: { code: "23505", message: "duplicate key value violates unique constraint" } });
          }
          banco[tabela].push({ ...payload });
          return Promise.resolve({ error: null });
        }
      });
    }
  };
  return { client: client as unknown as Cliente, escritas };
}

const AGORA = new Date("2026-10-11T02:30:00Z"); // 23:30 do dia 10 em Sao Paulo
const AUTOR = { uid: "uid-adm", nome: "Administrador Teste" };
const novoBanco = (extra: Partial<Banco> = {}): Banco => ({
  propostas: [{ id_int: 100, status_interno: "LIBERADO" }],
  expedicoes: [],
  os_status_log: [],
  ...extra
});
const rodar = (banco: Banco, opcoes: Opcoes = {}, idInt = 100) => {
  const f = criarFalso(banco, opcoes);
  return marcarPedidoComoEntregue(f.client, { idInt, autor: AUTOR, agora: AGORA }).then((r) => ({ r, escritas: f.escritas }));
};

// ── 1. Caminho feliz: pedido LIBERADO, sem linha em expedicoes ──
{
  const banco = novoBanco();
  const { r, escritas } = await rodar(banco);
  checar("feliz: sucesso e nao idempotente", [r.success, r.success && r.idempotente], [true, false]);
  checar("feliz: status LIBERADO -> ENTREGUE", banco.propostas[0].status_interno, "ENTREGUE");
  checar("feliz: linha em expedicoes criada so com id_int e data_entrega", banco.expedicoes, [{ id_int: 100, data_entrega: AGORA.toISOString() }]);
  checar("feliz: ordem das escritas (data, status, log)", escritas, ["expedicoes.insert", "propostas.update", "os_status_log.insert"]);
  const log = banco.os_status_log[0];
  checar("feliz: uma linha de log", banco.os_status_log.length, 1);
  checar("feliz: log com origem propria, status e autor", [log.origem, log.status_anterior, log.status_novo, log.resultado, log.ator_uid, log.ator_nome, log.ator_tipo, log.id_int],
    [ORIGEM_LOG_ATALHO_ENTREGUE, "LIBERADO", "ENTREGUE", "sucesso", "uid-adm", "Administrador Teste", "USUARIO", 100]);
  checar("feliz: motivo traz o dia de Sao Paulo (nao o dia UTC)", String(log.motivo).includes("10/10/2026"), true);
  checar("feliz: resposta diz que criou a linha e gravou a data", r.success && !r.idempotente ? [r.linhaDeExpedicaoCriada, r.dataEntregaGravadaAgora, r.logGravado, r.aviso] : null, [true, true, true, null]);
}

// ── 2. Idempotencia: repetir o clique ──
{
  const banco = novoBanco();
  await rodar(banco);
  const antes = JSON.stringify(banco);
  const { r, escritas } = await rodar(banco);
  checar("repetir: idempotente, sem escrita", [r.success, r.success && r.idempotente, escritas], [true, true, []]);
  checar("repetir: banco identico (sem 2o log, sem data nova)", JSON.stringify(banco), antes);
}

// ── 3. data_entrega que ja existia nao e sobrescrita ──
{
  const banco = novoBanco({ expedicoes: [{ id_int: 100, data_entrega: "2026-09-01T12:00:00Z", data_despacho: "2026-08-30T12:00:00Z" }] });
  const { r, escritas } = await rodar(banco);
  checar("data existente: mantida", banco.expedicoes[0].data_entrega, "2026-09-01T12:00:00Z");
  checar("data existente: status vira ENTREGUE e nao ha escrita em expedicoes", [banco.propostas[0].status_interno, escritas], ["ENTREGUE", ["propostas.update", "os_status_log.insert"]]);
  checar("data existente: resposta e log dizem que foi mantida", [r.success && !r.idempotente ? r.dataEntregaGravadaAgora : null, String(banco.os_status_log[0].motivo).includes("já existia")], [false, true]);
}

// ── 4. Linha existe sem data: grava so a data, sem tocar data_despacho ──
{
  const banco = novoBanco({ expedicoes: [{ id_int: 100, data_entrega: null, data_despacho: "2026-08-30T12:00:00Z", tipo_frete: "CORREIOS" }] });
  await rodar(banco);
  checar("linha sem data: data_entrega gravada", banco.expedicoes[0].data_entrega, AGORA.toISOString());
  checar("linha sem data: data_despacho e frete intactos", [banco.expedicoes[0].data_despacho, banco.expedicoes[0].tipo_frete], ["2026-08-30T12:00:00Z", "CORREIOS"]);
}

// ── 5. So LIBERADO ──
for (const status of ["REVISAO ATENDENTE", "EM PRODUCAO", "NOVO", "APROVADO", "CANCELADO", null]) {
  const banco = novoBanco({ propostas: [{ id_int: 100, status_interno: status }] });
  const { r, escritas } = await rodar(banco);
  checar(`status ${status}: recusa 409 sem escrever nada`, [r.success, !r.success && r.httpStatus, !r.success && r.code, escritas], [false, 409, "STATUS_NAO_LIBERADO", []]);
}
{
  const { r, escritas } = await rodar(novoBanco(), {}, 999);
  checar("pedido inexistente: 404 sem escrita", [r.success, !r.success && r.httpStatus, escritas], [false, 404, []]);
}

// ── 6. Falha na 1a escrita (data): nada mais muda ──
{
  const banco = novoBanco();
  const { r, escritas } = await rodar(banco, { falhas: { "expedicoes.insert": { message: "erro de teste" } } });
  checar("data falhou: erro claro, status segue LIBERADO", [r.success, !r.success && r.code, banco.propostas[0].status_interno], [false, "EXPEDICAO_NAO_GRAVADA", "LIBERADO"]);
  checar("data falhou: nao tentou status nem log", escritas, ["expedicoes.insert"]);
  checar("data falhou: mensagem diz que nada foi alterado", !r.success && r.message.includes("Nada foi alterado"), true);
}

// ── 7. Status muda no meio (outra pessoa): desfaz a data que este atalho gravou ──
{
  const banco = novoBanco();
  const { r, escritas } = await rodar(banco, { antes: { "propostas.update": (b) => { b.propostas[0].status_interno = "REVISAO ATENDENTE"; } } });
  checar("status mudou: 409 STATUS_MUDOU", [r.success, !r.success && r.code], [false, "STATUS_MUDOU"]);
  checar("status mudou: status de quem chegou antes preservado", banco.propostas[0].status_interno, "REVISAO ATENDENTE");
  checar("status mudou: a data gravada pelo atalho foi desfeita (linha fica, data nula)", banco.expedicoes, [{ id_int: 100, data_entrega: null, updated_at: banco.expedicoes[0].updated_at }]);
  checar("status mudou: sem log", banco.os_status_log.length, 0);
  checar("status mudou: escritas = data, tentativa de status, desfazer data", escritas, ["expedicoes.insert", "propostas.update", "expedicoes.update"]);
}

// ── 8. Corrida: outro clique ja deixou ENTREGUE entre a leitura e a gravacao ──
{
  const banco = novoBanco();
  const { r, escritas } = await rodar(banco, { antes: { "propostas.update": (b) => { b.propostas[0].status_interno = "ENTREGUE"; } } });
  checar("corrida: idempotente, sem log nosso", [r.success, r.success && r.idempotente, banco.os_status_log.length], [true, true, 0]);
  checar("corrida: nao desfaz a data (o outro caminho a usa)", banco.expedicoes[0].data_entrega, AGORA.toISOString());
  checar("corrida: escritas = data e tentativa de status", escritas, ["expedicoes.insert", "propostas.update"]);
}

// ── 9. Erro no UPDATE do status: desfaz a data ──
{
  const banco = novoBanco();
  const { r } = await rodar(banco, { falhas: { "propostas.update": { message: "erro de teste" } } });
  checar("update do status falhou: erro 500 STATUS_NAO_GRAVADO e data desfeita", [r.success, !r.success && r.code, banco.expedicoes[0].data_entrega, banco.propostas[0].status_interno], [false, "STATUS_NAO_GRAVADO", null, "LIBERADO"]);
}

// ── 10. Falha ao desfazer a data: o estado inconsistente e dito com todas as letras ──
{
  const banco = novoBanco();
  const { r } = await rodar(banco, { falhas: { "propostas.update": { message: "erro 1" }, "expedicoes.update": { message: "erro 2" } } });
  checar("nao conseguiu desfazer: avisa estado inconsistente", !r.success && r.message.includes("Estado inconsistente"), true);
}

// ── 11. Log falhou: as duas primeiras escritas valem e a resposta AVISA ──
{
  const banco = novoBanco();
  const { r } = await rodar(banco, { falhas: { "os_status_log.insert": { message: "sem permissao" } } });
  checar("log falhou: status ENTREGUE e data gravados", [banco.propostas[0].status_interno, banco.expedicoes[0].data_entrega], ["ENTREGUE", AGORA.toISOString()]);
  checar("log falhou: success true, logGravado false e aviso preenchido", r.success && !r.idempotente ? [r.logGravado, Boolean(r.aviso)] : null, [false, true]);
}

// ── 12. Outra escrita criou a linha de expedicoes entre a leitura e o INSERT ──
{
  const banco = novoBanco();
  const { r } = await rodar(banco, { antes: { "expedicoes.insert": (b) => { b.expedicoes.push({ id_int: 100, data_entrega: "2026-10-01T10:00:00Z" }); } } });
  checar("linha criada no meio: data dela vale, nao e sobrescrita", [banco.expedicoes.length, banco.expedicoes[0].data_entrega], [1, "2026-10-01T10:00:00Z"]);
  checar("linha criada no meio: o pedido ainda vira ENTREGUE", [r.success, banco.propostas[0].status_interno], [true, "ENTREGUE"]);
}

// ── 13. Regras da tela e do servidor ──
checar("tela: ADM + LIBERADO ve", podeVerMarcarComoEntregue({ isAdmin: true }, "LIBERADO"), true);
checar("tela: super ADM + LIBERADO ve", podeVerMarcarComoEntregue({ isSuperAdmin: true }, "LIBERADO"), true);
checar("tela: nao-ADM nao ve", podeVerMarcarComoEntregue({ isAdmin: false, isSuperAdmin: false }, "LIBERADO"), false);
checar("tela: sem usuario nao ve", [podeVerMarcarComoEntregue(null, "LIBERADO"), podeVerMarcarComoEntregue(undefined, "LIBERADO")], [false, false]);
for (const s of ["APROVADO", "ENTREGUE", "REVISAO ATENDENTE", "NOVO", "LIBERADO / EM ARTE", null, ""]) {
  checar(`tela: ADM com status ${JSON.stringify(s)} nao ve`, podeVerMarcarComoEntregue({ isAdmin: true }, s), false);
}
checar("servidor: ADM so por is_admin ou is_super_adm", [ehAdmNoServidor({ is_admin: true }), ehAdmNoServidor({ is_super_adm: true }), ehAdmNoServidor({ is_admin: false, is_super_adm: false }), ehAdmNoServidor(null)], [true, true, false, false]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
