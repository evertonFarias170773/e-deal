/**
 * Acompanhar Pedido (Fase 7): regras puras e o cliente da rota.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/acompanhar-pedido.test.mts
 *
 * Sem banco. A gravacao (vincular/soltar) foi provada no banco em transacao
 * desfeita; aqui ficam candidatos, teto, simetria, desmarcar, sem permissao,
 * so leitura e falha da rota.
 */
import {
  TETO_CANDIDATOS,
  TETO_GRUPO,
  AVISO_GRUPO_GRANDE,
  grupoEhGrande,
  mensagemTetoDoGrupo,
  AVISO_AINDA_NAO_CHEGOU,
  aindaNaoChegouAExpedicao,
  faixasDeBuscaPorNumero,
  mensagemDeErroAcompanhar,
  montarCandidatos,
  motivoSomenteLeitura,
  planejarMudancaDoSeletor,
  podeSerCandidato,
  type PedidoParaAcompanhar
} from "../../src/features/orcamentos/lib/acompanhar-pedido.ts";
import { linhaAcompanha } from "../../src/features/orcamentos/lib/visualizacao-da-proposta.ts";

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

const ref = { idInt: 100, idCliente: 14, idFaturado: 900 };
const ped = (o: Partial<PedidoParaAcompanhar> & { idInt: number }): PedidoParaAcompanhar => ({
  idCliente: 14,
  idFaturado: null,
  cliente: "Cliente",
  statusInterno: "EM PRODUCAO",
  criadoEm: "2026-10-01T10:00:00Z",
  avulso: false,
  encerradoTeste: false,
  despachado: false,
  grupoAcompanhar: null,
  ...o
});

// ── candidatos: cliente OU pagador
checar("mesmo cliente entra", podeSerCandidato(ped({ idInt: 1 }), ref), true);
checar("outro cliente, mesmo pagador entra", podeSerCandidato(ped({ idInt: 2, idCliente: 99, idFaturado: 900 }), ref), true);
checar("outro cliente e outro pagador nao entra", podeSerCandidato(ped({ idInt: 3, idCliente: 99, idFaturado: 901 }), ref), false);
checar("pagador nulo nao casa com pagador nulo", podeSerCandidato(ped({ idInt: 4, idCliente: 99, idFaturado: null }), { ...ref, idFaturado: null }), false);
checar("o proprio pedido nao e candidato", podeSerCandidato(ped({ idInt: 100 }), ref), false);
checar("cancelado nao entra", podeSerCandidato(ped({ idInt: 5, statusInterno: "CANCELADO" }), ref), false);
checar("NOVO entra (o vinculo vale antes da Expedicao)", podeSerCandidato(ped({ idInt: 6, statusInterno: "NOVO" }), ref), true);

checar("APROVADO entra", podeSerCandidato(ped({ idInt: 7, statusInterno: "APROVADO" }), ref), true);
checar("EXPEDICAO entra", podeSerCandidato(ped({ idInt: 8, statusInterno: "EXPEDICAO" }), ref), true);
checar("EM TRANSITO nao entra", podeSerCandidato(ped({ idInt: 9, statusInterno: "EM TRANSITO" }), ref), false);
checar("ENTREGUE e RECEBIDO nao entram", [podeSerCandidato(ped({ idInt: 13, statusInterno: "ENTREGUE" }), ref), podeSerCandidato(ped({ idInt: 14, statusInterno: "RECEBIDO" }), ref)], [false, false]);
for (const st of ["NOVO", "AGUARDANDO", "APROVADO", "LIBERADO", "REVISAO ATENDENTE", "REVISAO PRODUCAO", "EM PRODUCAO", "EM IMPRESSAO", "EM ACABAMENTO", "EXPEDICAO"]) {
  checar(`aberto: ${st}`, podeSerCandidato(ped({ idInt: 20, statusInterno: st }), ref), true);
}
checar("despachado nao entra", podeSerCandidato(ped({ idInt: 10, despachado: true }), ref), false);
checar("avulso nao entra", podeSerCandidato(ped({ idInt: 11, avulso: true }), ref), false);
checar("teste encerrado nao entra", podeSerCandidato(ped({ idInt: 12, encerradoTeste: true }), ref), false);

