/**
 * Maestro: caso sem ficha (erro técnico que o manual não cita) e trava de não repetir.
 *
 *   src/features/maestro/core/agent/maestro-agent-caso-sem-ficha.ts
 *
 * NÃO TOCA EM BANCO NEM EM MODELO (o cliente do banco é falso).
 *
 * O QUE PROVA
 *   1. O caso do pedido 23181 — "duplicate key idx_boletos_n_doc_boleto_ativo"
 *      ao emitir boletos do faturado — é detectado, é sensível, e a resposta
 *      que mandava repetir o registro sai sem a sugestão e com a frase fixa.
 *      Desde 09/10/2026 (992d42c) duas fichas citam esse erro: ele não vai mais
 *      para o registro de caso sem ficha, mas a trava continua valendo, por ser
 *      erro cru de banco em assunto de dinheiro. O mesmo erro com um índice que
 *      nenhuma ficha cita vai para o registro.
 *      (A resposta usada aqui é uma reconstituição: o texto original não ficou
 *      gravado.)
 *   2. Pergunta comum, com ou sem aspas, não dispara.
 *   3. Erro que uma ficha cita não é caso sem ficha: vale o manual.
 *   4. Dado pessoal não vai para o registro.
 *   5. O limite de registros por usuário por hora é respeitado; se a contagem
 *      falhar, nada é gravado.
 *   6. A flag MAESTRO_CASO_SEM_FICHA=off desliga.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/maestro-caso-sem-ficha.test.mts
 */
