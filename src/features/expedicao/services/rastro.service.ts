/**
 * Rastreio de objeto para a tela de Expedição.
 *
 * DUAS FONTES, NESTA ORDEM
 *   1. `/api/expedicao/correios/rastro` — a API oficial dos Correios, pelo nosso
 *      próprio servidor, varrendo os contratos das empresas até achar o objeto.
 *      É a fonte autoritativa e a única que enxerga Birô e E3.
 *   2. o fluxo n8n do dono — reserva para o que a primeira não cobre: código de
 *      transportadora, objeto de contrato que não é nosso, ou indisponibilidade.
 *
 * POR QUE MUDOU
 *   Antes só existia o n8n, com UMA credencial. Objeto de Birô ou E3 voltava
 *   `200` com corpo vazio, e a tela dizia "Resposta inesperada do rastreador" —
 *   uma mensagem que não distingue "objeto de outro contrato" de "rastreador
 *   fora do ar" e mandou duas sessões de investigação para o lugar errado.
 *   Agora cada desfecho tem mensagem própria, e o erro só aparece depois que
 *   TODAS as fontes falharam.
 */

import { getSupabaseClient } from "@/lib/supabase/client";
import { EVENTOS_ENTREGUE } from "@/lib/correios/eventos";

const WEBHOOK_RASTRO = "https://10074.hostoo.net.br/webhook/rastro-e-deal-todos";

export type RastroEvento = {
  titulo: string;
  data: string | null;
  local: string | null;
  detalhe: string | null;
};

export type RastroParse = {
  resumo: Record<string, string>;
  eventos: RastroEvento[];
  entregue: boolean;
};

export type RastroResultado =
  | {
      ok: true;
      /** De onde veio o dado — a tela mostra, para o expedidor saber no que confiar. */
      fonte: "correios" | "n8n";
      /** Nome da empresa cujo contrato reconheceu o objeto (só na fonte Correios). */
      empresaNome: string | null;
      mensagemBruta: string;
      parse: RastroParse;
    }
  | { ok: false; erro: string; detalhe: string | null };

/** Remove os asteriscos de negrito do WhatsApp e espaços das bordas. */
function limpar(texto: string): string {
  return texto.replace(/\*/g, "").trim();
}

export function parseMensagemRastro(mensagem: string): RastroParse {
  const resumo: Record<string, string> = {};
  const eventos: RastroEvento[] = [];

  const [cabecalho, ...blocos] = mensagem.split("╭");

  // Cabeçalho: linhas "emoji *Rótulo:* valor"
  for (const linha of cabecalho.split("\n")) {
    const m = linha.match(/\*([^*]+):\*\s*(.+)$/);
    if (m) resumo[limpar(m[1])] = limpar(m[2]);
  }

  // Eventos: blocos entre ╭ e ╰, linhas iniciadas por ┃
  for (const bloco of blocos) {
    const linhas = bloco
      .split("\n")
      .map((l) => l.replace(/^[╭╰┃━\s]+/u, "").trim())
      .filter((l) => l !== "" && !/^[━╌]+$/u.test(l));
    if (linhas.length === 0) continue;
    const evento: RastroEvento = { titulo: "", data: null, local: null, detalhe: null };
    for (const linha of linhas) {
      if (linha.startsWith("📆")) evento.data = limpar(linha.replace("📆", ""));
      else if (linha.startsWith("📍")) evento.local = limpar(linha.replace("📍", ""));
      else if (linha.startsWith("_") || linha.endsWith("_")) evento.detalhe = limpar(linha.replace(/_/g, ""));
      else if (!evento.titulo) evento.titulo = limpar(linha.replace(/^[^\p{L}\p{N}]+/u, ""));
    }
    if (evento.titulo) eventos.push(evento);
  }

  const textoSituacao = `${resumo["Status"] ?? ""} ${resumo["Situação atual"] ?? ""} ${eventos[0]?.titulo ?? ""}`;
  const t = textoSituacao.toLowerCase();
  // "Objeto entregue ao destinatário" conta; "não entregue"/"nao entregue" NÃO conta.
  const entregue = t.includes("entregue") && !/n[ãa]o\s+entregue/.test(t);

  return { resumo, eventos, entregue };
}