// ── teto de 10 e busca por numero
const muitos = Array.from({ length: 25 }, (_, i) => ped({ idInt: 200 + i }));
const lista = montarCandidatos(muitos, ref, null);
checar("teto de candidatos", lista.length, TETO_CANDIDATOS);
checar("mais novos primeiro", lista.slice(0, 2).map((c) => c.idInt), [224, 223]);
checar("busca por numero acha o pedido fora do teto (o servidor entrega todos os elegiveis)", montarCandidatos(muitos, ref, null, "200").map((c) => c.idInt), [200]);
checar("busca sem resultado", montarCandidatos(muitos, ref, null, "999").length, 0);

// ── pedido em OUTRO grupo aparece desabilitado, com o motivo
const emOutro = montarCandidatos([ped({ idInt: 300, grupoAcompanhar: { grupoId: "gB", membros: [300, 301, 302] } })], ref, "gA");
checar("em outro grupo: desabilitado", emOutro[0].desabilitado, true);
checar("em outro grupo: motivo cita os outros", emOutro[0].motivo, "Já está em outro grupo Acompanhar (#301, #302)");
const noMesmo = montarCandidatos([ped({ idInt: 301, grupoAcompanhar: { grupoId: "gA", membros: [100, 301] } })], ref, "gA");
checar("no mesmo grupo: nao desabilita", noMesmo[0].desabilitado, false);

// ── busca por numero no servidor: alcanca qualquer id que comece pelo digitado
checar("busca 2345 cobre 2345 e 23450-23459 ... ate 7 digitos", faixasDeBuscaPorNumero("2345"), ["and(id_int.gte.2345,id_int.lte.2345)", "and(id_int.gte.23450,id_int.lte.23459)", "and(id_int.gte.234500,id_int.lte.234599)", "and(id_int.gte.2345000,id_int.lte.2345999)"]);
checar("busca vazia ou so letras: sem faixa", [faixasDeBuscaPorNumero(""), faixasDeBuscaPorNumero("abc")], [[], []]);
checar("busca de 7 digitos: so o proprio", faixasDeBuscaPorNumero("2345678"), ["and(id_int.gte.2345678,id_int.lte.2345678)"]);

// ── so leitura
const base = { statusInterno: "EM PRODUCAO", despachado: false, avulso: false, encerradoTeste: false };
checar("pedido normal: editavel", motivoSomenteLeitura(base), null);
checar("pedido em NOVO: editavel (checkbox habilitado)", motivoSomenteLeitura({ ...base, statusInterno: "NOVO" }), null);
checar("pedido em AGUARDANDO: editavel", motivoSomenteLeitura({ ...base, statusInterno: "AGUARDANDO" }), null);
checar("despachado: so leitura", motivoSomenteLeitura({ ...base, despachado: true }), "Pedido já despachado.");
checar("EM TRANSITO: so leitura", motivoSomenteLeitura({ ...base, statusInterno: "EM TRANSITO" }), "Pedido já despachado.");
checar("A RETIRAR: so leitura", motivoSomenteLeitura({ ...base, statusInterno: "A RETIRAR" }), "Pedido já despachado.");
checar("ENTREGUE: so leitura", motivoSomenteLeitura({ ...base, statusInterno: "ENTREGUE" }), "Pedido já despachado.");
checar("cancelado: so leitura", motivoSomenteLeitura({ ...base, statusInterno: "CANCELADO" }), "Pedido cancelado.");
checar("avulso: so leitura", motivoSomenteLeitura({ ...base, avulso: true }), "Pedido avulso não vai para a Expedição.");
checar("o motivo nunca diz 'funil'", ["CANCELADO", "EM TRANSITO", "ENTREGUE"].every((s) => !String(motivoSomenteLeitura({ ...base, statusInterno: s })).includes("funil")), true);
checar("aviso do pedido em NOVO", [aindaNaoChegouAExpedicao("NOVO"), aindaNaoChegouAExpedicao("EXPEDICAO")], [true, false]);
checar("texto do aviso", AVISO_AINDA_NAO_CHEGOU, "Este pedido ainda não chegou à Expedição: o grupo só despacha quando todos chegarem. Para soltar: peça a um administrador da Expedição.");

