/**
 * Rastreio de objetos via fluxo n8n do dono (já pronto).
 * Resposta real (15/08/2026): { sucesso: true, mensagem: "📦 *Rastreamento do
 * Objeto* `AD...BR`\n🔖 *Categoria:* SEDEX\n...🕓 *Eventos:*\n\n╭━━\n┃ 📬 *titulo*\n┃ 📆 data\n┃ 📍 local\n┃ _detalhe_\n╰━━..." }
 * O parser é tolerante: se o formato mudar no n8n, a UI cai no texto bruto.
 */

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
  | { ok: true; mensagemBruta: string; parse: RastroParse }
  | { ok: false; erro: string };

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

export async function rastrearObjeto(codigo: string): Promise<RastroResultado> {
  try {
    const response = await fetch(WEBHOOK_RASTRO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rastro: codigo.trim() })
    });
    if (!response.ok) {
      return { ok: false, erro: `Falha na consulta (HTTP ${response.status}).` };
    }
    const data = (await response.json().catch(() => null)) as { sucesso?: boolean; mensagem?: string } | null;
    if (!data || data.sucesso !== true || typeof data.mensagem !== "string") {
      return { ok: false, erro: data?.mensagem ? String(data.mensagem) : "Resposta inesperada do rastreador." };
    }
    return { ok: true, mensagemBruta: data.mensagem, parse: parseMensagemRastro(data.mensagem) };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Erro de rede ao consultar o rastreio." };
  }
}
