/**
 * Baixa o PDF do boleto já com o nome "<pedido> - <cliente>.pdf" (21/10/2026).
 * A regra do nome e o porquê do Storage: lib/nome-arquivo-boleto.
 *
 * Só leitura: uma consulta em `boletos` (a mesma linha que o link público
 * serviria) e o download do PDF público. Nada é gravado. Quando não dá para
 * baixar (linha não achada, PDF ausente, rede), devolve `ok: false` e quem
 * chamou abre o link de sempre, como antes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  codigoDoLinkPublico,
  escolherLinhaComoOLinkPublico,
  nomeArquivoBoleto,
  urlStorageDoBoleto,
  type LinhaBoleto
} from "@/features/cobrancas/lib/nome-arquivo-boleto";

export type CobrancaParaBaixar = {
  id_int?: number | null;
  id_pagamento?: string | null;
  cliente?: string | null;
  url_pdf?: string | null;
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
    const codigo = codigoDoLinkPublico(cobranca.url_pdf);
    if (!codigo && !cobranca.id_pagamento) return { ok: false, motivo: "SEM_REFERENCIA" };

    const { data, error } = await client
      .from("boletos")
      .select("id_int, parcela, total_parcelas, status, created_at")
      .eq(codigo ? "n_doc_boleto" : "id_pagamento", codigo ?? cobranca.id_pagamento);
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
