/**
 * "Autorizar e conferir" — a regra pura do botão novo da Análise de Faturamento.
 *   src/features/cobrancas/lib/autorizar-e-conferir.ts
 *   src/features/cobrancas/lib/confirmar-conferencia.ts
 *
 *   node --experimental-strip-types scripts/testes/autorizar-e-conferir.test.mts
 *
 * O QUE PROVA (sempre por cobrança/pedido, nunca contagem absoluta)
 *   1. Quando a ação se aplica: faturamento que espera a autorização e iria para
 *      a Fila de Conferência. Não se aplica a cobrança já autorizada (a autoria de
 *      quem autorizou não é reescrita), já confirmada, paga, cancelada, de outro
 *      tipo ou sem proposta.
 *   2. O que o UPDATE grava é EXATAMENTE a soma dos dois passos separados de hoje
 *      (autorizar_faturamento, depois a confirmação da Conferência), nos tipos que
 *      ficam A_VENCER e nos que quitam na liberação.
 *   3. A autoria sai nos dois campos (aprovado_por e confirmado_por).
 *   4. Dois cliques: uma chamada só.
 */
import {
  ACAO_AUTORIZAR_E_CONFERIR,
  montarPayloadAutorizarEConferir,
  podeAutorizarEConferir
} from "../../src/features/cobrancas/lib/autorizar-e-conferir.ts";
import {
  executarConfirmacaoDaConferencia,
  type TravaDeEnvio
} from "../../src/features/cobrancas/lib/confirmar-conferencia.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  if (!passou) falhas += 1;
  console.log(`${passou ? "ok  " : "FALHOU"} ${nome}${passou ? "" : `\n     esperado: ${JSON.stringify(esperado)}\n     real:     ${JSON.stringify(real)}`}`);
}

// ---------------------------------------------------------------- 1. QUANDO SE APLICA
console.log("== 1. quando se aplica ==");
const base = { tipo_cobranca: "E-FATURADO", status: "A_RECEBER", confirmado: false, id_int: 22000 };

ok("E-FATURADO A_RECEBER aguardando: aplica", podeAutorizarEConferir(base), true);
ok("E-FATURADO A_VENCER sem autoria: aplica", podeAutorizarEConferir({ ...base, status: "A_VENCER" }), true);
ok("E-PERMUTA (grafia com sublinhado) aplica", podeAutorizarEConferir({ ...base, tipo_cobranca: "e_permuta" }), true);
ok("E-AMOSTRA aplica", podeAutorizarEConferir({ ...base, tipo_cobranca: "E-AMOSTRA" }), true);
ok("E-RETRABALHO aplica", podeAutorizarEConferir({ ...base, tipo_cobranca: "E-RETRABALHO" }), true);
ok("FATURADO aplica", podeAutorizarEConferir({ ...base, tipo_cobranca: "FATURADO" }), true);

ok("já autorizada (aprovado_por): NÃO aplica, a autoria não é reescrita",
  podeAutorizarEConferir({ ...base, status: "A_VENCER", aprovado_por: "Marielle" }), false);
ok("já autorizada (confirmado_por herdado): NÃO aplica",
  podeAutorizarEConferir({ ...base, status: "A_VENCER", confirmado_por: "Marielle" }), false);
ok("já confirmada: NÃO aplica", podeAutorizarEConferir({ ...base, status: "A_VENCER", confirmado: true }), false);
ok("PAID: NÃO aplica", podeAutorizarEConferir({ ...base, status: "PAID" }), false);
ok("CANCELADO: NÃO aplica", podeAutorizarEConferir({ ...base, status: "CANCELADO" }), false);
ok("PIX: NÃO aplica", podeAutorizarEConferir({ ...base, tipo_cobranca: "PIX" }), false);
ok("BOLETO: NÃO aplica", podeAutorizarEConferir({ ...base, tipo_cobranca: "BOLETO" }), false);
ok("sem tipo: NÃO aplica", podeAutorizarEConferir({ ...base, tipo_cobranca: null }), false);
ok("sem proposta (id_int nulo): NÃO aplica", podeAutorizarEConferir({ ...base, id_int: null }), false);
ok("status vazio: NÃO aplica", podeAutorizarEConferir({ ...base, status: "" }), false);

// ------------------------------------------------- 2. IGUAL AOS DOIS PASSOS SEPARADOS
console.log("== 2. igual à soma dos dois passos de hoje ==");

