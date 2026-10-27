/**
 * Carta de Correção: leitura da resposta do webhook do n8n como texto (27/10/2026).
 * Fora de JSON a rota passa a dizer o status HTTP; JSON segue igual para o parseFocusResponse.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/carta-correcao-resposta.test.mts
 *
 * Nada vai ao banco, ao n8n nem à Focus.
 */
import { readFileSync } from "node:fs";
import { lerRespostaDaIntegracao, parseFocusResponse } from "../../src/lib/fiscal/carta-correcao.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}${ok ? "" : `\n      esperado ${JSON.stringify(esperado)}\n      veio     ${JSON.stringify(real)}`}`);
}

// ---------- fora de JSON: recusa com o status
checar("403 texto puro (credencial do webhook)", lerRespostaDaIntegracao(403, "Authorization data is wrong!"), {
  ok: false,
  code: "RESPOSTA_INVALIDA",
  message: "A integração fiscal recusou a chamada (HTTP 403). Nenhuma carta foi enviada."
});
checar("500 com HTML", lerRespostaDaIntegracao(500, "<!DOCTYPE html><html><body>Internal Server Error</body></html>"), {
  ok: false,
  code: "RESPOSTA_INVALIDA",
  message: "A integração fiscal recusou a chamada (HTTP 500). Nenhuma carta foi enviada."
});
checar("404 texto puro", lerRespostaDaIntegracao(404, "Not Found").ok === false && (lerRespostaDaIntegracao(404, "Not Found") as { message: string }).message.includes("(HTTP 404)"), true);
checar("corpo vazio com 500", (lerRespostaDaIntegracao(500, "") as { code: string }).code, "RESPOSTA_INVALIDA");

// ---------- fora de JSON onde a carta PODE ter saído: nao afirma nada
for (const status of [200, 502, 503, 504]) {
  const r = lerRespostaDaIntegracao(status, status === 200 ? "" : "<html>Gateway Timeout</html>") as { ok: boolean; code: string; message: string };
  checar(`${status} fora de JSON: nao confirmada`, [r.ok, r.code, r.message.includes(`(HTTP ${status})`), r.message.includes("Nenhuma carta foi enviada")], [false, "RESPOSTA_NAO_CONFIRMADA", true, false]);
}

// ---------- JSON: segue igual ao caminho normal
const respostaNormal = [{ statusCode: 200, body: { status: "autorizado", status_sefaz: "135", numero_carta_correcao: 1 } }];
const lida = lerRespostaDaIntegracao(200, JSON.stringify(respostaNormal));
checar("JSON valido devolve o objeto intacto", lida, { ok: true, data: respostaNormal });
checar("parseFocusResponse igual sobre o JSON lido", parseFocusResponse((lida as { data: unknown }).data), { success: true, message: "Operação realizada com sucesso." });
const rejeicao = { erro: { mensagem: "Rejeicao: texto invalido" } };
checar("JSON de erro com 400 segue para o caminho de antes", lerRespostaDaIntegracao(400, JSON.stringify(rejeicao)), { ok: true, data: rejeicao });

// ---------- estrutura: a rota usa a leitura nova e nao chama mais response.json()
const rota = readFileSync(new URL("../../src/app/api/fiscal/carta-correcao/route.ts", import.meta.url), "utf8");
checar("rota: le texto e usa lerRespostaDaIntegracao; sem response.json()", [
  rota.includes("const leitura = lerRespostaDaIntegracao(response.status, texto);"),
  rota.includes("response.json()"),
  rota.includes("A resposta da API de Carta de Correção não é um JSON válido.")
], [true, false, false]);
checar("rota: parseFocusResponse e o evento seguem no mesmo lugar", [rota.includes("const interpretado = parseFocusResponse(data);"), rota.includes("montarEventoCartaCorrecao({")], [true, true]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
