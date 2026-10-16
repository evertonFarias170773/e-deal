/**
 * CONHECIMENTO DA TRANSPORTADORA x CODIGO DE RASTREIO DOS CORREIOS.
 *
 * Os dois moram em `expedicoes.codigo_rastreamento` (decisao de 15/10/2026: sem coluna
 * nova). O que diferencia e o DESPACHO (`expedicoes.tipo_frete`), nunca a cotacao:
 *   CORREIOS ........... e codigo de rastreio; rastreavel; tudo como sempre foi.
 *   TRANSPORTADORA/MOTOBOY  e "Conhecimento"; nunca vai para a consulta dos Correios.
 * Aqui ficam as regras puras, usadas pela tela, pela lista de Pedidos e pelo Maestro.
 */

/** Formato oficial do objeto dos Correios (AD823485091BR). */
export function pareceObjetoCorreios(codigo: string | null | undefined): boolean {
  return /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(String(codigo ?? "").trim().toUpperCase());
}

export type DespachoDoCodigo = {
  /** `expedicoes.tipo_frete` (o despacho), ja normalizado. */
  tipoFrete: string | null | undefined;
  correiosIdPrepostagem?: string | null;
  correiosCodigoObjeto?: string | null;
  /** O codigo gravado, so para o legado sem despacho registrado. */
  codigo?: string | null;
};

/**
 * O despacho e dos Correios? So entao o codigo e rastreado.
 * Prepostagem/objeto gravado e Correios por definicao. Sem tipo de despacho registrado
 * (pedido anterior a tabela `expedicoes`, so com o espelho na OS) vale o formato oficial.
 * Tipo registrado como TRANSPORTADORA/MOTOBOY/outro nunca e Correios, mesmo que o numero
 * digitado se pareca com um objeto.
 */
export function despachoEhCorreios(d: DespachoDoCodigo): boolean {
  const tipo = String(d.tipoFrete ?? "").trim().toUpperCase();
  if (tipo === "CORREIOS") return true;
  if (String(d.correiosIdPrepostagem ?? "").trim() || String(d.correiosCodigoObjeto ?? "").trim()) return true;
  if (!tipo || tipo === "INDEFINIDO") return pareceObjetoCorreios(d.codigo);
  return false;
}

/**
 * "Ver conhecimento" nos menus de Acoes: so despacho TRANSPORTADORA ou MOTOBOY com o campo
 * preenchido, e nunca quando a regra do despacho diz Correios (ai o item e "Rastrear objeto").
 * Os dois menus (cards da Expedicao e lista de Pedidos) usam esta mesma funcao.
 */
export function podeVerConhecimento(d: DespachoDoCodigo): boolean {
  return String(d.codigo ?? "").trim() !== "" && ehConhecimento(d.tipoFrete) && !despachoEhCorreios(d);
}

/** O campo e "Conhecimento" quando o despacho e de transportadora ou motoboy. */
export function ehConhecimento(tipoFrete: string | null | undefined): boolean {
  const tipo = String(tipoFrete ?? "").trim().toUpperCase();
  return tipo === "TRANSPORTADORA" || tipo === "MOTOBOY";
}

/** O campo aparece para CORREIOS (como sempre), TRANSPORTADORA e MOTOBOY. */
export function campoCodigoVisivel(tipoFrete: string | null | undefined): boolean {
  return String(tipoFrete ?? "").trim().toUpperCase() === "CORREIOS" || ehConhecimento(tipoFrete);
}

export function rotuloDoCampoCodigo(tipoFrete: string | null | undefined): string {
  return ehConhecimento(tipoFrete) ? "Conhecimento" : "Código de rastreio (manual)";
}

const limpo = (v: string | null | undefined) => String(v ?? "").trim();

/** Registrar autoria? So para conhecimento (transportadora/motoboy) e so quando o valor mudou. */
export function deveRegistrarConhecimento(
  tipoEfetivo: string | null | undefined,
  antes: string | null | undefined,
  depois: string | null | undefined
): boolean {
  return ehConhecimento(tipoEfetivo) && limpo(antes) !== limpo(depois);
}

/** Texto do `os_status_log.motivo`: valor antigo e novo. */
export function motivoDoConhecimento(antes: string | null | undefined, depois: string | null | undefined): string {
  const a = limpo(antes);
  const d = limpo(depois);
  return `Conhecimento: ${a ? `"${a}"` : "(vazio)"} -> ${d ? `"${d}"` : "(vazio)"}`;
}

/** Origem da trilha em `os_status_log`. */
export const ORIGEM_LOG_CONHECIMENTO = "EXPEDICAO_CONHECIMENTO";
