import { NextResponse } from "next/server";
import { cabecalhosWebhookN8n } from "@/lib/n8n/webhook-segredo";
import {
  COLUNAS_DA_NOTA_DE_SERVICO,
  autenticarEmissorDeNfse,
  respostaDeErro,
  type NotaDeServicoLida
} from "@/features/nfse/services/nfse-pedido.server";
import { empresaLiberadaParaNfse, situacaoDoStatus, statusPedeConsulta } from "@/features/nfse/lib/regras-emissao";

/**
 * Acompanhamento de uma NFS-e — porta de entrada no servidor.
 *
 * POST { ref }
 *   1. sessão e `fiscal.emit_nfse`;
 *   2. relê a nota. Se ela está EM ANÁLISE (processando, retorno não
 *      reconhecido ou status desconhecido), chama o webhook
 *      `consultar-nfse-focus` do n8n, com o segredo. Nota que já tem desfecho
 *      no banco NÃO é consultada: não há o que perguntar à Focus;
 *   3. relê a nota de novo e devolve o que está NO BANCO.
 *
 * O CORPO DO WEBHOOK É IGNORADO
 *   No ramo em que a nota é autorizada, o fluxo responde 200 com corpo vazio.
 *   Quem diz o desfecho é `notas_servico`, que o próprio fluxo grava. A tela lê
 *   daqui e nunca decide pelo corpo do webhook.
 *
 * Esta rota não escreve em `notas_servico` e não emite nada.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WEBHOOK_CONSULTAR_NFSE = "https://10074.hostoo.net.br/webhook/consultar-nfse-focus";
const SEM_CACHE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const sessao = await autenticarEmissorDeNfse(request);
    if (sessao instanceof NextResponse) return sessao;

    let ref = "";
    try {
      const corpo = (await request.json()) as { ref?: unknown };
      ref = String(corpo?.ref ?? "").trim();
    } catch {
      return respostaDeErro(400, "Corpo da requisição inválido.");
    }
    if (!ref) return respostaDeErro(400, "Referência da nota ausente.");

    const lerNota = async () =>
      sessao.supabase.from("notas_servico").select(COLUNAS_DA_NOTA_DE_SERVICO).eq("ref", ref).maybeSingle();

    const antes = await lerNota();
    if (antes.error) {
      console.error("[API][ConsultarNfse] Falha ao ler a nota:", antes.error.message);
      return respostaDeErro(500, "Não foi possível ler a nota de serviço no banco.");
    }
    if (!antes.data) return respostaDeErro(404, "Nota de serviço não encontrada.");

    let nota = antes.data as unknown as NotaDeServicoLida;
    if (!empresaLiberadaParaNfse(nota.id_empresa == null ? null : Number(nota.id_empresa))) {
      return respostaDeErro(422, "A consulta de NFS-e pelo Vibe não está liberada para a empresa desta nota.", {
        code: "EMPRESA_NAO_LIBERADA"
      });
    }

    let consultada = false;
    let aviso: string | null = null;
    if (statusPedeConsulta(nota.status)) {
      consultada = true;
      try {
        const resposta = await fetch(WEBHOOK_CONSULTAR_NFSE, {
          method: "POST",
          headers: cabecalhosWebhookN8n(),
          body: JSON.stringify({ ref: nota.ref })
        });
        // Lido só para liberar a conexão: o desfecho vem do banco.
        await resposta.text().catch(() => "");
        if (!resposta.ok) {
          console.warn(`[API][ConsultarNfse] Webhook respondeu HTTP ${resposta.status} para ${nota.ref}.`);
          aviso = "A integração fiscal não respondeu à consulta. O status mostrado é o último gravado.";
        }
      } catch (err) {
        console.error("[API][ConsultarNfse] Webhook inacessível:", err);
        aviso = "Não foi possível contatar a integração fiscal. O status mostrado é o último gravado.";
      }

      const depois = await lerNota();
      if (!depois.error && depois.data) nota = depois.data as unknown as NotaDeServicoLida;
    }

    return NextResponse.json(
      {
        success: true,
        consultada,
        aviso,
        situacao: situacaoDoStatus(nota.status),
        nota: { ...nota, numero_nfse: nota.numero_nfse == null ? null : String(nota.numero_nfse) }
      },
      { headers: SEM_CACHE }
    );
  } catch (err) {
    console.error("[API][ConsultarNfse] Erro inesperado:", err);
    return respostaDeErro(500, "Erro inesperado ao consultar a nota de serviço.");
  }
}
