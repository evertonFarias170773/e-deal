/**
 * Telefone do destinatario editavel no despacho (21/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/telefone-destinatario-edicao.test.mts
 *
 * Sem banco e sem tela: as decisoes puras e a sequencia de gravacao.
 */
import { avaliarTelefoneEditado, gravarTelefoneDoDestinatario } from "../../src/features/expedicao/lib/telefone-edicao.ts";
import { idDestinatarioEtiquetaVigente } from "../../src/features/expedicao/lib/destinatario-etiqueta.ts";
import { telefoneDestinatario } from "../../src/features/expedicao/lib/telefone-destinatario.ts";

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

const ORIGINAL = "(51) 3093-2840"; // o que o modal mostrou do cadastro

// ── validacao: so digitos, com DDD, minimo 10
const v = (editado: string, podeEditar = true) => avaliarTelefoneEditado({ original: ORIGINAL, editado, podeEditar });
confere("celular com DDD valido (11 digitos): grava, normalizado so digitos", v("(51) 99550-6078").gravar && v("(51) 99550-6078").normalizado === "51995506078");
confere("fixo com DDD valido (10 digitos): grava", v("5130932841").gravar && v("5130932841").normalizado === "5130932841");
confere("sem DDD (8 digitos) bloqueia, com mensagem", v("30932840").bloqueia && Boolean(v("30932840").erro) && !v("30932840").gravar, v("30932840"));
confere("9 digitos bloqueia", v("995506078").bloqueia);
confere("DDD inexistente bloqueia", v("0030932840").bloqueia || v("1030932840").bloqueia);
confere("celular de 11 digitos sem o 9 bloqueia", v("51895506078").bloqueia);
confere("letras sem numero bloqueiam", v("sem telefone").bloqueia);
confere("o erro explica o motivo", /dígito|DDD/.test(String(v("3093284").erro)), v("3093284").erro);

// ── sem alteracao: nada a gravar
confere("igual ao do cadastro: sem alteracao, sem gravar", !v("(51) 3093-2840").alterado && !v("(51) 3093-2840").gravar && !v("(51) 3093-2840").bloqueia);
confere("mesmos digitos sem mascara: sem alteracao", !v("5130932840").alterado && !v("5130932840").gravar);
confere("campo vazio: nao apaga telefone, nao bloqueia", !v("").gravar && !v("").bloqueia && !v("   ").gravar);
confere("so mexeu na formatacao: sem alteracao", !v("51 3093 2840").gravar);

// ── quem nao tem cadastros.edit: ve, nao edita, despacho segue
const sem = v("5130932841", false);
confere("sem cadastros.edit: nunca grava, nunca bloqueia", !sem.gravar && !sem.bloqueia);
confere("sem cadastros.edit, ate com lixo digitado: nao bloqueia o despacho", !v("abc", false).bloqueia && !v("abc", false).gravar);

// ── gravacao: sem edicao nao ha escrita; com edicao ha UMA, no cadastro certo
type Chamada = { id: number; payload: unknown };
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
{
  const g = falsoGravar();
  const r = await gravarTelefoneDoDestinatario(v("(51) 3093-2840"), 70004, g.fn);
  confere("sem edicao: NENHUMA escrita no cadastro", r.ok && !r.gravou && g.chamadas.length === 0, g.chamadas);
}
{
  const g = falsoGravar();
  const r = await gravarTelefoneDoDestinatario(v("(51) 99550-6078"), 70004, g.fn);
  confere(
    "com edicao: UMA escrita, com o id do destinatario e so whatsapp_1 normalizado",
    r.ok && r.gravou && g.chamadas.length === 1 && g.chamadas[0].id === 70004 && JSON.stringify(g.chamadas[0].payload) === JSON.stringify({ whatsapp_1: "51995506078" }),
    g.chamadas
  );
}
{
  const g = falsoGravar();
  const r = await gravarTelefoneDoDestinatario(sem, 70004, g.fn);
  confere("sem cadastros.edit, mesmo com texto digitado: nenhuma escrita", r.ok && g.chamadas.length === 0);
}
{
  const g = falsoGravar();
  const r = await gravarTelefoneDoDestinatario(v("abc123"), 70004, g.fn);
  confere("telefone invalido: nenhuma escrita", g.chamadas.length === 0 && r.ok && !r.gravou);
}

