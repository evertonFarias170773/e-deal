/**
 * "Autorizar e conferir" — o diagnóstico de falha (14/10/2026).
 *   src/features/cobrancas/lib/autorizar-e-conferir.ts
 *
 *   node --experimental-strip-types scripts/testes/autorizar-e-conferir-falha.test.mts
 *
 * O QUE PROVA
 *   1. Erro FORÇADO no módulo (o do 23681, "column pagamentos_v2.confirmado does
 *      not exist") sai com ETAPA, código, detalhes e dica — e diz se a gravação
 *      já tinha valido.
 *   2. O que sai é limpo: sem e-mail, CPF/CNPJ, token, chave nem a linha que o
 *      banco cita; e aparado.
 *   3. Fora da ação combinada a resposta de falha é EXATAMENTE a de antes
 *      ({ success: false, error: err.message }, 500): "Confirmar Conferência" e
 *      "Confirmar Autorização" seguem iguais.
 *   4. A tela só ganha o texto longo quando a resposta traz etapa.
 */
import {
  DESCRICAO_DA_ETAPA,
  diagnosticarFalha,
  limparTextoDeDiagnostico,
  mensagemDeFalhaParaATela,
  respostaDeFalhaDaRota,
  type EtapaDaFalha
} from "../../src/features/cobrancas/lib/autorizar-e-conferir.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  if (!passou) falhas += 1;
  console.log(`${passou ? "ok  " : "FALHOU"} ${nome}${passou ? "" : `\n     esperado: ${JSON.stringify(esperado)}\n     real:     ${JSON.stringify(real)}`}`);
}

// Erro no formato que o PostgREST devolve (PostgrestError).
const erroDoBanco = {
  message: "column pagamentos_v2.confirmado does not exist",
  code: "42703",
  details: null,
  hint: "Perhaps you meant to reference the column \"pagamentos_v2.confirmado_por\"."
};

// ------------------------------------------------- 1. ERRO FORÇADO MOSTRA A ETAPA
console.log("== 1. erro forçado mostra a etapa ==");
{
  const r = respostaDeFalhaDaRota(true, erroDoBanco, "GRAVACAO_AUTORIZACAO_E_CONFERENCIA");
  const c = r.corpo as any;
  ok("status 500", r.status, 500);
  ok("success false", c.success, false);
  ok("etapa", c.etapa, "GRAVACAO_AUTORIZACAO_E_CONFERENCIA");
  ok("descrição da etapa", c.etapa_descricao, DESCRICAO_DA_ETAPA.GRAVACAO_AUTORIZACAO_E_CONFERENCIA);
  ok("código do banco", c.code, "42703");
  ok("mensagem do banco", c.error, "column pagamentos_v2.confirmado does not exist");
  ok("dica do banco", c.hint, "Perhaps you meant to reference the column \"pagamentos_v2.confirmado_por\".");
  ok("detalhes nulos ficam nulos", c.details, null);
  ok("gravação não valeu", c.gravada, false);
}
{
  const etapas: EtapaDaFalha[] = [
    "LEITURA_DA_COBRANCA", "TRAVA_DE_QUITACAO", "GRAVACAO_AUTORIZACAO_E_CONFERENCIA",
    "RELEITURA_APOS_CORRIDA", "POS_GRAVACAO_RECONCILIACAO"
  ];
  for (const etapa of etapas) {
    const d = diagnosticarFalha(new Error("boom"), etapa);
    ok(`etapa ${etapa}: gravada só depois do UPDATE`, [d.etapa, d.gravada], [etapa, etapa === "POS_GRAVACAO_RECONCILIACAO"]);
  }
  const d = diagnosticarFalha(new Error("rpc caiu"), "POS_GRAVACAO_RECONCILIACAO");
  ok("falha depois do UPDATE avisa que valeu",
    mensagemDeFalhaParaATela(d).includes("A gravação já tinha valido"), true);
}

