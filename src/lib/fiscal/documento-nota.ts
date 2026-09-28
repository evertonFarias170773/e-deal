import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Abrir e compartilhar o DANFE e o XML de uma nota com um link que NÃO vence.
 *
 * O PROBLEMA
 *   `notas_fiscais.url_danfe` e `url_xml` guardam uma URL ASSINADA do bucket
 *   privado `nfe-documentos`, gerada pelo n8n na emissão e válida por 7 dias.
 *   Depois disso o link gravado responde `InvalidJWT: "exp" claim timestamp
 *   check failed` — foi o que o Financeiro recebeu no DANFE do pedido 21869.
 *
 * A SAÍDA
 *   O link gravado continua servindo para saber QUE a nota tem o arquivo e QUAL
 *   é ele (o caminho `<ref>/danfe.pdf` está dentro da URL). O link que se abre é
 *   outro: assinado agora, por `/api/fiscal/documento-nota`.
 *
 *   Link que não é do nosso bucket (de outra origem, se um dia houver) abre como
 *   está: não há o que reassinar.
 */

export type ArquivoDaNota = "danfe" | "xml";

/** URL assinada ou pública do NOSSO bucket, com o caminho `<ref>/<arquivo>`. */
const DO_NOSSO_BUCKET =
  /\/storage\/v1\/object\/(?:sign|public|authenticated)\/nfe-documentos\/([^/?#]+)\/(danfe\.pdf|nfe\.xml)(?:[?#]|$)/i;

/**
 * De um link gravado, o documento que ele aponta — ou `null` quando o link não
 * é do nosso bucket.
 */
export function documentoDoLinkGravado(
  urlGravada: string | null | undefined
): { ref: string; arquivo: ArquivoDaNota } | null {
  const achado = String(urlGravada ?? "").match(DO_NOSSO_BUCKET);
  if (!achado) return null;
  let ref = achado[1];
  try {
    ref = decodeURIComponent(ref);
  } catch {
    /* ref sem escape: fica como veio */
  }
  return { ref, arquivo: achado[2].toLowerCase() === "nfe.xml" ? "xml" : "danfe" };
}

/** Pede ao servidor um link assinado agora. Lança com a mensagem legível. */
async function pedirLinkNovo(
  ref: string,
  arquivo: ArquivoDaNota,
  finalidade: "abrir" | "compartilhar"
): Promise<string> {
  const sessao = await getSupabaseClient()?.auth.getSession();
  const token = sessao?.data?.session?.access_token ?? "";
  if (!token) throw new Error("Sessão expirada. Entre de novo para abrir o documento.");

  const resposta = await fetch("/api/fiscal/documento-nota", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ref, arquivo, finalidade })
  });

  let corpo: { success?: boolean; url?: string; message?: string } = {};
  try {
    corpo = await resposta.json();
  } catch {
    /* sem corpo legível: cai na mensagem padrão */
  }
  if (!resposta.ok || !corpo.url) {
    throw new Error(corpo.message || `Não foi possível gerar o link do documento (HTTP ${resposta.status}).`);
  }
  return corpo.url;
}

const escapar = (texto: string) =>
  texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Abre o documento numa aba nova, com link assinado agora.
 *
 * A aba é aberta NO CLIQUE, antes de ir ao servidor: os navegadores barram
 * `window.open` que acontece depois de um `await`, e o operador ficaria sem
 * nada. Ela mostra "Abrindo…" e, quando o link chega, navega até ele. Se der
 * erro, a própria aba diz o motivo.
 */
export function abrirDocumentoDaNota(ref: string, arquivo: ArquivoDaNota): void {
  const janela = typeof window !== "undefined" ? window.open("", "_blank") : null;
  if (janela) {
    try {
      janela.opener = null;
      janela.document.title = "Abrindo documento…";
      janela.document.body.innerHTML =
        '<p style="font-family:system-ui,sans-serif;padding:24px;color:#334155">Abrindo o documento…</p>';
    } catch {
      /* aba de outra origem: segue sem o aviso */
    }
  }

  void pedirLinkNovo(ref, arquivo, "abrir")
    .then((url) => {
      if (janela) janela.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
    })
    .catch((err: unknown) => {
      const mensagem = err instanceof Error ? err.message : "Não foi possível abrir o documento.";
      console.error("[documento-nota] Falha ao abrir:", err);
      if (janela) {
        try {
          janela.document.title = "Documento indisponível";
          janela.document.body.innerHTML =
            `<p style="font-family:system-ui,sans-serif;padding:24px;color:#9f1239">${escapar(mensagem)}</p>`;
          return;
        } catch {
          /* cai no alerta */
        }
      }
      window.alert(mensagem);
    });
}

/**
 * Link para mandar a alguém ("Copiar link"): assinado agora e válido por 7 dias,
 * a mesma janela que o link gravado tinha no dia da emissão — só que contada a
 * partir de hoje.
 */
export function linkDoDocumentoParaCompartilhar(ref: string, arquivo: ArquivoDaNota): Promise<string> {
  return pedirLinkNovo(ref, arquivo, "compartilhar");
}

/**
 * Para quem só tem o link gravado na mão: se ele é do nosso bucket, abre com
 * assinatura nova; se não é, abre como está.
 */
export function abrirLinkDeDocumentoFiscal(urlGravada: string | null | undefined): void {
  const documento = documentoDoLinkGravado(urlGravada);
  if (documento) {
    abrirDocumentoDaNota(documento.ref, documento.arquivo);
    return;
  }
  const url = String(urlGravada ?? "").trim();
  if (url && typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * O "Copiar link" a partir do link gravado: do nosso bucket, sai um link novo
 * de 7 dias; de outra origem, sai o próprio link.
 */
export async function linkCompartilhavelDoLinkGravado(urlGravada: string | null | undefined): Promise<string> {
  const documento = documentoDoLinkGravado(urlGravada);
  if (documento) return linkDoDocumentoParaCompartilhar(documento.ref, documento.arquivo);
  return String(urlGravada ?? "").trim();
}