// a MESMA definicao vale no pedido editado e nos candidatos
for (const cenario of [{ despachado: true }, { avulso: true }, { encerradoTeste: true }, { statusInterno: "CANCELADO" }, { statusInterno: "EM TRANSITO" }, { statusInterno: "NOVO" }]) {
  const sit = { ...base, ...cenario };
  checar(`mesma definicao: ${JSON.stringify(cenario)}`, podeSerCandidato(ped({ idInt: 30, ...sit }), ref), motivoSomenteLeitura(sit) === null);
}

// ── marcar / desmarcar e simetria
const m1 = planejarMudancaDoSeletor([], [101, 102], 100);
checar("marcar dois: um vincular com os dois", [m1.vincular, m1.soltar, m1.erro], [[101, 102], [], null]);
const m2 = planejarMudancaDoSeletor([101, 102], [101], 100);
checar("tirar um: solta so aquele", [m2.vincular, m2.soltar, m2.erro], [[], [102], null]);
// simetria: a partir do pedido 101 do mesmo grupo (membros 100 e 102), marcar o 103 entra no mesmo grupo
const m3 = planejarMudancaDoSeletor([100, 102], [100, 102, 103], 101);
checar("simetria: marcar a partir de outro membro", [m3.vincular, m3.soltar], [[103], []]);
checar("o proprio pedido no seletor e ignorado", planejarMudancaDoSeletor([], [100, 101], 100).vincular, [101]);
const cheio = planejarMudancaDoSeletor(
  Array.from({ length: TETO_GRUPO - 1 }, (_, i) => 500 + i),
  [...Array.from({ length: TETO_GRUPO - 1 }, (_, i) => 500 + i), 999],
  100
);
checar("grupo cheio: recusa", [cheio.vincular, cheio.erro], [[], mensagemTetoDoGrupo()]);
checar("limite tecnico e 50", TETO_GRUPO, 50);
checar("mensagem do limite", mensagemTetoDoGrupo(), "O grupo aceita no máximo 50 pedidos. Para ampliar além disso, fale com o suporte.");
// grupo com mais de 10 membros: aceita ate 50
const g12 = Array.from({ length: 12 }, (_, i) => 700 + i);
const m12 = planejarMudancaDoSeletor(g12, [...g12, 800], 100);
checar("grupo de 13 aceita mais um (nao ha limite de 10)", [m12.vincular, m12.erro], [[800], null]);
const g49 = Array.from({ length: 48 }, (_, i) => 900 + i);
checar("48 + o proprio = 49: aceita o 50o", planejarMudancaDoSeletor(g49, [...g49, 999], 100).erro, null);
checar("50 + o 51o: recusa", planejarMudancaDoSeletor([...g49, 999], [...g49, 999, 998], 100).erro, mensagemTetoDoGrupo());
checar("aviso de grupo grande: so acima de 10", [grupoEhGrande(10), grupoEhGrande(11), grupoEhGrande(50)], [false, true, true]);
checar("texto do aviso de grupo grande", AVISO_GRUPO_GRANDE, "Grupo grande: se um pedido ficar parado, todos esperam. Um administrador da Expedição pode soltá-lo.");
// status vazio: nao esta em aberto nos DOIS lados (pedido editado e candidato)
const vazio = { ...base, statusInterno: "" };
checar("status vazio: pedido editado em leitura com o motivo", motivoSomenteLeitura(vazio), "Pedido sem status definido: avise o suporte.");
checar("status vazio: nao e candidato", podeSerCandidato(ped({ idInt: 40, statusInterno: "" }), ref), false);
checar("status vazio nulo tratado como vazio", motivoSomenteLeitura({ ...base, statusInterno: undefined as unknown as string }), "Pedido sem status definido: avise o suporte.");
checar("status vazio e despachado: diz despachado", motivoSomenteLeitura({ ...vazio, despachado: true }), "Pedido já despachado.");