// Espelho do que a rota grava HOJE, passo a passo (src/app/api/cobrancas/confirmar/route.ts).
type Linha = { status: string; paid_at?: string | null };
function passoAutorizacao(por: string): Record<string, unknown> {
  return { status: "A_VENCER", aprovado_por: por };
}
function passoConfirmacao(linhaAposAutorizar: Linha, por: string, agora: string, quita: boolean): Record<string, unknown> {
  const p: Record<string, unknown> = { confirmado: true, confirmado_por: por, data_confirmacao: agora };
  if (linhaAposAutorizar.status === "A_RECEBER") {
    p.status = "PAID";
  } else if (linhaAposAutorizar.status === "A_VENCER" && quita) {
    p.status = "PAID";
    p.paid_at = linhaAposAutorizar.paid_at ?? agora;
  }
  return p;
}
/** Estado final da linha depois dos dois passos separados. */
function estadoPelosDoisPassos(inicial: Linha, por: string, agora: string, quita: boolean) {
  const aut = passoAutorizacao(por);
  const aposAut = { ...inicial, ...aut } as Linha;
  const conf = passoConfirmacao(aposAut, por, agora, quita);
  return { ...inicial, ...aut, ...conf };
}
function estadoPeloBotaoNovo(inicial: Linha, por: string, agora: string, quita: boolean) {
  return { ...inicial, ...montarPayloadAutorizarEConferir(inicial, { confirmadoPor: por, agoraIso: agora, quitaNaLiberacao: quita }) };
}

const agora = "2026-10-10T15:00:00.000Z";
const casos: Array<[string, Linha, boolean]> = [
  ["E-FATURADO que estava A_RECEBER", { status: "A_RECEBER", paid_at: null }, false],
  ["E-FATURADO que estava A_VENCER sem autoria", { status: "A_VENCER", paid_at: null }, false],
  ["E-PERMUTA (quita na liberação) vinda de A_RECEBER", { status: "A_RECEBER", paid_at: null }, true],
  ["E-AMOSTRA (quita na liberação) vinda de A_VENCER", { status: "A_VENCER", paid_at: null }, true],
  ["E-RETRABALHO com paid_at já gravado", { status: "A_VENCER", paid_at: "2026-10-01T12:00:00.000Z" }, true]
];
for (const [nome, inicial, quita] of casos) {
  const aqui = estadoPeloBotaoNovo(inicial, "Marielle Fonseca", agora, quita);
  const separado = estadoPelosDoisPassos(inicial, "Marielle Fonseca", agora, quita);
  // A comparação por chave evita depender da ordem em que as chaves foram escritas.
  const chaves = Array.from(new Set([...Object.keys(aqui), ...Object.keys(separado)])).sort();
  ok(`${nome}: mesmo estado final`, chaves.map((k) => [k, (aqui as any)[k]]), chaves.map((k) => [k, (separado as any)[k]]));
}

// O que importa por pedido, dito por extenso para o E-FATURADO e para o que quita.
{
  const fat = estadoPeloBotaoNovo({ status: "A_RECEBER", paid_at: null }, "Marielle Fonseca", agora, false) as any;
  ok("E-FATURADO fica A_VENCER (quem liquida é o título)", fat.status, "A_VENCER");
  ok("E-FATURADO confirmado", fat.confirmado, true);
  ok("E-FATURADO não ganha paid_at", fat.paid_at ?? null, null);

  const perm = estadoPeloBotaoNovo({ status: "A_RECEBER", paid_at: null }, "Marielle Fonseca", agora, true) as any;
  ok("E-PERMUTA vira PAID, que é a quitação", perm.status, "PAID");
  ok("E-PERMUTA paid_at = momento da ação", perm.paid_at, agora);

  const retr = estadoPeloBotaoNovo({ status: "A_VENCER", paid_at: "2026-10-01T12:00:00.000Z" }, "Marielle Fonseca", agora, true) as any;
  ok("paid_at que já existia não é sobrescrito", retr.paid_at, "2026-10-01T12:00:00.000Z");
}

// ------------------------------------------------------------------ 3. AUTORIA
console.log("== 3. autoria ==");
{
  const p = montarPayloadAutorizarEConferir({ paid_at: null }, { confirmadoPor: "Marielle Fonseca", agoraIso: agora, quitaNaLiberacao: false });
  ok("aprovado_por e confirmado_por levam o mesmo nome", [p.aprovado_por, p.confirmado_por], ["Marielle Fonseca", "Marielle Fonseca"]);
  ok("data_confirmacao = momento da ação", p.data_confirmacao, agora);
  ok("o payload não escreve nada fora destes campos (E-FATURADO)",
    Object.keys(p).sort(), ["aprovado_por", "confirmado", "confirmado_por", "data_confirmacao", "status"]);
}
ok("o nome da ação não colide com as que existem", ACAO_AUTORIZAR_E_CONFERIR, "autorizar_e_conferir");

// -------------------------------------------------------------- 4. DOIS CLIQUES
console.log("== 4. dois cliques ==");
{
  const trava: TravaDeEnvio = { ocupada: false };
  let chamadas = 0;
  let liberar!: () => void;
  const segura = new Promise<void>((r) => { liberar = r; });
  const passos = {
    confirmar: async () => { chamadas += 1; await segura; return true; },
    aoMudarEnvio: () => {},
    aoConfirmar: () => {},
    aoFalhar: () => {},
    gravarChat: async () => {},
    registrarFalhaDoChat: () => {}
  };
  const primeiro = executarConfirmacaoDaConferencia(trava, passos);
  const segundo = await executarConfirmacaoDaConferencia(trava, passos);
  ok("segundo clique com o primeiro em curso é ignorado", segundo, "IGNORADA");
  liberar();
  ok("primeiro conclui", await primeiro, "CONFIRMADA");
  ok("a rota foi chamada uma vez", chamadas, 1);
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
