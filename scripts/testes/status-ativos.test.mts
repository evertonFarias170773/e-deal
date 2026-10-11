/**
 * Testes do status "Ativos" da lista de Pedidos (regra em um lugar so).
 *
 *   node --experimental-strip-types scripts/testes/status-ativos.test.mts
 *
 * Rode depois de mexer em src/features/orcamentos/lib/status-ativos.ts. A prova
 * contra o banco (contagem do servico real x SQL) mora em scratch/prova-status-ativos.mts.
 */
import {
  MODELO_TODOS,
  STATUS_ATIVOS,
  STATUS_FORA_DOS_ATIVOS,
  STATUS_PADRAO_DA_LISTA,
  STATUS_TODOS,
  ativosValem,
  condicoesDosAtivosParaOServidor,
  passaAtivos,
  statusEhAtivos,
  statusEhEspecifico,
  statusSaiDosAtivos
} from "../../src/features/orcamentos/lib/status-ativos.ts";

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

const ped = (statusInterno: string | null, extra: { avulso?: boolean; encerrado?: boolean } = {}) => ({
  statusInterno,
  isAvulsoRaw: extra.avulso === true ? true : extra.avulso === false ? false : null,
  encerradoTesteEm: extra.encerrado ? "2026-10-01T10:00:00Z" : null
});
const ativos = (modelo: string = MODELO_TODOS, temBusca = false) => ({ status: STATUS_ATIVOS, modelo, temBusca });

// — Constantes —
checar("a lista abre em Ativos", STATUS_PADRAO_DA_LISTA, "ATIVOS");
checar("status que saem dos Ativos", [...STATUS_FORA_DOS_ATIVOS], ["ENTREGUE", "EM TRANSITO", "CANCELADO"]);
checar("Ativos e visao, nao status especifico", [statusEhEspecifico(STATUS_ATIVOS), statusEhEspecifico(STATUS_TODOS), statusEhEspecifico("ENTREGUE")], [false, false, true]);
checar("statusEhAtivos", [statusEhAtivos("ATIVOS"), statusEhAtivos("TODOS"), statusEhAtivos(undefined)], [true, false, false]);

// — Status que saem —
checar("ENTREGUE sai", statusSaiDosAtivos("ENTREGUE"), true);
checar("EM TRANSITO sai", statusSaiDosAtivos("EM TRANSITO"), true);
checar("CANCELADO sai", statusSaiDosAtivos("CANCELADO"), true);
checar("cancelada legado (minuscula) sai", statusSaiDosAtivos("cancelada"), true);
checar("status com espaco e minuscula", statusSaiDosAtivos("  entregue "), true);
for (const s of ["NOVO", "AGUARDANDO", "LIBERADO", "APROVADO", "EM PRODUCAO", "EXPEDICAO", "A RETIRAR", "REVISAO ATENDENTE", "AGUARDANDO_ARTE_APROVADA", "EM ACABAMENTO"]) {
  checar(`${s} fica`, statusSaiDosAtivos(s), false);
}
checar("status vazio fica", [statusSaiDosAtivos(null), statusSaiDosAtivos(""), statusSaiDosAtivos(undefined)], [false, false, false]);

// — Lista com Ativos, sem modelo escolhido, sem busca —
checar("Ativos: ENTREGUE fora", passaAtivos(ped("ENTREGUE"), ativos()), false);
checar("Ativos: EM TRANSITO fora", passaAtivos(ped("EM TRANSITO"), ativos()), false);
checar("Ativos: CANCELADO fora", passaAtivos(ped("CANCELADO"), ativos()), false);
checar("Ativos: LIBERADO proposta entra", passaAtivos(ped("LIBERADO", { avulso: false }), ativos()), true);
checar("Ativos: status vazio entra", passaAtivos(ped(null), ativos()), true);
checar("Ativos: avulso fora", passaAtivos(ped("LIBERADO", { avulso: true }), ativos()), false);
checar("Ativos: avulso nulo conta como proposta", passaAtivos(ped("NOVO"), ativos()), true);
checar("Ativos: encerrado fora", passaAtivos(ped("NOVO", { encerrado: true }), ativos()), false);

// — A escolha do modelo vence a exclusao de modelo, mas nao a de status —
checar("modelo AVULSO: avulso aparece", passaAtivos(ped("NOVO", { avulso: true }), ativos("AVULSO")), true);
checar("modelo AVULSO: avulso ENTREGUE continua fora", passaAtivos(ped("ENTREGUE", { avulso: true }), ativos("AVULSO")), false);
checar("modelo AVULSO: avulso EM TRANSITO continua fora", passaAtivos(ped("EM TRANSITO", { avulso: true }), ativos("AVULSO")), false);
checar("modelo ENCERRADOS: encerrado aparece", passaAtivos(ped("NOVO", { encerrado: true }), ativos("ENCERRADOS")), true);
checar("modelo ENCERRADOS: encerrado CANCELADO continua fora", passaAtivos(ped("CANCELADO", { encerrado: true }), ativos("ENCERRADOS")), false);
checar("modelo PROPOSTA: proposta aparece", passaAtivos(ped("LIBERADO", { avulso: false }), ativos("PROPOSTA")), true);

// — Com texto na busca, Ativos nao recorta —
checar("busca: ENTREGUE entra", passaAtivos(ped("ENTREGUE"), ativos(MODELO_TODOS, true)), true);
checar("busca: avulso entra", passaAtivos(ped("NOVO", { avulso: true }), ativos(MODELO_TODOS, true)), true);
checar("busca: encerrado entra", passaAtivos(ped("NOVO", { encerrado: true }), ativos(MODELO_TODOS, true)), true);
checar("ativosValem sem busca / com busca", [ativosValem({ status: "ATIVOS", temBusca: false }), ativosValem({ status: "ATIVOS", temBusca: true })], [true, false]);

// — Outros status: a regra nao se aplica —
for (const status of [STATUS_TODOS, "ENTREGUE", "LIBERADO", "EM ARTE"]) {
  checar(`status ${status}: avulso ENTREGUE passa`, passaAtivos(ped("ENTREGUE", { avulso: true }), { status, modelo: MODELO_TODOS, temBusca: false }), true);
}

// — As condicoes do servidor saem das mesmas constantes —
const semModelo = condicoesDosAtivosParaOServidor({ modelo: undefined });
checar("servidor: status sem entregue/transito/cancel", semModelo.status, 'status_interno.is.null,and(status_interno.not.ilike.CANCEL*,status_interno.not.in.("ENTREGUE","EM TRANSITO"))');
checar("servidor: sem modelo escolhido tira avulsos", semModelo.modelo, "is_avulso.is.null,is_avulso.eq.false");
checar("servidor: modelo TODOS_MODELOS tira avulsos", condicoesDosAtivosParaOServidor({ modelo: MODELO_TODOS }).modelo, "is_avulso.is.null,is_avulso.eq.false");
for (const modelo of ["AVULSO", "PROPOSTA", "ENCERRADOS"]) {
  checar(`servidor: modelo ${modelo} escolhido nao tira modelo`, condicoesDosAtivosParaOServidor({ modelo }).modelo, null);
}
checar(
  "servidor cita cada status da regra",
  STATUS_FORA_DOS_ATIVOS.every((s) => (s.startsWith("CANCEL") ? semModelo.status.includes("CANCEL*") : semModelo.status.includes(`"${s}"`))),
  true
);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