/** "2026-08-19T11:58:55" → "19/08/2026, 11:58". Entrada inválida volta como veio. */
function formatarDataHora(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}, ${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

type ObjetoCorreios = {
  codigo: string;
  categoria: string | null;
  eventos: Array<{ chave: string; descricao: string; detalhe: string | null; dataHora: string | null; local: string | null }>;
};

/**
 * Resposta estruturada dos Correios → a mesma forma que a tela já desenha.
 *
 * `entregue` sai do CÓDIGO do evento (BDE/BDI/BDR-1|67|68|70, lista única em
 * `lib/correios/eventos.ts`), não de heurística de texto: é o mesmo critério que
 * o receiver do webhook usa para marcar ENTREGUE sozinho, então tela e webhook
 * não podem discordar.
 */
function parseObjetoCorreios(objeto: ObjetoCorreios): RastroParse {
  const eventos: RastroEvento[] = objeto.eventos.map((ev) => ({
    titulo: ev.descricao,
    data: formatarDataHora(ev.dataHora),
    local: ev.local,
    detalhe: ev.detalhe
  }));

  const ultimo = objeto.eventos[0];
  const resumo: Record<string, string> = {};
  if (objeto.categoria) resumo["Categoria"] = objeto.categoria;
  if (ultimo?.descricao) resumo["Situação atual"] = ultimo.descricao;
  if (ultimo?.local) resumo["Local atual"] = ultimo.local;
  const quando = formatarDataHora(ultimo?.dataHora ?? null);
  if (quando) resumo["Última atualização"] = quando;

  return { resumo, eventos, entregue: objeto.eventos.some((ev) => EVENTOS_ENTREGUE.has(ev.chave)) };
}

async function tokenSessao(): Promise<string | null> {
  const client = getSupabaseClient();
  const sessionResult = client ? await client.auth.getSession() : null;
  return sessionResult?.data?.session?.access_token ?? null;
}

/** Consulta o n8n. Usada como reserva; devolve null quando não tem o objeto. */
async function tentarN8n(codigo: string): Promise<{ mensagem: string } | null> {
  try {
    const response = await fetch(WEBHOOK_RASTRO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rastro: codigo })
    });
    if (!response.ok) return null;
    const data = (await response.json().catch(() => null)) as { sucesso?: boolean; mensagem?: string } | null;
    if (!data || data.sucesso !== true || typeof data.mensagem !== "string") return null;
    return { mensagem: data.mensagem };
  } catch {
    return null;
  }
}

export async function rastrearObjeto(codigoBruto: string, idInt?: number): Promise<RastroResultado> {
  const codigo = codigoBruto.trim();
  if (!codigo) {
    return { ok: false, erro: "Este pedido não tem código de rastreio.", detalhe: null };
  }

  // 1ª fonte: Correios, pelo nosso servidor, varrendo os contratos.
  let motivoCorreios: string | null = null;
  let mensagemCorreios: string | null = null;
  const token = await tokenSessao();
  if (token) {
    try {
      const qs = new URLSearchParams({ codigo });
      if (idInt && idInt > 0) qs.set("id_int", String(idInt));
      const res = await fetch(`/api/expedicao/correios/rastro?${qs}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = (await res.json().catch(() => null)) as
        | { success?: boolean; objeto?: ObjetoCorreios; empresaNome?: string | null; motivo?: string; message?: string }
        | null;

      if (res.ok && data?.success && data.objeto) {
        return {
          ok: true,
          fonte: "correios",
          empresaNome: data.empresaNome ?? null,
          mensagemBruta: JSON.stringify(data.objeto, null, 2),
          parse: parseObjetoCorreios(data.objeto)
        };
      }
      motivoCorreios = data?.motivo ?? `HTTP_${res.status}`;
      mensagemCorreios = data?.message ?? `Consulta aos Correios falhou (HTTP ${res.status}).`;
    } catch (e) {
      motivoCorreios = "REDE";
      mensagemCorreios = e instanceof Error ? e.message : "Falha de rede ao consultar os Correios.";
    }
  } else {
    motivoCorreios = "SESSAO";
    mensagemCorreios = "Sessão expirada. Faça login novamente.";
  }

  // Sessão e permissão não se resolvem tentando outra fonte.
  if (motivoCorreios === "SESSAO" || motivoCorreios === "PERMISSAO") {
    return { ok: false, erro: mensagemCorreios ?? "Sem acesso ao rastreio.", detalhe: null };
  }

  // 2ª fonte: o fluxo do n8n. Só chega aqui se os Correios não tiverem o objeto.
  const n8n = await tentarN8n(codigo);
  if (n8n) {
    return {
      ok: true,
      fonte: "n8n",
      empresaNome: null,
      mensagemBruta: n8n.mensagem,
      parse: parseMensagemRastro(n8n.mensagem)
    };
  }

  // Nenhuma fonte respondeu: agora sim é erro, com o motivo real.
  return {
    ok: false,
    erro: mensagemCorreios ?? "Não foi possível rastrear este objeto.",
    detalhe: "O rastreador externo também não retornou dados para este código."
  };
}
