/**
 * Refazer boleto (C6) — src/features/contas-a-receber/services/refazer-boleto.ts
 *
 * NÃO TOCA EM BANCO NENHUM, nem no de dados nem no emissor. A tabela `boletos`
 * é uma lista em memória (com a mesma trava de "uma parcela ativa por
 * proposta" do índice `boletos_unico_parcela_ativo`), e a consulta, o
 * cancelamento e o registro no C6 são respostas simuladas.
 *
 * O QUE PROVA
 *   1. Refazer com a NF corrigida: o boleto antigo fica CANCELADO e anotado
 *      como substituído; o novo tem a mesma parcela, valor e vencimento, a NF
 *      nova e os dados que o banco devolveu; a cobrança não é tocada.
 *   2. Pago no banco: bloqueia antes de cancelar, nada muda.
 *   3. Falha no registro novo: o título fica pendente de registro (sem dado
 *      bancário), com a correção gravada.
 *   4. Em nenhum momento há duas linhas ativas para a mesma parcela.
 *   5. Parcela vencida, vencimento no passado, motivo vazio, Ideal Birô,
 *      consulta sem resposta e recusa do banco: nada é alterado.
 *   6. Falha no meio da gravação: repetir conclui, sem cancelar duas vezes e
 *      sem histórico em dobro.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/refazer-boleto.test.mts
 */
import {
  MARCA_SUBSTITUIDO,
  MENSAGEM_PARCELA_VENCIDA,
  refazerBoletoC6,
  type DependenciasDoRefazer,
  type LinhaBoleto,
  type PedidoDeRefazer
} from "../../src/features/contas-a-receber/services/refazer-boleto.ts";

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

// ── Tabela `boletos` em memória ──────────────────────────────────────────────
type Linha = Record<string, unknown>;
const ativa = (l: Linha) => String(l.status ?? "").toUpperCase() !== "CANCELADO";

