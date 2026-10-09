import { NextResponse } from "next/server";
import { autenticarOperadorExpedicao } from "@/features/expedicao/services/azul-auth.server";
import { carregarContextoAzul } from "@/features/expedicao/services/azul-awb.server";
import { lerConfigAzul, localizarBaseDestino, naturezaProdutoPadrao } from "@/lib/azul/edi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prepara o modal "Emitir AWB Azul": le o pedido, confere as regras e devolve o
 * que a tela pre-preenche. NAO emite nada e NAO grava nada.
 *
 * A unica chamada a Azul daqui e a consulta da base de destino por CEP
 * (LocalizarUnidades), que nao cria nada do lado deles.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { id_int?: number } | null;
  const idInt = Number(body?.id_int);
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "id_int inválido." }, { status: 400 });
  }

  const auth = await autenticarOperadorExpedicao(request);
  if ("resposta" in auth) return auth.resposta;

  const cfg = lerConfigAzul();
  if (!cfg.ok) return NextResponse.json({ success: false, message: cfg.mensagem }, { status: 503 });

  const r = await carregarContextoAzul(auth.ator.supabase, idInt);
  if (!r.ok) return NextResponse.json({ success: false, code: r.code, message: r.message }, { status: r.status });
  const { ctx } = r;

  const baseDestino = await localizarBaseDestino(cfg.config, ctx.cepDestino);
  const d = ctx.destinatario;

  return NextResponse.json({
    success: true,
    ambiente: cfg.config.ambiente,
    nfe: {
      chave: ctx.nota.chave,
      valorTotal: ctx.nota.valorTotal,
      dataEmissao: ctx.nota.dataEmissao,
      origemData: ctx.nota.origemData
    },
    destinatario: {
      nome: d.Nome,
      documento: d.CnpjCpf,
      ie: d.IENumero,
      email: d.Contato.Email,
      telefone: d.Contato.Telefone,
      cidade: d.Endereco.Cidade,
      uf: d.Estado,
      cep: d.Endereco.CEP
    },
    qtdVolumes: ctx.qtdVolumes,
    pesoPorVolumeKg: ctx.pesoPorVolumeKg,
    naturezaPadrao: naturezaProdutoPadrao(),
    baseDestino
  });
}
