/**
 * Baixa o PDF do boleto já com o nome "<pedido> - <cliente>.pdf" (21/10/2026).
 * A regra do nome e o porquê do Storage: lib/nome-arquivo-boleto.
 *
 * Só leitura: uma consulta em `boletos` (a mesma linha que o link público
 * serviria) e o download do PDF público. Nada é gravado. Quando não dá para
 * baixar (linha não achada, PDF ausente, rede), devolve `ok: false` e quem
 * chamou abre o link de sempre, como antes.
 *
 * Usado por todo ponto do app que baixa PDF de boleto: aba Pagamentos, detalhe
 * da cobrança, Carteira (ações e detalhe) e revisão da geração bancária. A
 * consulta é UMA por clique, nunca por linha renderizada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  codigoDoLinkPublico,
  escolherLinhaComoOLinkPublico,
  nomeArquivoBoleto,
  parcelaDoCaminhoStorage,
  urlStorageDoBoleto,
  type LinhaBoleto
} from "@/features/cobrancas/lib/nome-arquivo-boleto";

export type CobrancaParaBaixar = {
  id_int?: number | null;
  id_pagamento?: string | null;
  cliente?: string | null;
  url_pdf?: string | null;
  /** Parcela do título, quando quem chama a conhece (Carteira). */
  parcela?: number | null;
};

export type ResultadoBaixarBoleto =
  | { ok: true; nome: string; arquivo: Blob }
  | { ok: false; motivo: string };

export async function baixarBoletoComNome(
  client: SupabaseClient,
  cobranca: CobrancaParaBaixar,
  baseSupabase: string,
  buscar: typeof fetch = fetch
): Promise<ResultadoBaixarBoleto> {
  try {
    // Qual linha: pelo código do link público (único por parcela); senão pelo
    // pedido e parcela do caminho no Storage; senão pela cobrança (e a parcela,
    // se veio). Num parcelado, só `id_pagamento` acharia a parcela errada.
    const codigo = codigoDoLinkPublico(cobranca.url_pdf);
    const doCaminho = codigo ? null : parcelaDoCaminhoStorage(cobranca.url_pdf);
    if (!codigo && !doCaminho && !cobranca.id_pagamento) return { ok: false, motivo: "SEM_REFERENCIA" };

    let consulta = client
      .from("boletos")
      .select("id_int, parcela, total_parcelas, status, created_at");
    if (codigo) {
      consulta = consulta.eq("n_doc_boleto", codigo);
    } else if (doCaminho) {
      consulta = consulta.eq("id_int", doCaminho.idInt).eq("parcela", doCaminho.parcela);
    } else {
      consulta = consulta.eq("id_pagamento", cobranca.id_pagamento as string);
      if (cobranca.parcela) consulta = consulta.eq("parcela", cobranca.parcela);
    }
    const { data, error } = await consulta;
    if (error) return { ok: false, motivo: "LEITURA" };

    const linha = escolherLinhaComoOLinkPublico((Array.isArray(data) ? data : []) as LinhaBoleto[]);
    if (!linha || !linha.id_int || !linha.parcela) return { ok: false, motivo: "SEM_BOLETO" };

    const resposta = await buscar(urlStorageDoBoleto(baseSupabase, Number(linha.id_int), Number(linha.parcela)));
    const tipo = resposta.headers.get("content-type") ?? "";
    if (!resposta.ok || !/pdf/i.test(tipo)) return { ok: false, motivo: "PDF_INDISPONIVEL" };

    const arquivo = await resposta.blob();
    const nome = nomeArquivoBoleto({
      idInt: linha.id_int ?? cobranca.id_int,
      idPagamento: cobranca.id_pagamento,
      cliente: cobranca.cliente,
      parcela: linha.parcela,
      totalParcelas: linha.total_parcelas
    });
    return { ok: true, nome, arquivo };
  } catch {
    return { ok: false, motivo: "FALHA" };
  }
}

/** Entrega o arquivo ao navegador com o nome dado (atributo download). */
export function salvarArquivoNoNavegador(arquivo: Blob, nome: string): void {
  const url = URL.createObjectURL(arquivo);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type DesfechoBaixarOuAbrir = "BAIXADO" | "ABERTO" | "BLOQUEADO" | "SEM_LINK";

/**
 * O que os botões fazem: baixa com o nome; se não der, abre o link de sempre.
 * `BLOQUEADO` = o navegador barrou a aba (quem chama avisa com o link).
 */
export async function baixarBoletoOuAbrirLink(
  client: SupabaseClient | null,
  cobranca: CobrancaParaBaixar,
  baseSupabase: string,
  linkDeSempre: string,
  deps: {
    buscar?: typeof fetch;
    salvar?: (arquivo: Blob, nome: string) => void;
    abrir?: (url: string) => unknown;
  } = {}
): Promise<DesfechoBaixarOuAbrir> {
  if (client && baseSupabase) {
    const resultado = await baixarBoletoComNome(client, cobranca, baseSupabase, deps.buscar ?? fetch);
    if (resultado.ok) {
      (deps.salvar ?? salvarArquivoNoNavegador)(resultado.arquivo, resultado.nome);
      return "BAIXADO";
    }
  }
  if (!linkDeSempre) return "SEM_LINK";
  const aberta = (deps.abrir ?? abrirEmOutraAba)(linkDeSempre);
  return aberta ? "ABERTO" : "BLOQUEADO";
}

/**
 * `window.open` sem o parâmetro "noopener": com ele o navegador devolve null
 * mesmo quando abre, e não daria para saber se a aba foi barrada. O `opener` é
 * anulado à mão, que tem o mesmo efeito de segurança.
 */
function abrirEmOutraAba(url: string): Window | null {
  const aba = window.open(url, "_blank");
  if (aba) aba.opener = null;
  return aba;
}
