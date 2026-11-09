/**
 * Liberar para Produção com ou sem o aviso (09/11/2026): a liberação nunca depende do aviso.
 *
 *   node --experimental-strip-types scripts/testes/liberar-com-aviso.test.mts
 *
 * SEM rede e SEM banco: liberar e enviarAviso são simulados.
 *   A. Liberar sem enviar, aviso recusado pelo modo teste: libera e não chama o aviso;
 *   B. Liberar sem enviar, aviso com erro (exceção): libera e não chama o aviso;
 *   C. Liberar e enviar, aviso recusado (resposta ok:false): libera;
 *   D. Liberar e enviar, aviso lança exceção (rede): libera, erro fica no resultado;
 *   E. liberação recusada pelo servidor: não libera e não chama o aviso;
 *   F. liberação lança exceção: não libera, mensagem volta, aviso não é chamado.
 */
import assert from "node:assert/strict";
import { liberarComAviso } from "../../src/features/orcamentos/lib/liberar-com-aviso.ts";

let n = 0;
async function caso(nome: string, fn: () => Promise<void>) {
  await fn();
  n++;
  console.log(`ok - ${nome}`);
}

function servidor(resposta: { success: boolean; errorMessage?: string } | Error) {
  const chamadas = { liberar: 0 };
  const liberar = async () => {
    chamadas.liberar++;
    if (resposta instanceof Error) throw resposta;
    return resposta;
  };
  return { chamadas, liberar };
}

const RECUSA_MODO_TESTE = { ok: false, mensagem: "Modo teste: só pedidos do cliente #14 podem ser avisados." };

await caso("A. sem enviar + aviso recusado pelo modo teste", async () => {
  const s = servidor({ success: true });
  let avisoChamado = 0;
  // A janela pode ter mostrado "Envio recusado"; o Liberar sem enviar não passa o aviso.
  const avisoQueRecusaria = async () => {
    avisoChamado++;
    return RECUSA_MODO_TESTE;
  };
  void avisoQueRecusaria;
  const r = await liberarComAviso({ liberar: s.liberar });
  assert.equal(r.liberou, true);
  assert.equal(s.chamadas.liberar, 1);
  assert.equal(r.aviso, "nao_pedido");
  assert.equal(avisoChamado, 0);
});

await caso("B. sem enviar + aviso com erro", async () => {
  const s = servidor({ success: true });
  const r = await liberarComAviso({ liberar: s.liberar, enviarAviso: undefined });
  assert.equal(r.liberou, true);
  assert.equal(r.erroAviso, null);
  assert.equal(s.chamadas.liberar, 1);
});

await caso("C. com enviar + aviso recusado", async () => {
  const s = servidor({ success: true });
  let ordem: string[] = [];
  const liberar = async () => {
    ordem.push("liberar");
    return s.liberar();
  };
  const r = await liberarComAviso({
    liberar,
    enviarAviso: async () => {
      ordem.push("aviso");
      return RECUSA_MODO_TESTE;
    }
  });
  assert.equal(r.liberou, true);
  assert.deepEqual(ordem, ["liberar", "aviso"]);
  assert.equal(r.aviso, "chamado");
});

await caso("D. com enviar + aviso lança exceção (rede)", async () => {
  const s = servidor({ success: true });
  const r = await liberarComAviso({
    liberar: s.liberar,
    enviarAviso: async () => {
      throw new Error("Failed to fetch");
    }
  });
  assert.equal(r.liberou, true);
  assert.equal(r.aviso, "erro");
  assert.equal(r.erroAviso, "Failed to fetch");
  assert.equal(s.chamadas.liberar, 1);
});

await caso("E. liberação recusada pelo servidor", async () => {
  const s = servidor({ success: false, errorMessage: "Pagamento não confirmado." });
  let avisoChamado = 0;
  const r = await liberarComAviso({
    liberar: s.liberar,
    enviarAviso: async () => {
      avisoChamado++;
    }
  });
  assert.equal(r.liberou, false);
  assert.equal(r.erroLiberacao, "Pagamento não confirmado.");
  assert.equal(avisoChamado, 0);
});

await caso("F. liberação lança exceção", async () => {
  const s = servidor(new Error("Falha na comunicação com o servidor."));
  let avisoChamado = 0;
  const r = await liberarComAviso({
    liberar: s.liberar,
    enviarAviso: async () => {
      avisoChamado++;
    }
  });
  assert.equal(r.liberou, false);
  assert.equal(r.erroLiberacao, "Falha na comunicação com o servidor.");
  assert.equal(avisoChamado, 0);
});

console.log(`\n${n} casos ok`);
