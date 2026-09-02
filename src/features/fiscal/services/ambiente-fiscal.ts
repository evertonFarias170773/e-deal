import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * De onde sai o ambiente fiscal de uma nota: `empresas`, e no momento da
 * transmissão.
 *
 * POR QUE EXISTE
 *   `notas_fiscais.ambiente` é `NOT NULL DEFAULT 'homologacao'` e ninguém
 *   escrevia o ambiente real na criação — `fn_criar_rascunho_nfe` não preenche
 *   o campo, e o caminho avulso em `nfe.service.ts` crava o literal
 *   `"homologacao"`. Resultado: todo rascunho nascia homologação, para
 *   qualquer empresa, e quatro notas autorizadas em PRODUÇÃO ficaram
 *   registradas como homologação.
 *
 *   Corrigir na criação seria errado: um rascunho de 26/08 emitido em 02/09
 *   tem que sair com o ambiente de HOJE, não com o de quando nasceu. Por isso
 *   a sincronização acontece na transmissão.
 *
 * O QUE ESTE MÓDULO NÃO FAZ
 *   Não decide para onde a nota vai. Quem roteia é o nó `Switch` do workflow
 *   n8n, por CNPJ. Esta coluna é registro — mas registro que a regra
 *   `isNotaImpeditiva` usa para recusar cancelamento de cobrança, e que os
 *   links de Carta de Correção usam para montar o host da Focus. Por isso
 *   precisa estar certa.
 *
 * POR QUE NÃO TEM VALOR PADRÃO
 *   O código anterior assumia `item.id_empresa === 1 ? "producao" : "homologacao"`
 *   quando a leitura falhava. Um palpite sobre ambiente fiscal é pior do que
 *   uma recusa: erra em silêncio e grava a mentira no banco. Aqui, empresa sem
 *   ambiente definido interrompe a emissão com mensagem que diz onde arrumar.
 */

export type AmbienteFiscal = "producao" | "homologacao";

export type TipoDocumentoFiscal = "NFE" | "NFSE";

export type ResolucaoAmbiente =
  | { ok: true; ambiente: AmbienteFiscal; empresa: string }
  | { ok: false; mensagem: string };

const AMBIENTES_VALIDOS: readonly string[] = ["producao", "homologacao"];

/** A coluna de `empresas` que vale para cada documento. */
const COLUNA_POR_TIPO: Record<TipoDocumentoFiscal, "ambiente_nfe" | "ambiente_nfse"> = {
  NFE: "ambiente_nfe",
  NFSE: "ambiente_nfse"
};

const ROTULO_POR_TIPO: Record<TipoDocumentoFiscal, string> = {
  NFE: "NF-e",
  NFSE: "NFS-e"
};

/**
 * Lê o ambiente vigente da empresa emitente.
 *
 * Recebe o client de fora de propósito: a rota de emissão chama com o client do
 * servidor (JWT do usuário, RLS valendo) e a tela de reenvio chama com o client
 * do browser. A regra é a mesma nos dois; só o portador muda.
 */
export async function resolverAmbienteFiscal(
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  supabase: SupabaseClient<any, any, any>,
  idEmpresa: number | null | undefined,
  tipo: TipoDocumentoFiscal
): Promise<ResolucaoAmbiente> {
  const coluna = COLUNA_POR_TIPO[tipo];
  const rotulo = ROTULO_POR_TIPO[tipo];

  if (idEmpresa === null || idEmpresa === undefined) {
    return {
      ok: false,
      mensagem:
        `Esta nota não tem empresa emitente definida, então não dá para saber ` +
        `em que ambiente ela sairia. Defina a empresa da nota antes de emitir.`
    };
  }

  const { data, error } = await supabase
    .from("empresas")
    .select(`empresa, ${coluna}`)
    .eq("id", idEmpresa)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      mensagem: `Não foi possível ler o ambiente de ${rotulo} da empresa emitente: ${error.message}`
    };
  }

  if (!data) {
    return {
      ok: false,
      mensagem:
        `A empresa emitente (id ${idEmpresa}) não foi encontrada em Cadastros › ` +
        `Empresas. Sem ela não dá para determinar o ambiente de ${rotulo}.`
    };
  }

  const linha = data as Record<string, unknown>;
  const nomeEmpresa = String(linha.empresa ?? `empresa ${idEmpresa}`);
  const bruto = String(linha[coluna] ?? "").trim().toLowerCase();

  if (!AMBIENTES_VALIDOS.includes(bruto)) {
    return {
      ok: false,
      mensagem:
        `A empresa ${nomeEmpresa} está sem o ambiente de ${rotulo} definido ` +
        `(${coluna} = ${bruto ? `"${bruto}"` : "vazio"}). ` +
        `Defina "producao" ou "homologacao" em Cadastros › Empresas antes de emitir.`
    };
  }

  return { ok: true, ambiente: bruto as AmbienteFiscal, empresa: nomeEmpresa };
}
