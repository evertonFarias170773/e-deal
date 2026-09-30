/**
 * O desfecho da emissão lido pela tela — a recusa da Focus no envio.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/desfecho-focus.test.mts
 *
 * Até 30/09/2026 a resposta de erro da emissão caía em INDETERMINADO, a tela
 * consultava a Focus, a consulta voltava "não encontrada" e o motivo real
 * sumia: a NFE-22849-001 apareceu como "Código Sefaz 900 — Nota fiscal não
 * encontrada" quando a Focus tinha recusado o município do destinatário.
 */
const { lerDesfechoDaFocus } = await import("../../src/features/fiscal/services/desfecho-focus.ts");

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `  — esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(real)}`}`);
}

const MOTIVO = "Erro de validação (Município do destinatário inválido: Nome: Santana Do Livramento - UF: RS)";

// O corpo de "Retorna USER ERRO" no n8n, com os valores da NFE-22849-001.
const respostaDeErro = (erroMensagem: string) => ({
  ok: false,
  ref: "NFE-22849-001",
  enviada_focus: false,
  processando: false,
  autorizada: false,
  rejeitada: false,
  sucesso_emissao: false,
  tem_arquivos: false,
  status: "ERRO_ENVIO",
  status_focus: null,
  status_sefaz: null,
  erro_codigo: 422,
  erro_mensagem: erroMensagem,
  mensagem: "A NF-e não foi aceita pela Focus.",
  detalhe_tecnico: erroMensagem,
  url_danfe: null,
  url_xml: null
});

checar("recusa no envio, com o motivo da Focus (n8n corrigido)",
  lerDesfechoDaFocus(respostaDeErro(MOTIVO)),
  { tipo: "RECUSADO_NA_FOCUS", codigo: "422", mensagem: MOTIVO });

checar("recusa no envio, com o n8n antigo: ainda recusa, sem consultar",
  lerDesfechoDaFocus(respostaDeErro("Unprocessable Content")).tipo,
  "RECUSADO_NA_FOCUS");

checar("recusa sem mensagem nenhuma: texto padrão",
  lerDesfechoDaFocus({ ...respostaDeErro(""), detalhe_tecnico: "", mensagem: "" }),
  { tipo: "RECUSADO_NA_FOCUS", codigo: "422", mensagem: "A Focus recusou a nota e não detalhou o motivo." });

// A resposta da CONSULTA ("Respond to Webhook1") para uma linha em ERRO_ENVIO
// preservada: ok true. Com status_sefaz de uma tentativa ANTERIOR, não pode
// virar rejeição da SEFAZ — quem decide é o banco.
checar("consulta de ERRO_ENVIO com status_sefaz velho: indeterminado (decide o banco)",
  lerDesfechoDaFocus({ ok: true, ref: "X", status: "ERRO_ENVIO", status_focus: null, status_sefaz: "778", mensagem_sefaz: "Rejeicao: NCM inexistente", autorizada: false, processando: false, rejeitada: false }),
  { tipo: "INDETERMINADO" });

checar("consulta que devolve NAO_ENCONTRADA_FOCUS: continua indeterminado",
  lerDesfechoDaFocus({ ok: true, ref: "X", status: "NAO_ENCONTRADA_FOCUS", status_sefaz: null, mensagem_sefaz: "Nota fiscal não encontrada" }),
  { tipo: "INDETERMINADO" });

// O que já funcionava continua igual.
checar("rejeição da SEFAZ dentro de retorno_focus.data (NFE-20872-001)",
  lerDesfechoDaFocus({ status_code: 201, envio_focus_ok: true, retorno_focus: { data: JSON.stringify({ status: "erro_autorizacao", status_sefaz: "732", mensagem_sefaz: "Rejeicao 732" }) } }),
  { tipo: "REJEITADO", status: "erro_autorizacao", codigo: "732", mensagem: "Rejeicao 732" });

checar("autorização dentro de retorno_focus.data",
  lerDesfechoDaFocus({ envio_focus_ok: true, retorno_focus: { data: JSON.stringify({ status: "autorizado", status_sefaz: "100", chave_nfe: "43", numero: "1", serie: "2", protocolo: "9", caminho_danfe: "/d.pdf" }) } }).tipo,
  "AUTORIZADO");

checar("processando", lerDesfechoDaFocus({ retorno_focus: { data: JSON.stringify({ status: "processando_autorizacao" }) } }).tipo, "PROCESSANDO");
checar("corpo vazio", lerDesfechoDaFocus(null), { tipo: "INDETERMINADO" });

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
