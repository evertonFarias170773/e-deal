import { promises as fs } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { executarRelatorio } from "@/features/relatorios/relatorio.server";
import { SLUG_PAGAMENTO_COMISSAO } from "@/features/relatorios/definicoes/pagamento-comissao";
import { ehBaseComissao, ROTULO_BASE } from "@/features/relatorios/lib/comissao";
import { ehDataIso } from "@/features/relatorios/lib/periodo";
import { criarReciboComissaoElement } from "@/features/relatorios/pdf/ReciboComissaoPdf";
import { EMPRESA_LOGO_FILES, type EmpresaId } from "@/features/pedidos/pdf/os-pdf-assets";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDataCivil } from "@/lib/formatters/date";

/**
 * GET /api/relatorios/pagamento-comissao/recibo?ini&fim&base&vendedor&empresa[&forma][&data]
 *
 * Recibo de comissão de um vendedor, em PDF A4 (03/11/2026). Passa pelo mesmo caminho da tela
 * (`executarRelatorio`): mesma sessão, mesma permissão (`relatorios.vendas_pagas`), mesmo período
 * e a conta refeita no servidor, então o valor do recibo é o da linha da tela. O navegador manda
 * só o vendedor, a empresa e a base; nenhum valor vem dele.
 *
 * Empresa: razão social, CNPJ e endereço do cadastro `empresas`; logo de `public/logos` (a mesma
 * do PDF da OS). Somente leitura: nada é gravado, não há histórico de emissão.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type EmpresaLinha = {
  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  cep: string | null;
};

const erro = (status: number, mensagem: string) => NextResponse.json({ success: false, error: mensagem }, { status });

function formatarCnpj(cnpj: string | null) {
  const d = String(cnpj ?? "").replace(/\D/g, "");
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : String(cnpj ?? "");
}

function formatarCep(cep: string | null) {
  const d = String(cep ?? "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : String(cep ?? "");
}

/** "Porto Alegre" a partir de "PORTO ALEGRE" ou "Porto Alegre". */
function nomeDeCidade(texto: string) {
  const minusculas = new Set(["de", "da", "do", "das", "dos", "e"]);
  return texto
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

function dataPorExtenso(iso: string) {
  const [a, m, d] = iso.split("-").map(Number);
  const mes = new Date(Date.UTC(a, m - 1, d)).toLocaleString("pt-BR", { month: "long", timeZone: "UTC" });
  return `${d} de ${mes} de ${a}`;
}

const percentual = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (slug !== SLUG_PAGAMENTO_COMISSAO) return erro(404, "Este relatório não tem recibo.");

  const query = request.nextUrl.searchParams;
  const base = query.get("base") ?? "";
  const vendedor = (query.get("vendedor") ?? "").trim();
  const idEmpresa = Number(query.get("empresa"));
  const forma = (query.get("forma") ?? "").trim();
  const data = (query.get("data") ?? "").trim();
  if (!ehBaseComissao(base)) return erro(400, "Escolha a base da comissão.");
  if (!vendedor || vendedor.length > 120) return erro(400, "Vendedor inválido.");
  if (![1, 2, 3].includes(idEmpresa)) return erro(400, "Escolha a empresa.");
  if (forma.length > 60) return erro(400, "Forma de pagamento longa demais.");
  if (data && !ehDataIso(data)) return erro(400, "Data do pagamento inválida.");

  // Sessão, permissão, período e a conta da tela (com a base pedida, que é filtro do relatório).
  const resposta = await executarRelatorio(request, slug);
  if (!resposta.ok) return erro(resposta.status, resposta.error);
  const { resultado, consulta, usuario, supabase } = resposta;

  const linha = resultado.linhas.find((l) => l.vendedor === vendedor);
  if (!linha || linha.comissao === null || linha.comissao === undefined) {
    return erro(404, "Vendedor sem venda neste período.");
  }

  const { data: empresaLida, error: erroEmpresa } = await supabase
    .from("empresas")
    .select("razao_social, nome_fantasia, cnpj, logradouro, numero, bairro, municipio, uf, cep")
    .eq("id", idEmpresa)
    .maybeSingle();
  const empresa = empresaLida as EmpresaLinha | null;
  if (erroEmpresa || !empresa) return erro(500, "Não foi possível ler os dados da empresa.");

  let logo: string | null = null;
  try {
    const arquivo = EMPRESA_LOGO_FILES[idEmpresa as EmpresaId];
    const conteudo = await fs.readFile(path.join(process.cwd(), "public", "logos", arquivo));
    logo = `data:${arquivo.endsWith(".png") ? "image/png" : "image/jpeg"};base64,${conteudo.toString("base64")}`;
  } catch (e) {
    console.warn("[relatorios/recibo] logo da empresa não carregou (o recibo sai sem ela):", e);
  }

  const cidade = nomeDeCidade(String(empresa.municipio ?? "").trim());
  const juntar = (partes: (string | null)[], separador: string) =>
    partes.map((p) => String(p ?? "").trim()).filter(Boolean).join(separador);
  const endereco = [
    juntar([juntar([empresa.logradouro, empresa.numero], ", "), empresa.bairro], " · "),
    juntar([juntar([cidade, empresa.uf], "/"), empresa.cep ? `CEP ${formatarCep(empresa.cep)}` : null], " · ")
  ].filter(Boolean);

  const total = Number(base === "COM_FRETE" ? linha.com_frete : linha.sem_frete);
  const qtd = Number(linha.qtd_pedidos ?? 0);
  const pdf = await renderToBuffer(
    criarReciboComissaoElement({
      empresa: {
        razaoSocial: String(empresa.razao_social || empresa.nome_fantasia || "").trim(),
        cnpj: formatarCnpj(empresa.cnpj),
        endereco,
        logo
      },
      vendedor,
      periodo: `${formatDataCivil(consulta.inicio)} a ${formatDataCivil(consulta.fim)}`,
      base: ROTULO_BASE[base],
      qtdPedidos: `${qtd} ${qtd === 1 ? "pedido" : "pedidos"}`,
      totalVendas: formatCurrency(total),
      percentual: percentual(Number(linha.percentual)),
      comissao: formatCurrency(Number(linha.comissao)),
      forma: forma || null,
      dataPagamento: data ? formatDataCivil(data) : null,
      local: { cidade: cidade || "Porto Alegre", dataExtenso: data ? dataPorExtenso(data) : null },
      geradoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
      geradoPor: usuario.nome
    })
  );

  const nomeArquivo = `recibo-comissao_${consulta.inicio}_a_${consulta.fim}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nomeArquivo}"`,
      "Cache-Control": "no-store"
    }
  });
}
