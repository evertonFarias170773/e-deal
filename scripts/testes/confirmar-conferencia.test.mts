/**
 * Confirmação da Conferência sem esperar a recarga da lista.
 *   src/features/cobrancas/lib/confirmar-conferencia.ts
 *   src/features/cobrancas/lib/recarga-em-ordem.ts
 *
 *   node --experimental-strip-types scripts/testes/confirmar-conferencia.test.mts
 *
 * O QUE PROVA
 *   1. O modal fecha assim que a rota responde, antes de qualquer outra coisa.
 *   2. A mensagem do chat é gravada depois de fechar; se falhar, não reabre o
 *      modal nem vira erro de confirmação.
 *   3. Falha da rota mantém o modal aberto, com o erro, e nada é gravado no chat.
 *   4. Dois cliques geram uma chamada só.
 *   5. A linha atualizada sozinha não é sobrescrita por recarga que leu o banco
 *      antes dela, nem por recarga que termina fora de ordem.
 */
import { executarConfirmacaoDaConferencia, type PassosDaConfirmacao, type TravaDeEnvio } from "../../src/features/cobrancas/lib/confirmar-conferencia.ts";
import { criarControleDeRecarga, manterDadosDaRecarga } from "../../src/features/cobrancas/lib/recarga-em-ordem.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  if (!passou) falhas += 1;
  console.log(`${passou ? "ok  " : "FALHOU"} ${nome}${passou ? "" : `\n     esperado: ${JSON.stringify(esperado)}\n     real:     ${JSON.stringify(real)}`}`);
}

/** Promessa que o teste resolve na hora que quiser. */
function adiada<T>() {
  let resolver!: (valor: T) => void;
  let rejeitar!: (erro: unknown) => void;
  const promessa = new Promise<T>((res, rej) => {
    resolver = res;
    rejeitar = rej;
  });
  return { promessa, resolver, rejeitar };
}
const respiro = () => new Promise((r) => setTimeout(r, 0));

function montar(parcial: Partial<PassosDaConfirmacao> = {}) {
  const eventos: string[] = [];
  const passos: PassosDaConfirmacao = {
    confirmar: async () => {
      eventos.push("rota");
      return true;
    },
    aoMudarEnvio: (enviando) => eventos.push(enviando ? "botao desligado" : "botao religado"),
    aoConfirmar: () => eventos.push("modal fechado"),
    aoFalhar: (erro) => eventos.push(`erro mostrado: ${erro === null ? "sem sucesso" : (erro as Error)?.message ?? String(erro)}`),
    gravarChat: async () => {
      eventos.push("chat gravado");
    },
    registrarFalhaDoChat: (erro) => eventos.push(`chat falhou (log): ${(erro as Error)?.message ?? String(erro)}`),
    ...parcial
  };
  return { eventos, passos, trava: { ocupada: false } as TravaDeEnvio };
}

// ── 1. O modal fecha ao responder ───────────────────────────────────────────
{
  const rota = adiada<boolean>();
  const chat = adiada<void>();
  const t = montar({
    confirmar: () => {
      t.eventos.push("rota");
      return rota.promessa;
    },
    gravarChat: () => {
      t.eventos.push("chat iniciado");
      return chat.promessa;
    }
  });
  const execucao = executarConfirmacaoDaConferencia(t.trava, t.passos);
  await respiro();
  ok("enquanto a rota nao responde: botao desligado, modal aberto", t.eventos, ["botao desligado", "rota"]);

  rota.resolver(true);
  const desfecho = await execucao;
  ok("a rota respondeu: desfecho CONFIRMADA", desfecho, "CONFIRMADA");
  ok(
    "o modal fecha logo depois da rota, antes do chat",
    t.eventos.slice(0, 4),
    ["botao desligado", "rota", "modal fechado", "botao religado"]
  );
  ok("a execucao termina SEM esperar o chat (ele ainda nao respondeu)", t.eventos.includes("chat gravado"), false);
  await respiro();
  ok("o chat so comeca depois de o modal fechar", t.eventos.indexOf("chat iniciado") > t.eventos.indexOf("modal fechado"), true);
  chat.resolver();
}

// ── 2. Falha do chat não reabre o modal ─────────────────────────────────────
{
  const t = montar({
    gravarChat: async () => {
      throw new Error("permissao negada");
    }
  });
  const desfecho = await executarConfirmacaoDaConferencia(t.trava, t.passos);
  await respiro();
  ok("chat falhou: a confirmacao continua CONFIRMADA", desfecho, "CONFIRMADA");
  ok("chat falhou: so vai para o log", t.eventos.filter((e) => e.startsWith("chat falhou")), ["chat falhou (log): permissao negada"]);
  ok("chat falhou: nenhum erro de confirmacao mostrado", t.eventos.some((e) => e.startsWith("erro mostrado")), false);
  ok("chat falhou: o modal fechou uma vez e nao voltou", t.eventos.filter((e) => e === "modal fechado").length, 1);
}
{
  // gravarChat que lança de forma síncrona (não devolve promessa) também só vai para o log.
  const t = montar({
    gravarChat: () => {
      throw new Error("cliente indisponivel");
    }
  });
  const desfecho = await executarConfirmacaoDaConferencia(t.trava, t.passos);
  await respiro();
  ok("chat que lanca na hora: CONFIRMADA e so log", [desfecho, t.eventos.at(-1)], ["CONFIRMADA", "chat falhou (log): cliente indisponivel"]);
}

