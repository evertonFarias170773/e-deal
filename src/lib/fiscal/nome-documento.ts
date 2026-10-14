/**
 * NOME DO ARQUIVO E CAMINHO SEGURO DO DOCUMENTO DE UMA NOTA (14/10/2026).
 *
 * O "Abrir PDF" do Historico abria a URL assinada do Storage, que responde sem
 * nome de arquivo: o botao de baixar do visualizador do navegador nao salvava
 * nada na NFS-e 138 (NFS-23733-001). Agora o documento abre pela rota
 * `/api/fiscal/documento-nota` (GET), na mesma origem do Vibe, com o nome
 * legivel no cabecalho. Regras puras aqui, testadas em
 * scripts/testes/nome-documento-fiscal.test.mts.
 */

export type TipoDoDocumento = "pdf" | "xml";

const limpar = (valor: unknown) => String(valor ?? "").replace(/[^0-9A-Za-z]+/g, "");

/**
 * Nome legivel: `NFS-e-138-Pedido-23733.pdf`, `NF-e-1002-Pedido-20370.xml`.
 * Sem numero, vai a `ref`; sem pedido, o trecho "Pedido" some. E o mesmo
 * formato que a janela Gerar NFS-e ja usava para baixar.
 */
export function nomeDoDocumentoFiscal(entrada: {
  modelo: "nfe" | "nfse";
  numero: string | number | null | undefined;
  idInt: number | null | undefined;
  ref: string;
  tipo: TipoDoDocumento;
}): string {
  const numero = limpar(entrada.numero);
  const pedido = Number(entrada.idInt) > 0 ? String(Math.trunc(Number(entrada.idInt))) : "";
  const partes = [entrada.modelo === "nfse" ? "NFS-e" : "NF-e", numero || String(entrada.ref).replace(/[^0-9A-Za-z-]+/g, "")];
  if (pedido) partes.push("Pedido", pedido);
  return `${partes.join("-")}.${entrada.tipo}`;
}

/** Os dois arquivos que o bucket guarda por nota, e so eles. */
const CAMINHO_VALIDO = /^([A-Z0-9][A-Z0-9-]{2,40})\/(danfe\.pdf|nfe\.xml)$/;

/** `<ref>/danfe.pdf` ou `<ref>/nfe.xml`; qualquer outra coisa e `null`. */
export function caminhoDoDocumento(valor: string | null | undefined): { caminho: string; tipo: TipoDoDocumento } | null {
  const achado = String(valor ?? "").match(CAMINHO_VALIDO);
  if (!achado) return null;
  return { caminho: achado[0], tipo: achado[2] === "nfe.xml" ? "xml" : "pdf" };
}

/** O nome pedido so vale se for letras, numeros e hifen com a extensao certa. */
export function nomeSeguro(nome: string | null | undefined, tipo: TipoDoDocumento): string {
  const texto = String(nome ?? "").trim();
  return new RegExp(`^[A-Za-z0-9][A-Za-z0-9-]{0,80}\\.${tipo}$`).test(texto) ? texto : `documento.${tipo}`;
}

/** Assinatura do Storage: um JWT (tres blocos base64url). */
export function tokenDeAssinaturaValido(token: string | null | undefined): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(token ?? ""));
}

/** O token de uma URL assinada do Storage (`...?token=<jwt>`), ou `null`. */
export function tokenDaUrlAssinada(urlAssinada: string): string | null {
  try {
    const token = new URL(urlAssinada).searchParams.get("token");
    return tokenDeAssinaturaValido(token) ? token : null;
  } catch {
    return null;
  }
}

/** Endereco relativo, na mesma origem, que a rota GET serve. */
export function enderecoParaAbrir(caminho: string, token: string, nome: string): string {
  const busca = new URLSearchParams({ c: caminho, t: token, n: nome });
  return `/api/fiscal/documento-nota?${busca.toString()}`;
}
