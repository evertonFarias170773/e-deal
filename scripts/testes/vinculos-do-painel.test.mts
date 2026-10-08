/**
 * Pedidos vinculados no painel da Expedicao (Fase 5) e a trava de etiqueta /
 * prepostagem do grupo Acompanhar.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/vinculos-do-painel.test.mts
 *
 * Logica pura, sem banco. A regra de "pronto" e do banco
 * (`pedido_pronto_para_expedir`) e foi provada la, em transacao desfeita.
 */
import {
  agruparVinculos,
  classeChipDoTipo,
  classeFaixaDoCard,
  destaqueDoCard,
  dicaDoMembro,
  textoVinculados,
  CLASSE_CHIP_ROSA,
  CLASSE_CHIP_ROXO,
  CLASSE_FAIXA_ROSA,
  CLASSE_FAIXA_ROXA
} from "../../src/features/expedicao/lib/vinculos-do-painel.ts";
import {
  consultarGateAcompanhar,
  lerPendentes,
  mensagemGateAcompanhar
} from "../../src/features/expedicao/lib/gate-acompanhar.ts";

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

const linha = (consulta: number, tipo: string, grupo: string, id: number, ordem: number, status: string, pronto: boolean) => ({
  consulta, tipo, grupo_id: grupo, id_int: id, ordem, status_interno: status, pronto
});

// ── um grupo COMPLEMENTO de dois: cada um ve so o outro
const comp = [
  linha(22137, "COMPLEMENTO", "g1", 22137, 1, "REVISAO ATENDENTE", false),
  linha(22137, "COMPLEMENTO", "g1", 22139, 2, "NOVO", false),
  linha(22139, "COMPLEMENTO", "g1", 22137, 1, "REVISAO ATENDENTE", false),
  linha(22139, "COMPLEMENTO", "g1", 22139, 2, "NOVO", false)
];
const g1 = agruparVinculos(comp);
checar("COMPLEMENTO: 22137 ve so o 22139", g1.get(22137)?.[0].membros.map((m) => m.idInt), [22139]);
checar("COMPLEMENTO: 22139 ve so o 22137", g1.get(22139)?.[0].membros.map((m) => m.idInt), [22137]);
checar("chip: texto com os numeros", textoVinculados(g1.get(22137)![0]), "Vinculados: #22139");
checar("COMPLEMENTO: destaque roxo", destaqueDoCard(g1.get(22137)), "COMPLEMENTO");
checar("COMPLEMENTO: classe do chip e a roxa", classeChipDoTipo("COMPLEMENTO"), CLASSE_CHIP_ROXO);
checar("COMPLEMENTO: faixa roxa", classeFaixaDoCard("COMPLEMENTO"), CLASSE_FAIXA_ROXA);

// ── ACOMPANHAR de tres: rosa, ordem preservada, pronto/nao pronto por membro
const acomp = [
  linha(100, "ACOMPANHAR", "g2", 100, 1, "EXPEDICAO", true),
  linha(100, "ACOMPANHAR", "g2", 300, 3, "REVISAO PRODUCAO", false),
  linha(100, "ACOMPANHAR", "g2", 200, 2, "EXPEDICAO", true)
];
const g2 = agruparVinculos(acomp);
const m100 = g2.get(100)![0].membros;
checar("ACOMPANHAR: ordem do grupo, sem o proprio", m100.map((m) => m.idInt), [200, 300]);
checar("ACOMPANHAR: pronto por membro", m100.map((m) => m.pronto), [true, false]);
checar("ACOMPANHAR: chip com os dois numeros", textoVinculados(g2.get(100)![0]), "Vinculados: #200 · #300");
checar("ACOMPANHAR: destaque rosa", destaqueDoCard(g2.get(100)), "ACOMPANHAR");
checar("ACOMPANHAR: classe do chip e a rosa", classeChipDoTipo("ACOMPANHAR"), CLASSE_CHIP_ROSA);
checar("ACOMPANHAR: faixa rosa", classeFaixaDoCard("ACOMPANHAR"), CLASSE_FAIXA_ROSA);
checar("dica traz status e se esta pronto", dicaDoMembro(m100[1], "ACOMPANHAR"), "Acompanhar: #300 em REVISAO PRODUCAO (ainda nao esta pronto)");
checar("dica de pronto", dicaDoMembro(m100[0], "ACOMPANHAR"), "Acompanhar: #200 em EXPEDICAO (pronto para expedir)");

