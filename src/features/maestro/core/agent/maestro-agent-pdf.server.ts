/**
 * maestro-agent-pdf.server.ts
 *
 * Geração do PDF oficial da proposta para o agent loop — MESMO caminho
 * consolidado da tela de orçamentos (gerarPDFProposta em
 * orcamentos.service.ts): Edge Function `proposta_comencial` (template por
 * empresa em pdf_propostas_modelos), upload no bucket público `pdf_fatura`
 * e URL pública no retorno + registro na timeline da proposta.
 *
 * Uso no agente: SOMENTE para a proposta recém-criada pelo próprio usuário
 * no fluxo de salvar (a Edge Function não valida permissão — o gate é o
 * fluxo B1, que já exige propostas.create e cliente resolvido).
 * Best-effort: falha aqui NUNCA desfaz o salvamento.
 *
 * ⚠️ Roda apenas no servidor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const MODELO_POR_EMPRESA: Record<number, number> = { 1: 10, 2: 11, 3: 12 };
const PDF_TIMEOUT_MS = 15_000;

/** Mesmo string-match usado pelas telas de orçamentos (empresa → id 1/2/3). */
export function idEmpresaPorNome(empresa: string | null | undefined): number | null {
  const nome = (empresa ?? '').toLowerCase();
  if (!nome.trim()) return null;
  if (nome.includes('grafica') || nome.includes('gráfica') || nome.includes('ingresso')) return 1;
  if (nome.includes('biro') || nome.includes('birô')) return 2;
  if (nome.includes('e3') || nome.includes('brindes')) return 3;
  return null;
}

export async function gerarPdfPropostaServer(
  supabase: SupabaseClient,
  idInt: number,
): Promise<{ success: boolean; url?: string; errorMessage?: string }> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return { success: false, errorMessage: 'Configurações do Supabase ausentes no servidor.' };
    }
    if (!idInt) {
      return { success: false, errorMessage: 'ID da proposta inválido.' };
    }

    const { data: prop } = await supabase
      .from('propostas')
      .select('empresa')
      .eq('id_int', idInt)
      .maybeSingle();
    const idEmpresa = idEmpresaPorNome((prop as { empresa?: string | null } | null)?.empresa);
    if (idEmpresa == null) {
      return {
        success: false,
        errorMessage: `Empresa da proposta não suportada para geração de PDF ("${(prop as { empresa?: string | null } | null)?.empresa ?? ''}").`,
      };
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/proposta_comencial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ id_int: idInt, id_modelo: MODELO_POR_EMPRESA[idEmpresa] }),
      signal: AbortSignal.timeout(PDF_TIMEOUT_MS),
    });
    if (!response.ok) {
      const text = await response.text();
      return { success: false, errorMessage: `Edge Function HTTP ${response.status}: ${text || response.statusText}` };
    }

    const data = (await response.json()) as { success?: boolean; url?: string; message?: string; error?: string };
    if (data?.success && data.url) {
      // Timeline da proposta (não-bloqueante) — mesmo registro feito pela tela
      void supabase
        .from('propostas_chat')
        .insert([
          {
            id_int: idInt,
            id_cliente: null,
            mensagem: 'PDF da proposta gerado.',
            tipo: 'SISTEMA',
            autor_nome: 'Sistema',
            setor: 'Comercial',
            visivel_externo: false,
            anexos: null,
          },
        ])
        .then(({ error }) => {
          if (error) console.warn('[MaestroAgentPdf] Timeline não registrada:', error.message);
        });
      return { success: true, url: data.url };
    }
    return { success: false, errorMessage: data?.message || data?.error || 'A resposta da Edge Function não trouxe a URL do PDF.' };
  } catch (error) {
    return { success: false, errorMessage: error instanceof Error ? error.message : 'Erro desconhecido ao gerar o PDF.' };
  }
}