// ── o id certo: pagador diferente do cliente
const CLIENTE = 14;
const PAGADOR = 70004;
confere(
  "pagador distinto, sem escolha gravada: o destinatario (e o cadastro que recebe) e o PAGADOR",
  idDestinatarioEtiquetaVigente({ despachoConfirmado: false, idClienteProposta: CLIENTE, idFaturado: PAGADOR, idGravadoNoDespacho: null }) === PAGADOR
);
confere(
  "pagador distinto, escolha gravada = cliente: o CLIENTE",
  idDestinatarioEtiquetaVigente({ despachoConfirmado: true, idClienteProposta: CLIENTE, idFaturado: PAGADOR, idGravadoNoDespacho: CLIENTE }) === CLIENTE
);
confere(
  "sem pagador distinto: o cliente (caso comum)",
  idDestinatarioEtiquetaVigente({ despachoConfirmado: false, idClienteProposta: CLIENTE, idFaturado: null, idGravadoNoDespacho: null }) === CLIENTE &&
    idDestinatarioEtiquetaVigente({ despachoConfirmado: false, idClienteProposta: CLIENTE, idFaturado: CLIENTE, idGravadoNoDespacho: null }) === CLIENTE
);
confere(
  "escolha gravada de um id que nao e nem cliente nem pagador: cai no cliente (nunca grava em cadastro alheio)",
  idDestinatarioEtiquetaVigente({ despachoConfirmado: true, idClienteProposta: CLIENTE, idFaturado: PAGADOR, idGravadoNoDespacho: 99999 }) === CLIENTE
);
{
  // pagador diferente do cliente: a escrita vai para o PAGADOR, nao para o cliente do pedido
  const idDestinatario = idDestinatarioEtiquetaVigente({ despachoConfirmado: false, idClienteProposta: CLIENTE, idFaturado: PAGADOR, idGravadoNoDespacho: null });
  const g = falsoGravar();
  await gravarTelefoneDoDestinatario(v("(51) 99550-6078"), idDestinatario, g.fn);
  confere(
    "pagador diferente do cliente: a unica escrita e no cadastro do PAGADOR (70004), nunca no cliente (14)",
    g.chamadas.length === 1 && g.chamadas[0].id === PAGADOR && g.chamadas[0].id !== CLIENTE,
    g.chamadas
  );
}

// ── a falha na gravacao impede o despacho
{
  let despachou = 0;
  const g = falsoGravar({ success: false, errorMessage: "Erro HTTP ao gravar campos operacionais no Supabase: 401" });
  // Mesma ordem do modal: grava o telefone; se falhar, NAO despacha.
  const r = await gravarTelefoneDoDestinatario(v("(51) 99550-6078"), PAGADOR, g.fn);
  if (r.ok) despachou++;
  confere("gravacao do cadastro falha: o despacho NAO acontece e o erro e devolvido", !r.ok && despachou === 0 && /401/.test((r as { erro: string }).erro), r);
  const r2 = await gravarTelefoneDoDestinatario(v("(51) 99550-6078"), null, g.fn);
  confere("sem id de destinatario: nao grava e nao despacha", !r2.ok);
}
{
  let despachou = 0;
  const g = falsoGravar();
  const r = await gravarTelefoneDoDestinatario(v("(51) 99550-6078"), PAGADOR, g.fn);
  if (r.ok) despachou++;
  confere("gravacao ok: o despacho segue", r.ok && despachou === 1);
}

// ── o numero novo vale na etiqueta e na prepostagem: a MESMA regra unica, lendo o cadastro com whatsapp_1 novo
{
  const antes = telefoneDestinatario("Felipe Fauth", "5130932840");
  const depois = telefoneDestinatario("51995506078", "5130932840"); // whatsapp_1 novo vence o fixo
  confere("regra unica: whatsapp_1 corrigido passa a ser o numero impresso", antes === "(51) 3093-2840" && depois === "(51) 99550-6078", { antes, depois });
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