// ── pedido nos dois tipos: roxo com marcador rosa; COMPLEMENTO vem primeiro
const dois = agruparVinculos([
  linha(500, "ACOMPANHAR", "g4", 500, 1, "EXPEDICAO", true),
  linha(500, "ACOMPANHAR", "g4", 600, 2, "NOVO", false),
  linha(500, "COMPLEMENTO", "g3", 500, 1, "EXPEDICAO", true),
  linha(500, "COMPLEMENTO", "g3", 700, 2, "EXPEDICAO", true)
]);
checar("dois tipos: dois grupos", dois.get(500)?.length, 2);
checar("dois tipos: COMPLEMENTO primeiro", dois.get(500)?.map((g) => g.tipo), ["COMPLEMENTO", "ACOMPANHAR"]);
checar("dois tipos: destaque AMBOS", destaqueDoCard(dois.get(500)), "AMBOS");
checar("dois tipos: faixa do card e a roxa", classeFaixaDoCard("AMBOS"), CLASSE_FAIXA_ROXA);

// ── sem vinculo / leitura que falhou / linhas ruins: card como hoje
checar("sem vinculo: destaque NENHUM", destaqueDoCard(undefined), "NENHUM");
checar("sem vinculo: sem faixa", classeFaixaDoCard("NENHUM"), "");
checar("leitura que falhou (null): mapa vazio", agruparVinculos(null).size, 0);
checar("leitura que falhou (undefined): mapa vazio", agruparVinculos(undefined).size, 0);
checar("linhas malformadas sao ignoradas", agruparVinculos([null, 7, {}, { consulta: "x" }, { consulta: 1, id_int: 2, tipo: "OUTRO", grupo_id: "g" }]).size, 0);
checar("grupo so com o proprio pedido nao entra", agruparVinculos([linha(9, "COMPLEMENTO", "g9", 9, 1, "NOVO", false)]).size, 0);
checar("id vindo como texto (bigint do PostgREST) funciona", agruparVinculos([linha("10" as unknown as number, "COMPLEMENTO", "g", "11" as unknown as number, 1, "NOVO", true)]).get(10)?.[0].membros[0].idInt, 11);

// ── trava de etiqueta / prepostagem
const pend = lerPendentes({ em_grupo: true, grupo_id: "g", pendentes: [{ id_int: 23321, status: "REVISAO PRODUCAO" }, { id_int: 5, status: "" }] });
checar("lerPendentes", pend, [{ idInt: 23321, status: "REVISAO PRODUCAO" }, { idInt: 5, status: "" }]);
checar("lerPendentes: resposta vazia ou torta", [lerPendentes(null), lerPendentes({}), lerPendentes({ pendentes: "x" })], [[], [], []]);
checar(
  "mensagem diz quais pedidos faltam",
  mensagemGateAcompanhar(23248, pend, "a etiqueta"),
  "O pedido #23248 esta em um grupo Acompanhar: a etiqueta so sai quando todos os pedidos do grupo estiverem prontos para expedir. Faltam: #23321 (REVISAO PRODUCAO), #5 (sem status)."
);

const falso = (resposta: { data: unknown; error: { message: string } | null }) => ({
  rpc: async (fn: string, args: Record<string, unknown>) => {
    checar(`rpc chamada: ${fn}`, [fn, args], ["acompanhar_pendentes", { p_id_int: 1 }]);
    return resposta;
  }
});
const livre = await consultarGateAcompanhar(falso({ data: { em_grupo: false, grupo_id: null, pendentes: [] }, error: null }), 1, "a etiqueta");
checar("fora de grupo: nao bloqueia", livre, { bloqueado: false });
const pronto = await consultarGateAcompanhar(falso({ data: { em_grupo: true, grupo_id: "g", pendentes: [] }, error: null }), 1, "a etiqueta");
checar("grupo todo pronto: nao bloqueia", pronto, { bloqueado: false });
const trava = await consultarGateAcompanhar(falso({ data: { em_grupo: true, grupo_id: "g", pendentes: [{ id_int: 2, status: "NOVO" }] }, error: null }), 1, "a prepostagem");
checar("grupo com pendente: bloqueia e cita quem falta", [trava.bloqueado, trava.bloqueado && trava.mensagem.includes("#2 (NOVO)"), trava.bloqueado && trava.mensagem.includes("a prepostagem")], [true, true, true]);
const erro = await consultarGateAcompanhar(falso({ data: null, error: { message: "boom" } }), 1, "a etiqueta");
checar("consulta que falha: nao libera", [erro.bloqueado, erro.bloqueado && erro.mensagem.includes("boom")], [true, true]);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
