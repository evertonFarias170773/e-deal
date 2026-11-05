/**
 * NFS-e, Lei 12.741: percentual do Simples por empresa e mês (05/11/2026).
 *
 *   node --experimental-strip-types --no-warnings --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/nfse-percentual-simples.test.mts
 *
 * SEM banco. O QUE PROVA
 *   1. O mês de vigência é o de Brasília: 31/10 às 23:30 de Brasília (02:30 UTC
 *      de 01/11) ainda é outubro; 01/11 às 00:10 de Brasília já é novembro.
 *   2. O financeiro digita "15,2", "15,20", "15.2" ou "15,2%" e vale 15,20; fora
 *      de 0,01 a 99,99, ou com três casas, é recusado.
 *   3. O que vai à Focus tem duas casas e ponto ("15.20"), o formato do pTotTribSN.
 *   4. Só vale o mês exato: o mês anterior cadastrado não cobre o mês atual.
 *   5. O mês digitado ("11/2026", "2026-11") vira o dia 1 que o banco guarda.
 *   6. A janela, a rota e a tela estão ligadas: aviso, Emitir travado, corpo do
 *      webhook com o percentual, cartão Empresas no hub.
 */
import { readFileSync } from "node:fs";
import {
  competenciaDaData,
  competenciaDoTexto,
  conferirPercentual,
  escolherPercentualDoMes,
  mensagemSemPercentual,
  percentualParaFocus,
  percentualParaTela,
  rotuloDaCompetencia
} from "../../src/features/nfse/lib/percentual-simples.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}${ok ? "" : `\n      obtido:   ${JSON.stringify(obtido)}\n      esperado: ${JSON.stringify(esperado)}`}`);
}

// 1. Mês de Brasília
checar("31/10 23:30 de Brasilia ainda e outubro", competenciaDaData(new Date("2026-11-01T02:30:00Z")), "2026-10-01");
checar("01/11 00:10 de Brasilia ja e novembro", competenciaDaData(new Date("2026-11-01T03:10:00Z")), "2026-11-01");
checar("05/11 meio-dia", competenciaDaData(new Date("2026-11-05T15:00:00Z")), "2026-11-01");
checar("rotulo do mes", rotuloDaCompetencia("2026-11-01"), "11/2026");

// 2. O que se digita
for (const t of ["15,2", "15,20", "15.2", "15,2%", " 15,20 "]) checar(`"${t}" vale 15,20`, conferirPercentual(t), { ok: true, valor: 15.2 });
checar("0 recusado", conferirPercentual("0").ok, false);
checar("100 recusado", conferirPercentual("100").ok, false);
checar("tres casas recusado", conferirPercentual("15,205").ok, false);
checar("vazio recusado", conferirPercentual("").ok, false);
checar("texto recusado", conferirPercentual("quinze").ok, false);
checar("0,01 aceito", conferirPercentual("0,01"), { ok: true, valor: 0.01 });
checar("99,99 aceito", conferirPercentual("99,99"), { ok: true, valor: 99.99 });

// 3. Formato da Focus
checar("15.2 -> 15.20", percentualParaFocus(15.2), "15.20");
checar("6 -> 6.00", percentualParaFocus(6), "6.00");
checar("tela: 15,20%", percentualParaTela(15.2), "15,20%");

// 4. Só o mês exato
const linhas = [
  { competencia: "2026-10-01", percentual: "15.20" },
  { competencia: "2026-11-01", percentual: 15.2 }
];
checar("novembro cadastrado", escolherPercentualDoMes(linhas, "2026-11-01"), { ok: true, competencia: "2026-11-01", percentual: 15.2 });
checar("dezembro sem linha: nao cadastrado (outubro/novembro nao cobrem)", escolherPercentualDoMes(linhas, "2026-12-01"), { ok: false, competencia: "2026-12-01", motivo: "NAO_CADASTRADO" });
checar("sem linhas: nao cadastrado", escolherPercentualDoMes([], "2026-11-01").ok, false);
checar(
  "mensagem sem percentual",
  mensagemSemPercentual("IDEAL GRAFICA", { ok: false, competencia: "2026-11-01", motivo: "NAO_CADASTRADO" }),
  "Sem percentual do Simples (Lei 12.741) cadastrado para 11/2026 na IDEAL GRAFICA. Cadastre em Configurações → Empresas antes de emitir."
);

// 5. Mês digitado
checar("11/2026", competenciaDoTexto("11/2026"), "2026-11-01");
checar("1/2027", competenciaDoTexto("1/2027"), "2027-01-01");
checar("2026-11", competenciaDoTexto("2026-11"), "2026-11-01");
checar("2026-11-01", competenciaDoTexto("2026-11-01"), "2026-11-01");
checar("13/2026 recusado", competenciaDoTexto("13/2026"), null);
checar("texto recusado", competenciaDoTexto("novembro"), null);

// 6. Ligações
const modal = readFileSync("src/features/nfse/components/GerarNfseModal.tsx", "utf8");
checar("janela: aviso do percentual", /data-aviso-percentual-simples/.test(modal) && /mensagemSemPercentual\(contexto\.empresa\.nome/.test(modal), true);
checar("janela: os dois botoes de emitir travam sem o percentual", (modal.match(/disabled=\{ocupado !== null \|\| semPercentualDoMes\}/g) ?? []).length, 2);
const rota = readFileSync("src/app/api/fiscal/emitir-nfse/route.ts", "utf8");
checar("rota: recusa antes da reserva", rota.indexOf("PERCENTUAL_SIMPLES_NAO_CADASTRADO") > 0 && rota.indexOf("PERCENTUAL_SIMPLES_NAO_CADASTRADO") < rota.indexOf("fn_reservar_emissao_nfse\", {"), true);
checar("rota: manda o percentual no corpo do webhook", /percentual_total_tributos_simples_nacional: percentualParaFocus\(percentualVigente\.percentual\)/.test(rota), true);
const contexto = readFileSync("src/features/nfse/services/nfse-pedido.server.ts", "utf8");
checar("contexto: le o percentual da empresa emissora", /lerPercentualSimplesVigente\(supabase, idEmpresa\)/.test(contexto), true);
const hub = readFileSync("src/app/(erp)/configuracoes/page.tsx", "utf8");
checar("hub: cartao Empresas habilitado para quem emite NFS-e", /href="\/configuracoes\/empresas"/.test(hub) && /podeEmpresas = .*fiscal\.emit_nfse/.test(hub), true);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
