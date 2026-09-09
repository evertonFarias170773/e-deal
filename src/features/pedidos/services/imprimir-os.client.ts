import { getSupabaseClient } from "@/lib/supabase/client";
import { nomeArquivoOs } from "./os-nome-arquivo";
import { registrarImpressaoDoSetor } from "./boletim-setores.service";

/**
 * Abre o PDF da OS gerado on-demand pela rota autenticada /api/pedidos/imprimir-os.
 *
 * A aba é aberta SINCRONAMENTE no clique (antes de qualquer await), evitando
 * bloqueio de popup, e navega direto para a rota. A rota autentica pelo cookie
 * de sessão, então nada precisa ser buscado antes.
 *
 * Por que navegar em vez de baixar via fetch + Blob: o visualizador de PDF do
 * navegador nomeia o arquivo pela URL. Num `blob:` isso é o UUID do object URL
 * (`aeb0fc11-97a2-...`), e nem o nome de um `File` nem o título da aba mudam
 * isso. Vindo de uma resposta HTTP, ele usa o `Content-Disposition` da rota —
 * que é exatamente `os_{id_int}_{setor}.pdf`.
 */

export interface AbrirPdfOsResult {
  success: boolean;
  errorMessage?: string;
  /**
   * O navegador recusou a aba. NÃO é erro nem sucesso: o PDF existe e está a um
   * clique. Quem chama deve oferecer esse clique — ver `urlParaAbrir`.
   *
   * Substitui o download automático que havia aqui até 09/2026. Baixar no lugar
   * de abrir resolvia o bloqueio às custas de fazer a coisa errada em silêncio:
   * quem pediu para VER o documento recebia um arquivo na pasta de downloads,
   * sem nada na tela dizendo por quê.
   */
  bloqueadoPeloNavegador?: boolean;
  /** A URL do documento, para a tela oferecer "abrir" num gesto do usuário. */
  urlParaAbrir?: string;
}

/**
 * Layout do PDF. `completo` e o padrao historico (card por modelo, com a imagem
 * da arte) e continua saindo quando ninguem escolhe nada — inclusive de link
 * antigo, que nao tem o parametro. `resumido` e a lista de conferencia.
 */
export type LayoutPdfOs = "completo" | "resumido";

function urlDoBoletim(idInt: number, idBoletim?: string | null, layout?: LayoutPdfOs): string {
  const params = new URLSearchParams({ id_int: String(idInt) });
  if (idBoletim) params.set("boletim", idBoletim);
  // Só viaja quando é o não-padrão: a URL do caminho de sempre não muda.
  if (layout === "resumido") params.set("layout", "resumido");
  return `/api/pedidos/imprimir-os?${params.toString()}`;
}

/** A URL do maço: um documento, um setor por página, na ordem dos uuids. */
function urlDoMaco(idInt: number, idsBoletins: string[]): string {
  const params = new URLSearchParams({ id_int: String(idInt) });
  params.set("boletins", idsBoletins.join(","));
  return `/api/pedidos/imprimir-os?${params.toString()}`;
}

/**
 * Abre o documento numa aba nova DESVINCULADA da janela do sistema.
 *
 * O DEFEITO QUE ISTO CONSERTA (09/2026)
 *   `window.open(url, "_blank")` sozinho deixa a aba do PDF com
 *   `window.opener` apontando para a aba do ERP. As duas ficam no mesmo grupo de
 *   contexto: uma pode navegar e fechar a outra, e o usuário relatou justamente
 *   isso — fechar o visualizador depois de imprimir levava o sistema junto.
 *
 * POR QUE `opener = null` E NÃO A FLAG `noopener`
 *   `window.open(url, "_blank", "noopener")` desvincula, mas devolve SEMPRE
 *   `null` — é o que a especificação manda. Sem o objeto de retorno some a única
 *   forma de saber se o navegador bloqueou a abertura, e o aviso de pop-up
 *   bloqueado deixaria de funcionar.
 *
 *   Medido no Chrome em 09/2026:
 *     window.open(url, "_blank")                  -> Window, e opener aponta para a pai
 *     window.open(url, "_blank", "noopener")      -> null, sempre
 *     window.open(url, "_blank") + opener = null  -> Window, e opener vira null
 *
 *   A terceira forma dá as duas coisas: detecta o bloqueio e corta o vínculo.
 *
 * Devolve `null` quando o navegador bloqueou — quem chama transforma isso em
 * pedido de clique, nunca em download silencioso.
 */
export function abrirAbaDesvinculada(url: string): Window | null {
  if (typeof window === "undefined") return null;

  const aba = window.open(url, "_blank");
  if (!aba) return null;

  // Same-origin (a rota é do próprio app), então a atribuição é permitida.
  try {
    aba.opener = null;
  } catch {
    // Navegador que recuse a atribuição: a aba já está aberta e o PDF sai. O
    // vínculo continuar não justifica derrubar a impressão.
  }
  return aba;
}

