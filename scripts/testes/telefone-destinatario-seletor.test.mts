/**
 * Seletor de telefone do destinatario no despacho (22/10/2026). Caso de referencia: cliente 10330 / pedido 23808,
 * com o whatsapp_1 sem DDD (555198965) e o numero certo no telefone_fixo (5132304555) e no whatsapp_2 (5132304554).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/telefone-destinatario-seletor.test.mts
 *
 * Sem banco e sem tela: as decisoes puras do seletor e a sequencia de gravacao que o modal faz.
 * A parte renderizada (seletor bloqueado, sem seletor com um telefone so) esta em
 * telefone-destinatario-seletor-render.test.tsx.
 */
import {
  avaliarSelecaoDeTelefone,
  chaveInicialDoTelefone,
  gravarTelefoneDoDestinatario,
  mostraSeletorDeTelefone,
  opcoesDeTelefone,
  type ChaveTelefone
} from "../../src/features/expedicao/lib/telefone-edicao.ts";
import { idDestinatarioEtiquetaVigente } from "../../src/features/expedicao/lib/destinatario-etiqueta.ts";
import { telefoneDestinatario } from "../../src/features/expedicao/lib/telefone-destinatario.ts";

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

// ── o cadastro do cliente 10330
const C10330 = { whatsapp1: "555198965", telefoneFixo: "5132304555", whatsapp2: "5132304554" };
const opcoes = opcoesDeTelefone(C10330);
const porChave = (c: ChaveTelefone) => opcoes.find((o) => o.chave === c);

confere("tres telefones preenchidos: tres opcoes, na ordem WhatsApp 1, fixo, WhatsApp 2", opcoes.map((o) => o.chave).join() === "whatsapp_1,telefone_fixo,whatsapp_2", opcoes);
confere("rotulos: WhatsApp 1 / Telefone fixo comercial / WhatsApp 2", opcoes.map((o) => o.rotulo).join("|") === "WhatsApp 1|Telefone fixo comercial|WhatsApp 2");
confere('o whatsapp_1 de 9 digitos aparece marcado "sem DDD"', porChave("whatsapp_1")?.defeito === "sem DDD", porChave("whatsapp_1"));
confere("o fixo e o whatsapp_2 com DDD nao tem defeito", porChave("telefone_fixo")?.defeito === null && porChave("whatsapp_2")?.defeito === null);
confere("cada opcao mostra o numero formatado", porChave("telefone_fixo")?.exibido === "(51) 3230-4555" && porChave("whatsapp_2")?.exibido === "(51) 3230-4554", opcoes.map((o) => o.exibido));
confere("com mais de um telefone o seletor aparece", mostraSeletorDeTelefone(opcoes));

// ── comeca selecionado o que a regra unica usa hoje
const daRegra = telefoneDestinatario(C10330.whatsapp1, C10330.telefoneFixo);
confere("a regra unica usa o whatsapp_1 (o errado) e o seletor comeca nele", chaveInicialDoTelefone(opcoes, daRegra) === "whatsapp_1", { daRegra });
{
  const soFixo = opcoesDeTelefone({ whatsapp1: "", telefoneFixo: "5132304555", whatsapp2: "5132304554" });
  const regra = telefoneDestinatario("", "5132304555");
  confere("whatsapp_1 vazio: a regra cai no fixo e o seletor comeca no fixo", chaveInicialDoTelefone(soFixo, regra) === "telefone_fixo", { regra });
}
{
  const comNome = opcoesDeTelefone({ whatsapp1: "FELIPE FAUTH", telefoneFixo: "5130932840", whatsapp2: "" });
  confere("nome de pessoa no whatsapp_1 nao e telefone: nao entra, e sobra um so (sem seletor)", comNome.length === 1 && comNome[0].chave === "telefone_fixo" && !mostraSeletorDeTelefone(comNome), comNome);
}

// ── cliente com um so telefone: sem seletor
{
  const um = opcoesDeTelefone({ whatsapp1: "51995506078", telefoneFixo: "", whatsapp2: "" });
  confere("um telefone so: sem seletor", um.length === 1 && !mostraSeletorDeTelefone(um));
  confere("nenhum telefone: sem seletor e sem opcao inicial", !mostraSeletorDeTelefone(opcoesDeTelefone({ whatsapp1: "", telefoneFixo: "", whatsapp2: "" })) && chaveInicialDoTelefone([], "") === null);
  confere("sem dados do cadastro: sem seletor", opcoesDeTelefone(null).length === 0 && opcoesDeTelefone(undefined).length === 0);
}