// ── 3. Falha da rota mantém o modal aberto ──────────────────────────────────
{
  const t = montar({
    confirmar: async () => {
      throw new Error("Falha ao confirmar cobrança via API.");
    }
  });
  const desfecho = await executarConfirmacaoDaConferencia(t.trava, t.passos);
  await respiro();
  ok("rota lancou erro: desfecho FALHOU", desfecho, "FALHOU");
  ok("rota lancou erro: modal NAO fechou e chat NAO foi gravado", [t.eventos.includes("modal fechado"), t.eventos.includes("chat gravado")], [false, false]);
  ok("rota lancou erro: o erro e mostrado e o botao volta", t.eventos, ["botao desligado", "erro mostrado: Falha ao confirmar cobrança via API.", "botao religado"]);
  ok("rota lancou erro: a trava solta, da para tentar de novo", t.trava.ocupada, false);
}
{
  const t = montar({ confirmar: async () => false });
  const desfecho = await executarConfirmacaoDaConferencia(t.trava, t.passos);
  ok("rota respondeu sem sucesso: FALHOU, modal aberto", [desfecho, t.eventos.includes("modal fechado")], ["FALHOU", false]);
  ok("rota respondeu sem sucesso: erro generico", t.eventos[1], "erro mostrado: sem sucesso");
}
{
  // Recusa por quitação parcial: o objeto lançado chega inteiro a quem mostra o alerta.
  let recebido: unknown = null;
  const bloqueio = { name: "ConferenciaBloqueadaError", message: "Confirmação bloqueada", situacao: { podeConfirmar: false } };
  const t = montar({
    confirmar: async () => {
      throw bloqueio;
    },
    aoFalhar: (erro) => {
      recebido = erro;
    }
  });
  await executarConfirmacaoDaConferencia(t.trava, t.passos);
  ok("quitacao parcial: a situacao chega ao alerta e o modal fica aberto", [recebido === bloqueio, t.eventos.includes("modal fechado")], [true, false]);
}

// ── 4. Clique duplo gera uma chamada ────────────────────────────────────────
{
  const rota = adiada<boolean>();
  let chamadas = 0;
  const t = montar({
    confirmar: () => {
      chamadas += 1;
      return rota.promessa;
    }
  });
  const primeiro = executarConfirmacaoDaConferencia(t.trava, t.passos);
  const segundo = executarConfirmacaoDaConferencia(t.trava, t.passos);
  const terceiro = executarConfirmacaoDaConferencia(t.trava, t.passos);
  ok("cliques repetidos sao ignorados na hora", [await segundo, await terceiro], ["IGNORADA", "IGNORADA"]);
  rota.resolver(true);
  ok("o primeiro clique confirma", await primeiro, "CONFIRMADA");
  await respiro();
  ok("tres cliques: UMA chamada a rota", chamadas, 1);
  ok("tres cliques: o modal fecha uma vez e o chat e gravado uma vez", [t.eventos.filter((e) => e === "modal fechado").length, t.eventos.filter((e) => e === "chat gravado").length], [1, 1]);
  ok("clique ignorado nao religa o botao no meio da chamada", t.eventos.filter((e) => e === "botao religado").length, 1);
}

// ── 5. Ordem das recargas ───────────────────────────────────────────────────
type Linha = { id: string; confirmado: boolean; status: string; cliente_principal_nome?: string; url_pdf?: string | null };
const antiga: Linha[] = [
  { id: "a", confirmado: false, status: "A_RECEBER" },
  { id: "b", confirmado: false, status: "A_VENCER" }
];
const nova: Linha[] = [
  { id: "a", confirmado: true, status: "PAID" },
  { id: "b", confirmado: false, status: "A_VENCER" }
];
const linhaConfirmada: Linha = { id: "a", confirmado: true, status: "PAID" };