function criarBanco(inicial: Linha[]) {
  const linhas: Linha[] = inicial.map((l) => ({ ...l }));
  const eventos: string[] = [];
  /** Maior número de linhas ativas da mesma parcela visto depois de cada escrita. */
  let maxAtivasDaParcela = 0;
  /** Faz a próxima escrita do tipo falhar uma vez (janela de falha). */
  const falharUmaVez = new Set<string>();
  let proximoId = 1;

  const conferirAtivas = () => {
    const porParcela = new Map<string, number>();
    for (const l of linhas.filter(ativa)) {
      const chave = `${l.id_int}/${l.parcela}`;
      porParcela.set(chave, (porParcela.get(chave) ?? 0) + 1);
    }
    maxAtivasDaParcela = Math.max(maxAtivasDaParcela, ...porParcela.values(), 0);
  };
  const violaUnico = (candidata: Linha, ignorarId?: unknown) =>
    ativa(candidata) &&
    linhas.some((l) => l.id !== ignorarId && ativa(l) && l.id_int === candidata.id_int && l.parcela === candidata.parcela);

  function from(tabela: string) {
    if (tabela !== "boletos") {
      eventos.push(`OUTRA TABELA: ${tabela}`);
      throw new Error(`o Refazer não deveria tocar em ${tabela}`);
    }
    let op: "select" | "insert" | "update" = "select";
    let payload: Linha = {};
    let limite = Infinity;
    const filtros: Array<(l: Linha) => boolean> = [];

    const executar = () => {
      if (op === "insert") {
        if (falharUmaVez.delete("insert")) return { data: null, error: { message: "falha simulada no insert" } };
        const nova = { ...payload, id: `hist-${proximoId++}` };
        if (violaUnico(nova)) return { data: null, error: { message: "duplicate key: boletos_unico_parcela_ativo" } };
        linhas.push(nova);
        eventos.push(`insert status=${nova.status}`);
        conferirAtivas();
        return { data: [nova], error: null };
      }
      const alvo = linhas.filter((l) => filtros.every((f) => f(l)));
      if (op === "update") {
        if (falharUmaVez.delete("update")) return { data: null, error: { message: "falha simulada no update" } };
        for (const l of alvo) {
          if (violaUnico({ ...l, ...payload }, l.id)) return { data: null, error: { message: "duplicate key" } };
          Object.assign(l, payload);
        }
        eventos.push(`update(${alvo.length}) ${Object.keys(payload).includes("id_boleto_c6") ? (payload.id_boleto_c6 === null ? "limpa registro" : "grava registro") : "outro"}`);
        conferirAtivas();
        return { data: alvo.map((l) => ({ ...l })), error: null };
      }
      return { data: alvo.slice(0, limite).map((l) => ({ ...l })), error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: Linha) => { op = "insert"; payload = p; return b; },
      update: (p: Linha) => { op = "update"; payload = p; return b; },
      eq: (col: string, v: unknown) => { filtros.push((l) => l[col] === v); return b; },
      neq: (col: string, v: unknown) => { filtros.push((l) => l[col] !== v); return b; },
      limit: (n: number) => { limite = n; return b; },
      maybeSingle: async () => { const r = executar(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then: (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve(executar()).then(ok, falha)
    };
    return b;
  }

  return { from, linhas, eventos, falharUmaVez, get maxAtivasDaParcela() { return maxAtivasDaParcela; } };
}

// ── Cenário base: parcela 1/2 registrada no C6, sem número de NF ─────────────
const HOJE = "2026-10-02";
const titulo = (extra: Linha = {}): Linha => ({
  id: "titulo-1",
  id_int: 90001,
  id_pagamento: "90001-B",
  id_empresa: 1,
  id_cliente: 555,
  parcela: 1,
  total_parcelas: 2,
  valor: 3972,
  vencimento: "2026-10-14",
  status: "A_VENCER",
  paid_at: null,
  n_nf: null,
  descricao: "Parcela 1/2 - Boleto E-Faturado - OS: 1",
  n_doc_boleto: "P1290001",
  ext_reference: "P1290001",
  nome_cliente: "CLIENTE ANTIGO LTDA",
  documento: "11222333000144",
  id_boleto_c6: "C6-ANTIGO",
  nosso_numero: "111",
  linha_digitavel: "33690.00041 ANTIGA",
  codigo_barras: "3369ANTIGO",
  url_pdf: "https://x/boletos/90001/parcela_1.pdf",
  pdf_storage: "90001/parcela_1.pdf",
  is_faturado: true,
  deposito_conta: false,
  motivo_prorg: null,
  ...extra
});

const pedido = (extra: Partial<PedidoDeRefazer> = {}): PedidoDeRefazer => ({
  boletoId: "titulo-1",
  nNf: "7812",
  descricao: "Parcela 1/2 - Boleto E-Faturado - OS: 1",
  vencimento: "2026-10-14",
  motivo: "Faltou o número da NF",
  hoje: HOJE,
  usuario: "Financeiro Teste",
  agoraIso: "2026-10-02T14:30:00.000Z",
  pagador: { nome: "CLIENTE CADASTRO LTDA", documento: "11.222.333/0001-44" },
  ...extra
});

function simular(
  banco: ReturnType<typeof criarBanco>,
  respostas: {
    consulta?: unknown | (() => unknown);
    cancelar?: () => unknown;
    registrar?: (linha: LinhaBoleto) => unknown;
  } = {}
) {
  const chamadas: string[] = [];
  let recebidoNoRegistro: LinhaBoleto | null = null;
  const deps: DependenciasDoRefazer = {
    client: banco as unknown as DependenciasDoRefazer["client"],
    consultarBanco: async (cod) => {
      chamadas.push(`consultar ${cod}`);
      const r = respostas.consulta ?? { status: "REGISTERED", payments: [] };
      return typeof r === "function" ? (r as () => unknown)() : r;
    },
    cancelarNoBanco: async (_id, cod) => {
      chamadas.push(`cancelar ${cod}`);
      return respostas.cancelar ? respostas.cancelar() : { success: true };
    },
    registrarNoBanco: async (linha) => {
      chamadas.push("registrar");
      recebidoNoRegistro = { ...linha };
      const r = respostas.registrar
        ? respostas.registrar(linha)
        : { data: { id: "C6-NOVO", our_number: "222", digitable_line: "33690.00041 NOVA", bar_code: "3369NOVO" } };
      return r as Awaited<ReturnType<DependenciasDoRefazer["registrarNoBanco"]>>;
    },
    gerarPdf: async () => { chamadas.push("pdf"); return null; }
  };
  return { deps, chamadas, registro: () => recebidoNoRegistro };
}

const ativas = (b: ReturnType<typeof criarBanco>) => b.linhas.filter(ativa);
const canceladas = (b: ReturnType<typeof criarBanco>) => b.linhas.filter((l) => !ativa(l));

// ── 1. Refazer com a NF corrigida ────────────────────────────────────────────
{
  const banco = criarBanco([titulo(), titulo({ id: "titulo-2", parcela: 2, vencimento: "2026-11-21", id_boleto_c6: "C6-P2", n_doc_boleto: "P2290001" })]);
  const s = simular(banco);
  const r = await refazerBoletoC6(pedido(), s.deps);
  console.log("\n— 1. Refazer com a NF corrigida —");
  checar("resultado: refeito e registrado", r, { ok: true, registrado: true, falhaPdf: null });
  checar("ordem no banco emissor: consulta, cancela, registra, PDF", s.chamadas, ["consultar C6-ANTIGO", "cancelar C6-ANTIGO", "registrar", "pdf"]);
  checar("escritas, na ordem: histórico cancelado, título sem registro, título com o registro novo", banco.eventos, ["insert status=CANCELADO", "update(1) limpa registro", "update(1) grava registro"]);

  const antigo = canceladas(banco)[0];
  checar("antigo: CANCELADO, com o boleto antigo do banco", [antigo.status, antigo.id_boleto_c6, antigo.nosso_numero], ["CANCELADO", "C6-ANTIGO", "111"]);
  checar('antigo: anotado como "substituído", com quem, quando e o motivo', antigo.motivo_prorg, `${MARCA_SUBSTITUIDO} em 02/10/2026, 11:30 por Financeiro Teste. Motivo: Faltou o número da NF.`);
  checar("antigo: mesma parcela, valor e vencimento; sem PDF", [antigo.parcela, antigo.valor, antigo.vencimento, antigo.url_pdf, antigo.pdf_storage], [1, 3972, "2026-10-14", null, null]);

  const novo = banco.linhas.find((l) => l.id === "titulo-1")!;
  checar("novo: é o MESMO recebível (mesma linha, mesma cobrança)", [novo.id, novo.id_pagamento, novo.status], ["titulo-1", "90001-B", "A_VENCER"]);
  checar("novo: mesma parcela, valor e vencimento", [novo.parcela, novo.total_parcelas, novo.valor, novo.vencimento], [1, 2, 3972, "2026-10-14"]);
  checar("novo: NF corrigida", novo.n_nf, "7812");
  checar("novo: dados do boleto novo no banco", [novo.id_boleto_c6, novo.nosso_numero, novo.linha_digitavel, novo.codigo_barras], ["C6-NOVO", "222", "33690.00041 NOVA", "3369NOVO"]);
  checar("novo: mesma referência do link público", [novo.n_doc_boleto, novo.ext_reference], ["P1290001", "P1290001"]);
  checar("novo: pagador do cadastro, documento só com dígitos", [novo.nome_cliente, novo.documento], ["CLIENTE CADASTRO LTDA", "11222333000144"]);
  checar("novo: anotação diz o que mudou", String(novo.motivo_prorg).includes("Alterado: NF S/N -> 7812."), true);
  checar("o registro recebeu o título já corrigido e sem registro antigo", [s.registro()?.n_nf, s.registro()?.id_boleto_c6, s.registro()?.vencimento], ["7812", null, "2026-10-14"]);
  checar("uma linha ativa por parcela, em todos os passos", banco.maxAtivasDaParcela, 1);
  checar("a outra parcela não foi tocada", banco.linhas.find((l) => l.id === "titulo-2")?.id_boleto_c6, "C6-P2");
  checar("só `boletos` foi tocada (a cobrança não volta ao Registro)", banco.eventos.filter((e) => e.startsWith("OUTRA")), []);
}

// ── 2. Pago no banco: bloqueia ───────────────────────────────────────────────
for (const [nome, consulta] of [
  ["status PAID", { status: "PAID", payments: [] }],
  ["pagamento registrado", { status: "REGISTERED", payments: [{ date: "2026-10-01", amount: 3972 }] }]
] as const) {
  const banco = criarBanco([titulo()]);
  const s = simular(banco, { consulta });
  const r = await refazerBoletoC6(pedido(), s.deps);
  console.log(`\n— 2. Pago no banco (${nome}) —`);
  checar("bloqueado, com a etapa e o aviso", [r.ok, !r.ok && r.etapa, !r.ok && r.mensagem.startsWith("O banco indica este boleto como pago.")], [false, "PAGO_NO_BANCO", true]);
  checar("só consultou: não cancelou nem registrou", s.chamadas, ["consultar C6-ANTIGO"]);
  checar("nenhuma escrita; título como estava", [banco.eventos, banco.linhas[0].id_boleto_c6, banco.linhas[0].n_nf], [[], "C6-ANTIGO", null]);
}

// ── 3. Falha no registro novo: pendente de registro ──────────────────────────
{
  const banco = criarBanco([titulo()]);
  const s = simular(banco, { registrar: () => { throw new Error("C6 recusou: payer.address inválido"); } });
  const r = await refazerBoletoC6(pedido(), s.deps);
  console.log("\n— 3. Falha no registro novo —");
  checar("resultado: substituído, mas NÃO registrado, com o motivo do banco", r, { ok: true, registrado: false, erroRegistro: "C6 recusou: payer.address inválido" });
  const t = banco.linhas.find((l) => l.id === "titulo-1")!;
  checar("título pendente de registro: ativo e sem nenhum dado bancário", [t.status, t.id_boleto_c6, t.nosso_numero, t.linha_digitavel, t.codigo_barras, t.url_pdf], ["A_VENCER", null, null, null, null, null]);
  checar("a correção ficou gravada (NF, parcela, valor, vencimento)", [t.n_nf, t.parcela, t.valor, t.vencimento], ["7812", 1, 3972, "2026-10-14"]);
  checar("o antigo está CANCELADO e substituído", [canceladas(banco).length, String(canceladas(banco)[0].motivo_prorg).startsWith(MARCA_SUBSTITUIDO)], [1, true]);
  checar("uma ativa por parcela; sem PDF tentado", [ativas(banco).length, banco.maxAtivasDaParcela, s.chamadas.includes("pdf")], [1, 1, false]);
}

// ── 4. O banco respondeu sem os dados do boleto: também fica pendente ────────
{
  const banco = criarBanco([titulo()]);
  const s = simular(banco, { registrar: () => ({ data: {} }) });
  const r = await refazerBoletoC6(pedido(), s.deps);
  console.log("\n— 4. Registro sem dados do boleto —");
  checar("não conta como registrado", [r.ok, r.ok && r.registrado], [true, false]);
  checar("título sem registro", banco.linhas.find((l) => l.id === "titulo-1")?.id_boleto_c6, null);
}

// ── 4b. O n8n devolve o erro como JSON cru: a tela mostra só o motivo ────────
{
  const banco = criarBanco([titulo()]);
  const s = simular(banco, { registrar: () => { throw new Error('{"success":false,"message":"O campo street do pagador é inválido."}'); } });
  const r = await refazerBoletoC6(pedido(), s.deps);
  console.log("\n— 4b. Erro do registro em JSON —");
  checar("motivo legível, sem chaves nem aspas", r.ok && !r.registrado && r.erroRegistro, "O campo street do pagador é inválido.");
}

// ── 5. Recusas antes de tocar no banco emissor ───────────────────────────────
console.log("\n— 5. Recusas sem nenhuma alteração —");
for (const [nome, linhaExtra, pedidoExtra, mensagem] of [
  ["parcela vencida", { vencimento: "2026-10-01" }, {}, MENSAGEM_PARCELA_VENCIDA],
  ["vencimento novo no passado", {}, { vencimento: "2026-10-01" }, "O vencimento não pode ser no passado."],
  ["motivo vazio", {}, { motivo: "   " }, "Informe o motivo para refazer o boleto."],
  ["Ideal Birô (Inter)", { id_empresa: 2 }, {}, "O Refazer boleto ainda não vale para a Ideal Birô (Banco Inter)."],
  ["título já pago", { status: "PAID", paid_at: "2026-10-01T10:00:00Z" }, {}, "Título liquidado não pode ser refeito."],
  ["título sem registro", { id_boleto_c6: null }, {}, 'Este título ainda não tem boleto registrado no banco. Use "Registrar boleto no banco".']
] as const) {
  const banco = criarBanco([titulo(linhaExtra)]);
  const s = simular(banco);
  const r = await refazerBoletoC6(pedido(pedidoExtra), s.deps);
  checar(`${nome}: mensagem`, !r.ok && r.mensagem, mensagem);
  checar(`${nome}: banco emissor não foi chamado e nada foi escrito`, [s.chamadas, banco.eventos], [[], []]);
}

// ── 6. Consulta sem resposta e recusa do cancelamento ────────────────────────
{
  console.log("\n— 6. Consulta sem resposta / cancelamento recusado —");
  const semResposta = criarBanco([titulo()]);
  const s1 = simular(semResposta, { consulta: () => { throw new Error("Status HTTP 502"); } });
  const r1 = await refazerBoletoC6(pedido(), s1.deps);
  checar("consulta falhou: bloqueia", [!r1.ok && r1.etapa, !r1.ok && r1.canceladoNoBanco], ["CONSULTA", false]);
  checar("consulta falhou: não cancelou, nada escrito", [s1.chamadas, semResposta.eventos], [["consultar C6-ANTIGO"], []]);

  const semStatus = criarBanco([titulo()]);
  const s2 = simular(semStatus, { consulta: {} });
  const r2 = await refazerBoletoC6(pedido(), s2.deps);
  checar("consulta sem situação: bloqueia sem cancelar", [!r2.ok && r2.etapa, s2.chamadas], ["CONSULTA", ["consultar C6-ANTIGO"]]);

  const recusado = criarBanco([titulo()]);
  const s3 = simular(recusado, { cancelar: () => { throw new Error("O C6 recusou o cancelamento."); } });
  const r3 = await refazerBoletoC6(pedido(), s3.deps);
  checar("cancelamento recusado: mensagem e nada alterado", [!r3.ok && r3.mensagem, recusado.eventos, recusado.linhas[0].id_boleto_c6], ["O C6 recusou o cancelamento. Nada foi alterado no Contas a Receber.", [], "C6-ANTIGO"]);
}

// ── 7. Falha no meio da gravação: repetir conclui ────────────────────────────
for (const escrita of ["insert", "update"] as const) {
  console.log(`\n— 7. Falha no ${escrita} depois de cancelar no banco —`);
  const banco = criarBanco([titulo()]);
  banco.falharUmaVez.add(escrita);
  const s1 = simular(banco);
  const r1 = await refazerBoletoC6(pedido(), s1.deps);
  checar("primeira tentativa: falha de gravação, já cancelado no banco", [!r1.ok && r1.etapa, !r1.ok && r1.canceladoNoBanco], ["GRAVACAO", true]);
  const t1 = banco.linhas.find((l) => l.id === "titulo-1")!;
  checar("o título continua na tela como estava (dá para repetir)", [t1.status, t1.id_boleto_c6], ["A_VENCER", "C6-ANTIGO"]);

  // Na segunda tentativa o banco já mostra o boleto cancelado.
  const s2 = simular(banco, { consulta: { status: "CANCELLED", payments: [] } });
  const r2 = await refazerBoletoC6(pedido(), s2.deps);
  checar("segunda tentativa: conclui", r2, { ok: true, registrado: true, falhaPdf: null });
  checar("segunda tentativa: NÃO cancela de novo", s2.chamadas, ["consultar C6-ANTIGO", "registrar", "pdf"]);
  checar("um histórico só, uma ativa só", [canceladas(banco).length, ativas(banco).length, banco.maxAtivasDaParcela], [1, 1, 1]);
}

// ── 8. Vencimento corrigido ──────────────────────────────────────────────────
{
  console.log("\n— 8. Vencimento corrigido para outra data futura —");
  const banco = criarBanco([titulo()]);
  const s = simular(banco);
  const r = await refazerBoletoC6(pedido({ vencimento: "2026-10-20", nNf: "" }), s.deps);
  const t = banco.linhas.find((l) => l.id === "titulo-1")!;
  checar("refeito", r.ok && r.registrado, true);
  checar("novo vencimento no título e no registro; antigo guarda o original", [t.vencimento, s.registro()?.vencimento, canceladas(banco)[0].vencimento], ["2026-10-20", "2026-10-20", "2026-10-14"]);
  checar("anotação registra a troca", String(t.motivo_prorg).includes("vencimento 2026-10-14 -> 2026-10-20"), true);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