import { readFileSync, readdirSync } from "node:fs";
import {
  ACAO_CASO_SEM_FICHA,
  AVISO_NAO_REPITA,
  LIMITE_DE_REGISTROS_POR_HORA,
  aplicarTravaDeNaoRepetir,
  assuntoSensivel,
  avaliarCasoSemFicha,
  casoSemFichaLigado,
  detectarErroTecnico,
  manualCitaOErro,
  mascararDadoPessoal,
  registrarCasoSemFicha,
} from "../../src/features/maestro/core/agent/maestro-agent-caso-sem-ficha.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok   " : "FALHA"} ${nome}${ok ? "" : `\n        obtido:   ${JSON.stringify(obtido)}\n        esperado: ${JSON.stringify(esperado)}`}`);
}

// O manual de verdade: as fichas publicadas, como o Maestro as lê.
const ARQUIVOS = readdirSync("docs/manual").filter((a) => a.endsWith(".md") && !a.startsWith("_") && a !== "README.md").sort();
const SLUGS = ARQUIVOS.map((a) => a.replace(/\.md$/, ""));
const MANUAL = ARQUIVOS
  .map((a) => readFileSync(`docs/manual/${a}`, "utf8"));

const PERGUNTA_SEM_FICHA = "erro duplicate key idx_boletos_indice_que_nenhuma_ficha_cita ao emitir boletos do faturado do pedido 23181";
const PERGUNTA_23181 = "erro duplicate key idx_boletos_n_doc_boleto_ativo ao emitir boletos do faturado do pedido 23181";

// ─── 1. O caso do 23181 ──────────────────────────────────────────────────────
{
  const erro = detectarErroTecnico(PERGUNTA_23181);
  checar("23181: é erro técnico de chave duplicada", erro?.tipo, "chave_duplicada");
  checar("23181: o termo procurado no manual é o nome do índice", erro?.termos, ["idx_boletos_n_doc_boleto_ativo"]);
  checar("23181: hoje há ficha que cita o índice (carteira e registro de recebíveis)", erro ? manualCitaOErro(erro, MANUAL) : null, true);
  const caso = avaliarCasoSemFicha(PERGUNTA_23181, MANUAL);
  checar("23181: com ficha, mas sensível: a trava vale e o registro não", [caso?.semFicha, caso?.sensivel, caso?.pedidos], [false, true, ["23181"]]);
  checar("a pergunta da prova (sem número de pedido) também cai na trava",
    avaliarCasoSemFicha("erro duplicate key idx_boletos_n_doc_boleto_ativo ao emitir boletos do faturado", MANUAL)?.sensivel, true);
  checar("23181: as fichas que citam o erro vão no recado ao modelo", avaliarCasoSemFicha(PERGUNTA_23181, MANUAL, SLUGS)?.fichas, ["carteira", "registro-de-recebiveis"]);
  checar("data não é mascarada", mascararDadoPessoal("vence em 04/11/2026"), "vence em 04/11/2026");
  const semFicha = avaliarCasoSemFicha(PERGUNTA_SEM_FICHA, MANUAL);
  checar("o mesmo erro com índice que nenhuma ficha cita: caso sem ficha, sensível", [semFicha?.semFicha, semFicha?.sensivel, semFicha?.pedidos], [true, true, ["23181"]]);

  const RESPOSTA =
    "Esse erro indica que já existe um boleto ativo com o mesmo número de documento.\n\n" +
    "1. Abra o pedido 23181 em Contas a Receber.\n" +
    "2. Clique em Registrar boleto novamente.\n" +
    "3. Se o erro continuar, tente de novo em alguns minutos.\n\n" +
    "Confira antes se o título aparece na lista. Depois, repita o registro do boleto.";
  const r = aplicarTravaDeNaoRepetir(RESPOSTA);
  checar("23181: as três sugestões de repetir saem", r.removidas, 3);
  checar("23181: não sobra 'novamente', 'de novo' nem 'repita o registro'", /novamente|tente de novo|repita o registro/i.test(r.texto.replace(AVISO_NAO_REPITA, "")), false);
  checar("23181: o que não manda repetir fica", [r.texto.includes("já existe um boleto ativo"), r.texto.includes("1. Abra o pedido 23181"), r.texto.includes("Confira antes se o título aparece na lista.")], [true, true, true]);
  checar("23181: termina com a frase fixa", r.texto.endsWith(AVISO_NAO_REPITA), true);
}

// ─── 2. A trava ──────────────────────────────────────────────────────────────
{
  checar("resposta sem sugestão de repetir só ganha a frase fixa",
    aplicarTravaDeNaoRepetir("Não tenho a solução deste erro."), { texto: `Não tenho a solução deste erro.\n\n${AVISO_NAO_REPITA}`, removidas: 0 });
  checar("'não repita' e 'não tente de novo' ficam: é a orientação certa",
    aplicarTravaDeNaoRepetir("Não repita o registro. Não tente emitir de novo antes do retorno.").removidas, 0);
  checar("resposta que era só 'tente de novo' vira o texto fixo",
    aplicarTravaDeNaoRepetir("Tente novamente mais tarde.").texto, `Não consegui resolver este erro. ${AVISO_NAO_REPITA}`);
  checar("a frase fixa não se repete",
    aplicarTravaDeNaoRepetir(aplicarTravaDeNaoRepetir("Aguarde.").texto).texto.split(AVISO_NAO_REPITA).length - 1, 1);
  for (const frase of ["Emita a nota novamente.", "Clique em Emitir NFS-e de novo.", "Gere o boleto outra vez.", "Faça uma nova tentativa.", "Refaça o lançamento.", "Tente registrar o boleto."]) {
    checar(`sai: ${frase}`, aplicarTravaDeNaoRepetir(frase).removidas, 1);
  }
}

// ─── 3. Pergunta comum não dispara ───────────────────────────────────────────
for (const pergunta of [
  "como emito os boletos do faturado do pedido 23181?",
  "qual a situação do 23071?",
  "quanto custam 5000 tribands para o cep 96810400?",
  'o que significa o status "Liberado" na lista de propostas?',
  "como cancelo uma NFS-e?",
  "o cliente pagou o pedido 22812?",
  "posso emitir NFS-e em produção pelo Vibe?",
]) {
  checar(`não dispara: ${pergunta}`, avaliarCasoSemFicha(pergunta, MANUAL), null);
}

// ─── 4. Outras assinaturas, e erro que a ficha cita ──────────────────────────
{
  checar("violates", detectarErroTecnico("apareceu new row violates row-level security policy for table boletos")?.tipo, "violacao");
  checar("permission denied", detectarErroTecnico("deu permission denied for table usuarios ao salvar o perfil")?.tipo, "sem_permissao");
  checar("nome de constraint solto", detectarErroTecnico("aparece pagamentos_v2_ref_key quando salvo a cobrança")?.tipo, "indice_ou_constraint");
  checar("texto de erro entre aspas", detectarErroTecnico('deu erro "Unexpected token < in JSON at position 0" ao gerar o boleto')?.tipo, "erro_entre_aspas");
  const comum = avaliarCasoSemFicha("deu permission denied for table usuarios ao salvar o perfil", MANUAL);
  checar("erro sem ficha em assunto comum: registra, sem trava", [comum?.semFicha, comum?.sensivel], [true, false]);

  const daFicha = 'apareceu o erro "Outra emissão desta mesma nota já está em andamento." na NFS-e do pedido 23083';
  checar("erro que a ficha cita é detectado como erro...", detectarErroTecnico(daFicha)?.tipo, "erro_entre_aspas");
  checar("...mas não é caso sem ficha: vale o manual", avaliarCasoSemFicha(daFicha, MANUAL), null);
  checar("assunto sensível", ["boleto", "NF-e", "nfse", "cobrança", "pagamento", "produção"].map(assuntoSensivel), [true, true, true, true, true, false]);
}

// ─── 5. Dado pessoal ─────────────────────────────────────────────────────────
{
  const sujo = 'erro "duplicate key" do cliente 123.456.789-09, cnpj 12.345.678/0001-90, fulano@empresa.com.br, (51) 99876-5432, pedido 23181';
  const limpo = mascararDadoPessoal(sujo);
  checar("CPF, CNPJ, e-mail e telefone saem; o número do pedido fica",
    [/123\.456|12\.345|fulano@|99876/.test(limpo), limpo.includes("pedido 23181")], [false, true]);
  checar("a assinatura registrada sai mascarada", /123\.456|fulano@/.test(detectarErroTecnico(sujo)?.assinatura ?? "x123.456"), false);
}

// ─── 6. Limite por usuário por hora ──────────────────────────────────────────
{
  type Gravado = { acao: string; id_int: number | null; payload: Record<string, unknown> };
  function clienteFalso(contagem: number | null, gravados: Gravado[]) {
    const consulta = {
      select: () => consulta, eq: () => consulta,
      gte: () => Promise.resolve(contagem === null ? { count: null, error: { message: "falhou" } } : { count: contagem, error: null }),
    };
    return { from: () => ({ ...consulta, insert: (linha: Gravado) => { gravados.push(linha); return Promise.resolve({ error: null }); } }) };
  }
  const caso = avaliarCasoSemFicha(PERGUNTA_SEM_FICHA, MANUAL)!;
  const antes = process.env.MAESTRO_AUDIT_DB_ENABLED;
  process.env.MAESTRO_AUDIT_DB_ENABLED = "true";
  const silencio = { info: console.info, warn: console.warn };
  console.info = () => {}; console.warn = () => {};
  const rodar = async (contagem: number | null) => {
    const gravados: Gravado[] = [];
    const desfecho = await registrarCasoSemFicha({
      supabase: clienteFalso(contagem, gravados) as never, userId: "u1", caso, paginasLidas: ["carteira"],
      resposta: "Não tenho a solução. Fale com fulano@empresa.com.br.", frasesRemovidas: 2,
    });
    return { desfecho, gravados };
  };
  const abaixo = await rodar(LIMITE_DE_REGISTROS_POR_HORA - 1);
  const noLimite = await rodar(LIMITE_DE_REGISTROS_POR_HORA);
  const semContagem = await rodar(null);
  console.info = silencio.info; console.warn = silencio.warn;
  if (antes === undefined) delete process.env.MAESTRO_AUDIT_DB_ENABLED; else process.env.MAESTRO_AUDIT_DB_ENABLED = antes;

  checar("abaixo do limite: grava uma linha caso_sem_ficha com o pedido", [abaixo.desfecho, abaixo.gravados.length, abaixo.gravados[0]?.acao, abaixo.gravados[0]?.id_int], ["registrado", 1, ACAO_CASO_SEM_FICHA, 23181]);
  const p = abaixo.gravados[0]?.payload ?? {};
  checar("o registro leva tela, pedido, tipo, assinatura, sensível e frases removidas",
    [p.tela, p.pedidos_citados, p.tipo_de_erro, String(p.assinatura_do_erro).includes("idx_boletos_indice_que_nenhuma_ficha_cita"), p.assunto_sensivel, p.frases_de_repetir_removidas],
    ["carteira", ["23181"], "chave_duplicada", true, true, 2]);
  checar("a resposta registrada sai sem o e-mail", String(p.resposta).includes("fulano@"), false);
  checar("no limite: não grava", [noLimite.desfecho, noLimite.gravados.length], ["limite_por_hora", 0]);
  checar("contagem falhou: não grava", [semContagem.desfecho, semContagem.gravados.length], ["limite_nao_conferido", 0]);
}

// ─── 7. Flag ─────────────────────────────────────────────────────────────────
{
  const antes = process.env.MAESTRO_CASO_SEM_FICHA;
  delete process.env.MAESTRO_CASO_SEM_FICHA;
  const padrao = casoSemFichaLigado();
  process.env.MAESTRO_CASO_SEM_FICHA = "off";
  const desligado = casoSemFichaLigado();
  if (antes === undefined) delete process.env.MAESTRO_CASO_SEM_FICHA; else process.env.MAESTRO_CASO_SEM_FICHA = antes;
  checar("ligado por padrão; MAESTRO_CASO_SEM_FICHA=off desliga", [padrao, desligado], [true, false]);
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