{
  // Caso normal: linha atualizada, depois a recarga em segundo plano começa e termina.
  const c = criarControleDeRecarga<Linha>();
  c.registrarLinha(linhaConfirmada);
  const recarga = c.iniciarCarga();
  const fim = c.concluirCarga(recarga);
  ok("recarga iniciada depois da linha: e aplicada como veio do banco", [fim.aplicar, fim.sobrepor(nova)], [true, nova]);
  ok("recarga iniciada depois da linha: a linha deixa de ficar pendente", c.linhasPendentes(), 0);
}
{
  // Recarga em andamento (leu o banco ANTES da confirmação) termina depois da linha atualizada.
  const c = criarControleDeRecarga<Linha>();
  const emAndamento = c.iniciarCarga();
  c.registrarLinha(linhaConfirmada);
  const fim = c.concluirCarga(emAndamento);
  ok("recarga antiga termina depois: a linha confirmada NAO volta para o dado velho", fim.sobrepor(antiga), [linhaConfirmada, antiga[1]]);
  ok("recarga antiga termina depois: as outras linhas vem da recarga", fim.sobrepor(antiga)[1] === antiga[1], true);
  ok("a linha segue protegida ate uma recarga mais nova", c.linhasPendentes(), 1);
}
{
  // Fora de ordem: a recarga em segundo plano (nova) chega ANTES da antiga.
  const c = criarControleDeRecarga<Linha>();
  const velha = c.iniciarCarga();
  c.registrarLinha(linhaConfirmada);
  const segundoPlano = c.iniciarCarga();

  const fimNova = c.concluirCarga(segundoPlano);
  ok("fora de ordem: a recarga nova e aplicada", [fimNova.aplicar, fimNova.sobrepor(nova)], [true, nova]);
  const fimVelha = c.concluirCarga(velha);
  ok("fora de ordem: a recarga velha, que chega por ultimo, e DESCARTADA", fimVelha.aplicar, false);
}
{
  // Em ordem: a velha chega primeiro (com a linha por cima), a nova depois.
  const c = criarControleDeRecarga<Linha>();
  const velha = c.iniciarCarga();
  c.registrarLinha(linhaConfirmada);
  const segundoPlano = c.iniciarCarga();

  const fimVelha = c.concluirCarga(velha);
  ok("em ordem: a velha e aplicada com a linha confirmada por cima", fimVelha.sobrepor(antiga)[0], linhaConfirmada);
  const fimNova = c.concluirCarga(segundoPlano);
  ok("em ordem: a nova e aplicada como veio do banco", [fimNova.aplicar, fimNova.sobrepor(nova), c.linhasPendentes()], [true, nova, 0]);
}
{
  // Duas confirmações seguidas, cada uma com a sua recarga.
  const c = criarControleDeRecarga<Linha>();
  const linhaB: Linha = { id: "b", confirmado: true, status: "A_VENCER" };
  c.registrarLinha(linhaConfirmada);
  const recargaDaA = c.iniciarCarga();
  c.registrarLinha(linhaB);
  const recargaDaB = c.iniciarCarga();

  // A recarga da A leu o banco antes de a B ser confirmada.
  const fimA = c.concluirCarga(recargaDaA);
  ok("duas confirmacoes: a recarga da 1a nao desfaz a 2a", fimA.sobrepor(nova), [nova[0], linhaB]);
  const fimB = c.concluirCarga(recargaDaB);
  ok("duas confirmacoes: a recarga da 2a encerra tudo", [fimB.aplicar, c.linhasPendentes()], [true, 0]);
}
{
  // Linha fora do conjunto que a recarga trouxe (filtro da tela) não é acrescentada.
  const c = criarControleDeRecarga<Linha>();
  const emAndamento = c.iniciarCarga();
  c.registrarLinha({ id: "z", confirmado: true, status: "PAID" });
  ok("linha fora do filtro da recarga nao e acrescentada a lista", c.concluirCarga(emAndamento).sobrepor(antiga), antiga);
}
{
  // Sem nenhuma linha atualizada, a recarga devolve a MESMA lista (sem cópia).
  const c = criarControleDeRecarga<Linha>();
  const fim = c.concluirCarga(c.iniciarCarga());
  ok("sem linha atualizada: a lista da recarga passa intacta", fim.sobrepor(antiga) === antiga, true);
}

// ── 6. A linha relida mantém o que só a recarga completa sabe ───────────────
{
  const anterior: Linha = { id: "a", confirmado: false, status: "A_RECEBER", cliente_principal_nome: "PRINCIPAL", url_pdf: "https://exemplo.invalid/boleto.pdf" };
  const relida: Linha = { id: "a", confirmado: true, status: "PAID", url_pdf: null };
  const linha = manterDadosDaRecarga(relida, anterior, ["cliente_principal_nome", "url_pdf"]);
  ok("a linha muda na hora: status e confirmado vem da releitura", [linha.status, linha.confirmado], ["PAID", true]);
  ok("a linha mantem o cliente principal e o PDF que ja tinha", [linha.cliente_principal_nome, linha.url_pdf], ["PRINCIPAL", "https://exemplo.invalid/boleto.pdf"]);
  ok("campo fora da lista nao e copiado do anterior", manterDadosDaRecarga(relida, anterior, ["url_pdf"]).cliente_principal_nome, undefined);
  ok("sem linha anterior: fica a relida", manterDadosDaRecarga(relida, undefined, ["url_pdf"]), relida);
  ok("anterior vazio nao apaga o que a releitura trouxe", manterDadosDaRecarga({ ...relida, url_pdf: "novo" }, { ...anterior, url_pdf: "" }, ["url_pdf"]).url_pdf, "novo");
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
if (falhas > 0) process.exitCode = 1;