// ── gravacao
type Chamada = { id: number; payload: Record<string, unknown> };
const falsoGravar = (resposta: { success: boolean; errorMessage?: string } = { success: true }) => {
  const chamadas: Chamada[] = [];
  return {
    chamadas,
    fn: async (id: number, payload: { whatsapp_1: string }) => {
      chamadas.push({ id, payload });
      return resposta;
    }
  };
};
const exibidoDe = (c: ChaveTelefone) => porChave(c)!.exibido;
const avalia = (exibido: string, tocado: boolean, podeEditar = true, whatsapp1 = C10330.whatsapp1) =>
  avaliarSelecaoDeTelefone({ whatsapp1, exibido, tocado, podeEditar });

// 1. selecao sem alteracao nao grava
{
  const g = falsoGravar();
  const av = avalia(exibidoDe("whatsapp_1"), false);
  const r = await gravarTelefoneDoDestinatario(av, 10330, g.fn);
  confere("abrir o modal e confirmar sem mexer: NENHUMA escrita (nem com o whatsapp_1 sem DDD)", r.ok && !r.gravou && !av.bloqueia && g.chamadas.length === 0, g.chamadas);
}
{
  // whatsapp_1 vazio, a regra usa o fixo: o numero mostrado difere do whatsapp_1 (vazio), mas o expedidor nao fez nada
  const g = falsoGravar();
  const av = avalia("(51) 3230-4555", false, true, "");
  const r = await gravarTelefoneDoDestinatario(av, 10330, g.fn);
  confere("whatsapp_1 vazio e a regra mostra o fixo: sem mexer, NAO copia o fixo para o whatsapp_1", r.ok && !r.gravou && g.chamadas.length === 0, g.chamadas);
}
{
  // escolher outro telefone cujo numero e o mesmo do whatsapp_1 atual: nada a gravar
  const g = falsoGravar();
  const av = avalia("(51) 3230-4555", true, true, "5132304555");
  const r = await gravarTelefoneDoDestinatario(av, 10330, g.fn);
  confere("escolher um telefone igual ao whatsapp_1 atual: nada a gravar", r.ok && !r.gravou && g.chamadas.length === 0, g.chamadas);
}

// 2. escolher o fixo e confirmar grava so whatsapp_1, no id certo
{
  const g = falsoGravar();
  const av = avalia(exibidoDe("telefone_fixo"), true);
  const r = await gravarTelefoneDoDestinatario(av, 10330, g.fn);
  confere(
    "escolher o fixo e confirmar: UMA escrita, id 10330, payload exatamente { whatsapp_1: 5132304555 }",
    r.ok && r.gravou && g.chamadas.length === 1 && g.chamadas[0].id === 10330 && JSON.stringify(g.chamadas[0].payload) === JSON.stringify({ whatsapp_1: "5132304555" }),
    g.chamadas
  );
  confere("o payload so tem a chave whatsapp_1", Object.keys(g.chamadas[0]?.payload ?? {}).join() === "whatsapp_1");
}
{
  const g = falsoGravar();
  const av = avalia(exibidoDe("whatsapp_2"), true);
  await gravarTelefoneDoDestinatario(av, 10330, g.fn);
  confere("escolher o whatsapp_2 e confirmar: grava em whatsapp_1 (nunca em whatsapp_2) o numero 5132304554", g.chamadas.length === 1 && JSON.stringify(g.chamadas[0].payload) === JSON.stringify({ whatsapp_1: "5132304554" }), g.chamadas);
}
{
  // escolher e depois corrigir a mao: grava o que foi digitado, ainda so em whatsapp_1
  const g = falsoGravar();
  const av = avalia("(51) 3230-4550", true);
  await gravarTelefoneDoDestinatario(av, 10330, g.fn);
  confere("escolher e editar o campo: grava o digitado, so em whatsapp_1", g.chamadas.length === 1 && JSON.stringify(g.chamadas[0].payload) === JSON.stringify({ whatsapp_1: "5132304550" }), g.chamadas);
}
{
  const g = falsoGravar();
  const av = avalia("55519897", true);
  confere('digitar outro numero sem DDD bloqueia o despacho ("sem DDD" nao e gravado)', av.bloqueia && !av.gravar, av);
  await gravarTelefoneDoDestinatario(av, 10330, g.fn);
  confere("e nao ha escrita", g.chamadas.length === 0);
}