// ---------------------------------------------------------- 2. O QUE SAI É LIMPO
console.log("== 2. o que sai é limpo ==");
{
  const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz";
  const sujo = {
    message: `falhou para joao.silva@empresa.com.br com Bearer ${jwt} e chave ${jwt}`,
    code: "23505",
    details: "Key (id)=(16080372-0457-489f-a9a5-eceee0060a64) ja existe. CPF 123.456.789-09 e CNPJ 12.345.678/0001-95, tel 51999998888. Failing row contains (a, b, c, d, nome Fulano de Tal, 123).",
    hint: "x".repeat(500)
  };
  const d = diagnosticarFalha(sujo, "GRAVACAO_AUTORIZACAO_E_CONFERENCIA");
  const tudo = JSON.stringify(d);
  ok("sem e-mail", /@/.test(tudo), false);
  ok("sem token (eyJ...)", tudo.includes("eyJ"), false);
  ok("sem Bearer com valor", /Bearer\s+eyJ/.test(tudo), false);
  ok("sem CPF", tudo.includes("123.456.789-09"), false);
  ok("sem CNPJ", tudo.includes("12.345.678/0001-95"), false);
  ok("sem telefone/número longo", tudo.includes("51999998888"), false);
  ok("sem o uuid citado no detalhe", tudo.includes("16080372-0457-489f"), false);
  ok("sem a linha do banco", tudo.includes("Fulano"), false);
  ok("o código fica", d.code, "23505");
  ok("a dica é aparada em 300", (d.hint ?? "").length <= 300, true);
}
ok("código fora do padrão vira nulo", diagnosticarFalha({ message: "x", code: "<script>" }, "LEITURA_DA_COBRANCA").code, null);
ok("sem mensagem: texto padrão", diagnosticarFalha({}, "LEITURA_DA_COBRANCA").error, "Falha ao autorizar e conferir.");
ok("erro nulo não quebra", diagnosticarFalha(null, "LEITURA_DA_COBRANCA").error, "Falha ao autorizar e conferir.");
ok("texto de erro puro (string lançada)", diagnosticarFalha("deu ruim", "LEITURA_DA_COBRANCA").error, "deu ruim");
ok("vazio vira nulo", limparTextoDeDiagnostico("   "), null);
ok("o nome de uma coluna não é cortado", limparTextoDeDiagnostico("column pagamentos_v2.confirmado does not exist"), "column pagamentos_v2.confirmado does not exist");

// ------------------------------------- 3. FORA DA AÇÃO COMBINADA NADA MUDA
console.log("== 3. fora da ação combinada a resposta é a de antes ==");
{
  const r = respostaDeFalhaDaRota(false, new Error("Falha qualquer"), "GRAVACAO_AUTORIZACAO_E_CONFERENCIA");
  ok("Confirmar Conferência / Autorização: mesmo corpo e status",
    r, { status: 500, corpo: { success: false, error: "Falha qualquer" } });
  const r2 = respostaDeFalhaDaRota(false, erroDoBanco, "POS_GRAVACAO_RECONCILIACAO");
  ok("o erro do banco também sai só com a mensagem (sem etapa, código ou dica)",
    r2, { status: 500, corpo: { success: false, error: "column pagamentos_v2.confirmado does not exist" } });
  ok("o corpo não ganha chave nova", Object.keys(r2.corpo).sort(), ["error", "success"]);
}

// --------------------------------------------------------- 4. TEXTO DA TELA
console.log("== 4. texto da tela ==");
{
  ok("resposta sem etapa: só a mensagem, como antes",
    mensagemDeFalhaParaATela({ error: "Sem permissão para confirmar cobrança." }), "Sem permissão para confirmar cobrança.");
  const t = mensagemDeFalhaParaATela(diagnosticarFalha(erroDoBanco, "GRAVACAO_AUTORIZACAO_E_CONFERENCIA"));
  ok("com etapa: traz a mensagem", t.startsWith("column pagamentos_v2.confirmado does not exist ("), true);
  ok("com etapa: traz a etapa", t.includes("Etapa: gravação da autorização e da conferência (um UPDATE só)"), true);
  ok("com etapa: traz o código", t.includes("código 42703"), true);
  ok("com etapa: traz a dica", t.includes("dica: Perhaps you meant"), true);
  ok("gravação não valeu: sem o aviso", t.includes("A gravação já tinha valido"), false);
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