// ── mensagens (sem permissao, ligacao de outra pessoa, sessao)
checar("403 sem permissao", mensagemDeErroAcompanhar(403, "SEM_PERMISSAO", null), "Voce nao tem permissao para alterar o grupo Acompanhar (propostas.edit).");
checar(
  "403 ligacao de terceiro",
  mensagemDeErroAcompanhar(403, "SOLTAR_DE_TERCEIRO", null),
  "Esta ligacao foi criada por outra pessoa. So quem a criou ou o admin da Expedicao pode soltar este pedido."
);
checar("401 sessao", mensagemDeErroAcompanhar(401, null, null), "Sessao expirada. Faca login novamente.");
checar("erro do banco perde o prefixo tecnico", mensagemDeErroAcompanhar(422, "P0001", "VINC_CLIENTE: o pedido #5 nao e do mesmo cliente"), "o pedido #5 nao e do mesmo cliente");

// ── linha "Acompanha:" da visualizacao
checar("linha com dois pedidos", linhaAcompanha([101, 102]), "Acompanha: #101, #102");
checar("sem grupo: sem linha", [linhaAcompanha([]), linhaAcompanha(null), linhaAcompanha(undefined)], [null, null, null]);
checar("ids repetidos ou invalidos sao ignorados", linhaAcompanha([5, 5, 0, -1]), "Acompanha: #5");

// ── cliente da rota: falha de rede, 403 e sucesso (fetch e sessao simulados)
const reais = globalThis as unknown as { fetch: typeof fetch };
const fetchOriginal = reais.fetch;
const { buscarEstadoAcompanhar, vincularAcompanhar, soltarAcompanhar } = await import("../../src/features/orcamentos/services/acompanhar.client.ts");

reais.fetch = (async () => {
  throw new Error("rede");
}) as typeof fetch;
const rede = await vincularAcompanhar(100, [101]);
checar("falha da rota: mensagem clara, sem estourar", rede, { success: false, errorMessage: "Nao foi possivel falar com o servidor. Tente de novo." });

reais.fetch = (async () =>
  new Response(JSON.stringify({ success: false, code: "SOLTAR_DE_TERCEIRO", message: "texto do servidor" }), { status: 403 })) as typeof fetch;
const negado = await soltarAcompanhar(100, "motivo", 101);
checar("sem permissao: devolve a mensagem da rota", negado, { success: false, code: "SOLTAR_DE_TERCEIRO", errorMessage: "texto do servidor" });

reais.fetch = (async () => new Response("<html>erro</html>", { status: 500 })) as typeof fetch;
const quebrado = await buscarEstadoAcompanhar(100);
checar("resposta que nao e JSON", quebrado.success, false);

reais.fetch = (async (_u: unknown, init?: RequestInit) => {
  checar("vincular manda a acao e o proprio pedido", JSON.parse(String(init?.body)), { acao: "vincular", id_int: 100, outros: [101] });
  return new Response(JSON.stringify({ success: true, estado: { idInt: 100, membros: [] } }), { status: 200 });
}) as typeof fetch;
const ok = await vincularAcompanhar(100, [101]);
checar("sucesso devolve o estado", ok.success, true);
reais.fetch = fetchOriginal;

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