/** O resumido baixa com sufixo proprio — a rota manda o mesmo no Content-Disposition. */
function nomeDoArquivo(idInt: number, setor: string | null | undefined, layout?: LayoutPdfOs): string {
  const base = nomeArquivoOs(idInt, setor);
  return layout === "resumido" ? base.replace(/\.pdf$/i, "_resumo.pdf") : base;
}

/**
 * Baixa o PDF de um boletim direto para o disco, sem abrir aba.
 *
 * É o caminho de "baixar todos": N abas seriam bloqueadas pelo navegador depois
 * da primeira, então cada setor vira um download com o seu próprio nome.
 */
export async function baixarPdfOs(
  idInt: number,
  idBoletim?: string | null,
  setor?: string | null,
  layout?: LayoutPdfOs
): Promise<AbrirPdfOsResult> {
  const nomeArquivo = nomeDoArquivo(idInt, setor, layout);
  let objectUrl: string | null = null;
  try {
    const client = getSupabaseClient();
    const sessionResult = client ? await client.auth.getSession() : null;
    const token = sessionResult?.data?.session?.access_token;
    if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };

    const response = await fetch(urlDoBoletim(idInt, idBoletim, layout), {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      let message = `Falha ao gerar o PDF (HTTP ${response.status}).`;
      try {
        const body = await response.json();
        if (body?.message) message = String(body.message);
      } catch {
        // resposta sem JSON — mantém a mensagem genérica
      }
      return { success: false, errorMessage: message };
    }

    const blob = await response.blob();
    objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = nomeArquivo;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Carimba DEPOIS do PDF sair: o registro é consequência da impressão, e uma
    // falha aqui não pode derrubar o que já foi entregue ao usuário.
    if (idBoletim) await registrarImpressaoDoSetor(idBoletim);
    return { success: true };
  } catch (e) {
    return {
      success: false,
      errorMessage: e instanceof Error ? e.message : "Erro inesperado ao gerar o PDF da OS."
    };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Abre o PDF da OS. `idBoletim` (pedidos_artes.id) seleciona o boletim do setor;
 * sem ele, mantém o comportamento legado do boletim mais recente da proposta.
 * `setor` entra no nome do arquivo (os_{id_int}_{setor}.pdf).
 */
export async function abrirPdfOs(
  idInt: number,
  idBoletim?: string | null,
  setor?: string | null,
  layout?: LayoutPdfOs
): Promise<AbrirPdfOsResult> {
  const nomeArquivo = nomeDoArquivo(idInt, setor, layout);
  const url = urlDoBoletim(idInt, idBoletim, layout);

  // Aberta de forma síncrona no gesto do usuário — não move para depois de um
  // await. Desvinculada da janela do sistema: ver `abrirAbaDesvinculada`.
  const win = abrirAbaDesvinculada(url);

  if (!win) {
    // Bloqueado. Devolve a URL para a tela oferecer o clique, em vez de baixar
    // por conta própria — ver `bloqueadoPeloNavegador`.
    return {
      success: false,
      bloqueadoPeloNavegador: true,
      urlParaAbrir: url,
      errorMessage: "O navegador bloqueou a abertura do documento."
    };
  }

  // `nomeArquivo` continua sendo calculado acima porque a rota o devolve no
  // Content-Disposition; aqui ele não é mais usado para baixar nada.
  void nomeArquivo;

  // A aba já está a caminho; o carimbo vai depois, sem segurar o retorno.
  // `idBoletim` nulo é o caminho legado da lista de OS, que imprime "o boletim
  // mais recente" sem dizer qual — sem o id não há linha para carimbar, e
  // adivinhar marcaria o setor errado.
  if (idBoletim) await registrarImpressaoDoSetor(idBoletim);
  return { success: true };
}

/**
 * Abre o MAÇO: um documento com um setor por página, numa aba só.
 *
 * É o caminho normal de impressão a partir de 09/2026. Com um único boletim cai
 * em `abrirPdfOs`, que produz o PDF de setor único de sempre — inclusive com a
 * numeração de página, que o maço não tem.
 *
 * Carimba `impresso_em` em TODAS as linhas incluídas: o documento saiu com todas
 * elas, então todas foram impressas.
 */
export async function abrirMacoOs(
  idInt: number,
  boletins: { id: string; setor?: string | null }[]
): Promise<AbrirPdfOsResult> {
  const ids = boletins.map((b) => b.id).filter(Boolean);
  if (ids.length === 0) {
    return { success: false, errorMessage: "Nenhum boletim de setor para imprimir." };
  }
  if (ids.length === 1) {
    return abrirPdfOs(idInt, ids[0], boletins[0]?.setor ?? null, "completo");
  }

  const url = urlDoMaco(idInt, ids);
  const win = abrirAbaDesvinculada(url);

  if (!win) {
    return {
      success: false,
      bloqueadoPeloNavegador: true,
      urlParaAbrir: url,
      errorMessage: "O navegador bloqueou a abertura do documento."
    };
  }

  for (const id of ids) await registrarImpressaoDoSetor(id);
  return { success: true };
}