// 3. nenhum cenario escreve em telefone_fixo, whatsapp_2 ou outro campo
{
  const g = falsoGravar();
  for (const c of ["whatsapp_1", "telefone_fixo", "whatsapp_2"] as ChaveTelefone[]) {
    await gravarTelefoneDoDestinatario(avalia(exibidoDe(c), true), 10330, g.fn);
    await gravarTelefoneDoDestinatario(avalia(exibidoDe(c), false), 10330, g.fn);
  }
  const chaves = new Set(g.chamadas.flatMap((c) => Object.keys(c.payload)));
  confere("em todas as escolhas possiveis, a unica chave escrita e whatsapp_1 (telefone_fixo e whatsapp_2 nunca recebem escrita)", [...chaves].join() === "whatsapp_1" && g.chamadas.every((c) => c.id === 10330), { chaves: [...chaves], chamadas: g.chamadas.length });
}

// 4. pagador diferente do cliente: grava no cadastro cujos telefones o seletor mostrou
{
  const CLIENTE = 14;
  const PAGADOR = 70004;
  const idDestinatario = idDestinatarioEtiquetaVigente({ despachoConfirmado: false, idClienteProposta: CLIENTE, idFaturado: PAGADOR, idGravadoNoDespacho: null });
  const g = falsoGravar();
  await gravarTelefoneDoDestinatario(avalia(exibidoDe("telefone_fixo"), true), idDestinatario, g.fn);
  confere("pagador (70004) diferente do cliente (14): a escrita do seletor vai para o PAGADOR", g.chamadas.length === 1 && g.chamadas[0].id === PAGADOR, g.chamadas);
  const escolhido = idDestinatarioEtiquetaVigente({ despachoConfirmado: true, idClienteProposta: CLIENTE, idFaturado: PAGADOR, idGravadoNoDespacho: CLIENTE });
  const g2 = falsoGravar();
  await gravarTelefoneDoDestinatario(avalia(exibidoDe("telefone_fixo"), true), escolhido, g2.fn);
  confere("destinatario escolhido = cliente (14): a escrita vai para o CLIENTE", g2.chamadas.length === 1 && g2.chamadas[0].id === CLIENTE, g2.chamadas);
}

// 5. sem cadastros.edit nunca grava nem bloqueia, qualquer que seja a escolha
{
  const g = falsoGravar();
  let bloqueou = false;
  for (const c of ["whatsapp_1", "telefone_fixo", "whatsapp_2"] as ChaveTelefone[]) {
    for (const tocado of [true, false]) {
      const av = avalia(exibidoDe(c), tocado, false);
      if (av.bloqueia) bloqueou = true;
      await gravarTelefoneDoDestinatario(av, 10330, g.fn);
    }
  }
  confere("sem cadastros.edit: nenhuma escrita e nenhum bloqueio, em nenhuma escolha", g.chamadas.length === 0 && !bloqueou, g.chamadas);
}

// 6. a falha de gravacao impede o despacho
{
  const g = falsoGravar({ success: false, errorMessage: "Erro HTTP ao gravar campos operacionais no Supabase: 401" });
  const r = await gravarTelefoneDoDestinatario(avalia(exibidoDe("telefone_fixo"), true), 10330, g.fn);
  confere("falha ao gravar o telefone escolhido: o despacho NAO segue e o erro e devolvido", !r.ok && /401/.test((r as { erro: string }).erro), r);
}

// 7. a regra unica nao foi tocada: com o whatsapp_1 corrigido, a etiqueta e a prepostagem imprimem o numero novo
{
  const antes = telefoneDestinatario("555198965", "5132304555");
  const depois = telefoneDestinatario("5132304555", "5132304555");
  confere("regra unica intocada: corrigir o whatsapp_1 troca o numero impresso", antes !== depois && depois === "(51) 3230-4555", { antes, depois });
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
