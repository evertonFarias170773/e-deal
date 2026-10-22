/**
 * QR da etiqueta de despacho (22/10/2026): cliente DO PEDIDO 8469 -> https://www.dsegbrasil.com.br; qualquer outro, a URL de hoje.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/etiqueta-qr-lisiton.test.mts
 *
 * Sem banco (cliente Supabase falso). A decisao e `urlQrDaEtiqueta(vm.idClienteDoPedido)`, e `idClienteDoPedido` sai de
 * `propostas.id_cliente` na leitura que `montarEtiquetaViewModel` ja faz — nunca do pagador nem do destinatario impresso.
 */
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
registerHooks({
  resolve(e, c, p) {
    if (e === "@supabase/supabase-js") return { url: pathToFileURL(path.join(AQUI, "_supabase-js-falso-com-tipos.mts")).href, shortCircuit: true };
    if (e === "@/lib/supabase/client") return { url: pathToFileURL(path.join(AQUI, "_supabase-falso.mts")).href, shortCircuit: true };
    return p(e, c);
  }
});

const { falso, getSupabaseClient } = await import("./_supabase-falso.mts");
const { urlQrDaEtiqueta, ID_CLIENTE_QR_DSEG, SITE_QR_DSEG, SITE_QR_ETIQUETA } = await import("../../src/features/expedicao/lib/etiqueta-apresentacao.ts");
const { montarEtiquetaViewModel } = await import("../../src/features/expedicao/services/etiqueta-viewmodel.service.ts");
const QRCode = (await import("qrcode")).default;

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

console.log("== a funcao pura ==");
confere("a constante e 8469 e o site da Dseg e o pedido", ID_CLIENTE_QR_DSEG === 8469 && SITE_QR_DSEG === "https://www.dsegbrasil.com.br");
confere("a URL de hoje continua a mesma", SITE_QR_ETIQUETA === "https://www.ingressoideal.com.br");
confere("8469 gera a URL da Dseg", urlQrDaEtiqueta(8469) === "https://www.dsegbrasil.com.br");
confere("qualquer outro id gera a URL de hoje", [14, 980, 8468, 84690, 0, 1].every((id) => urlQrDaEtiqueta(id) === SITE_QR_ETIQUETA));
confere("nulo e indefinido geram a URL de hoje", urlQrDaEtiqueta(null) === SITE_QR_ETIQUETA && urlQrDaEtiqueta(undefined) === SITE_QR_ETIQUETA);
confere('o id como TEXTO nao conta ("8469" nao e o numero)', urlQrDaEtiqueta("8469" as unknown as number) === SITE_QR_ETIQUETA);

console.log("== pelo view model: o cliente do PEDIDO decide ==");
async function vmDoPedido(idCliente: number | null, idFaturado: number | null) {
  falso.zerar();
  falso.responderEmSequencia("propostas:select", [
    { data: { id_int: 23100, cliente: "CLIENTE", id_cliente: idCliente, id_faturado: idFaturado, empresa: "E3 BRINDES LTDA", cep: "12600000", id_endereco_ent: null, modalidade_frete: "CIF", id_transportadora_cliente: null }, error: null },
    { data: [], error: null }
  ]);
  falso.responder("expedicoes:select", { data: null, error: null });
  falso.responder("cotacao_frete:select", { data: null, error: null });
  falso.responder("notas_fiscais:select", { data: [], error: null });
  falso.responder("clientes:select", { data: { nome: "NOME", fantasia: null, documento: null, whatsapp_1: null, telefone_fixo: null, whatsapp_2: null, cidade_uf: "Lorena - SP" }, error: null });
  falso.responder("empresas:select", { data: { id: 3, razao_social: "E3", nome_fantasia: "E3 BRINDES", cnpj: "00000000000191", cep: "90000000", logradouro: "R", numero: "1", complemento: "", bairro: "B", municipio: "Porto Alegre", uf: "RS", telefone_nfe: "" }, error: null });
  const vm = await montarEtiquetaViewModel(getSupabaseClient() as never, 23100);
  const leituras = falso.chamadas.filter((c) => c.tabela === "propostas" && c.op === "select").length;
  return { vm, leituras };
}
{
  const { vm } = await vmDoPedido(8469, null);
  confere("cliente 8469: idClienteDoPedido = 8469 e o QR e o da Dseg", vm?.idClienteDoPedido === 8469 && urlQrDaEtiqueta(vm?.idClienteDoPedido) === SITE_QR_DSEG, vm?.idClienteDoPedido);
}
{
  const { vm } = await vmDoPedido(8469, 980);
  confere("cliente 8469 com PAGADOR diferente (980): o QR e o da Dseg", vm?.idClienteDoPedido === 8469 && urlQrDaEtiqueta(vm?.idClienteDoPedido) === SITE_QR_DSEG, vm?.idClienteDoPedido);
  confere("e o destinatario impresso nao e o 8469 (e o pagador), sem mudar a decisao", vm?.destinatario.idCliente === 980, vm?.destinatario.idCliente);
}
{
  const { vm } = await vmDoPedido(14, 8469);
  confere("8469 SO como pagador (cliente 14): o QR e o de hoje", vm?.idClienteDoPedido === 14 && urlQrDaEtiqueta(vm?.idClienteDoPedido) === SITE_QR_ETIQUETA, vm?.idClienteDoPedido);
  confere("mesmo com o 8469 como destinatario impresso", vm?.destinatario.idCliente === 8469, vm?.destinatario.idCliente);
}
{
  const { vm } = await vmDoPedido(null, null);
  confere("sem cliente (nulo): o QR e o de hoje", vm?.idClienteDoPedido === null && urlQrDaEtiqueta(vm?.idClienteDoPedido) === SITE_QR_ETIQUETA);
}
{
  const { vm, leituras } = await vmDoPedido(14, null);
  confere("outro cliente (14): o QR e o de hoje", urlQrDaEtiqueta(vm?.idClienteDoPedido) === SITE_QR_ETIQUETA);
  confere("nenhuma leitura de proposta a mais: duas (a da proposta e a dos pedidos do volume), como antes", leituras === 2, leituras);
}

console.log("== o desenho do QR ==");
{
  const opcoes = { margin: 0, width: 256 };
  const hoje = await QRCode.toDataURL("https://www.ingressoideal.com.br", opcoes);
  confere("outro cliente: o QR e byte a byte o de antes (mesma URL, mesmas opcoes)", (await QRCode.toDataURL(urlQrDaEtiqueta(14), opcoes)) === hoje);
  confere("8469: o QR e outro, e e o da URL da Dseg", (await QRCode.toDataURL(urlQrDaEtiqueta(8469), opcoes)) === (await QRCode.toDataURL("https://www.dsegbrasil.com.br", opcoes)) && (await QRCode.toDataURL(urlQrDaEtiqueta(8469), opcoes)) !== hoje);
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
