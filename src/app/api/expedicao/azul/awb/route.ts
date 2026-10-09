import { NextResponse } from "next/server";
import { autenticarOperadorExpedicao } from "@/features/expedicao/services/azul-auth.server";
import { carregarContextoAzul, type ParticipanteAzul } from "@/features/expedicao/services/azul-awb.server";
import {
  SERVICOS_AZUL,
  TIPOS_ENTREGA_AZUL,
  validarNaturezaProduto,
  validarVolumes,
  type ServicoAzul,
  type TipoEntregaAzul,
  type VolumeAzul
} from "@/features/expedicao/lib/azul-awb";
import { chamarAzul, lerConfigAzul, localizarBaseDestino } from "@/lib/azul/edi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Emite a AWB da Azul Logistica para uma expedicao.
 *
 * A EMISSAO CRIA CONTRATO E COBRANCA REAIS e a API nao tem chave de
 * idempotencia: UMA AWB POR EXPEDICAO, sem excecao. Por isso a ordem e fixa:
 *
 *   1. valida tudo (permissao, regras, corpo) — nada escrito ainda;
 *   2. RESERVA no banco com UPDATE condicional (azul_awb nula e azul_status
 *      nulo -> EMITINDO), decidindo pela linha que o proprio UPDATE devolve (RETURNING), nao por contagem.
 *      Duplo clique ou segunda aba perdem aqui, antes de falar com a Azul;
 *   3. chama a Azul;
 *   4. HasErrors=true -> libera a reserva e devolve o ErrorText, sem AWB;
 *      timeout/queda/5xx -> marca INCERTA e NAO libera (alguem confere na Azul);
 *      sucesso -> grava a AWB com UPDATE condicional (status EMITINDO e AWB nula).
 *
 * Nunca loga senha, token nem o payload; so o numero do pedido e o desfecho.
 */

type CorpoEmissao = {
  id_int?: number;
  servico?: string;
  tipo_entrega?: string;
  natureza?: string;
  unidade_destino?: string;
  volumes?: Array<Partial<VolumeAzul>>;
  destinatario?: { ie?: string; isento?: boolean; email?: string; telefone?: string };
};

const erro = (message: string, status: number, extra?: Record<string, unknown>) =>
  NextResponse.json({ success: false, message, ...extra }, { status });

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as CorpoEmissao | null;
  const idInt = Number(body?.id_int);
  if (!body || !Number.isInteger(idInt) || idInt <= 0) return erro("id_int inválido.", 400);

  const auth = await autenticarOperadorExpedicao(request);
  if ("resposta" in auth) return auth.resposta;
  const { supabase, nome } = auth.ator;

  const cfg = lerConfigAzul();
  if (!cfg.ok) return erro(cfg.mensagem, 503);
  const config = cfg.config;

  // Corpo: nada de valor padrao — o operador informa servico, entrega, natureza e volumes.
  const servico = SERVICOS_AZUL.find((s) => s === body.servico) as ServicoAzul | undefined;
  if (!servico) return erro("Escolha o serviço (EXPRESSO ou STANDARD).", 400);
  const tipoEntrega = TIPOS_ENTREGA_AZUL.find((t) => t === body.tipo_entrega) as TipoEntregaAzul | undefined;
  if (!tipoEntrega) return erro("Escolha o tipo de entrega (Domicílio ou Aeroporto).", 400);

  const natureza = String(body.natureza ?? "").trim();
  const erroNatureza = validarNaturezaProduto(natureza);
  if (erroNatureza) return erro(erroNatureza, 422);

  const volumes: VolumeAzul[] = (Array.isArray(body.volumes) ? body.volumes : []).map((v) => ({
    altura: Number(v.altura),
    largura: Number(v.largura),
    comprimento: Number(v.comprimento),
    pesoKg: Number(v.pesoKg),
    quantidade: Number(v.quantidade)
  }));
  const erroVolumes = validarVolumes(volumes);
  if (erroVolumes) return erro(erroVolumes, 422);

  // Regras do pedido (CIF, NF-e, sem AWB, cadastros completos).
  const r = await carregarContextoAzul(supabase, idInt);
  if (!r.ok) return erro(r.message, r.status, { code: r.code });
  const { ctx } = r;

  // Completa so o que o cadastro nao tem, e so com o que o operador digitou.
  const ieInformada = body.destinatario?.isento ? "ISENTO" : String(body.destinatario?.ie ?? "").trim();
  const destinatario: ParticipanteAzul = {
    ...ctx.destinatario,
    IENumero: ctx.destinatario.IENumero || ieInformada,
    Contato: {
      ...ctx.destinatario.Contato,
      Email: ctx.destinatario.Contato.Email || String(body.destinatario?.email ?? "").trim(),
      Telefone: ctx.destinatario.Contato.Telefone || String(body.destinatario?.telefone ?? "").trim()
    }
  };
  // O operador pode corrigir a IE do cadastro no modal.
  if (ieInformada) destinatario.IENumero = ieInformada;
  if (!destinatario.IENumero) return erro("Informe a inscrição estadual do destinatário ou marque Isento.", 422, { code: "SEM_IE" });
  if (!destinatario.Contato.Email) return erro("Informe o e-mail do destinatário.", 422, { code: "SEM_EMAIL" });
  if (!destinatario.Contato.Telefone) return erro("Informe o telefone do destinatário.", 422, { code: "SEM_TELEFONE" });

  let unidadeDestino = String(body.unidade_destino ?? "").trim().toUpperCase();
  if (!unidadeDestino) unidadeDestino = (await localizarBaseDestino(config, ctx.cepDestino)) ?? "";
  if (!unidadeDestino) {
    return erro("Não localizei a base de destino da Azul para este CEP. Informe a sigla da base no modal.", 422, { code: "SEM_BASE" });
  }

  // 2. RESERVA. Condicional: so passa quem ve a AWB nula e nenhuma emissao em curso.
  const { data: reservada, error: erroReserva } = await supabase
    .from("expedicoes")
    .update({ azul_status: "EMITINDO" })
    .eq("id_int", idInt)
    .is("azul_awb", null)
    .is("azul_status", null)
    .select("id_int")
    .maybeSingle();
  if (erroReserva) return erro("Não foi possível reservar a emissão. Nada foi enviado à Azul.", 500);
  if (!reservada) {
    return erro("Já existe emissão em andamento, incerta ou concluída para este pedido. Recarregue a tela.", 409, { code: "RESERVA_NEGADA" });
  }

  const tomador: ParticipanteAzul = { ...ctx.emitente, Tipo: "Tomador" };
  const payload: Record<string, unknown> = {
    FormaPagamento: "PX",
    ContaCorrente: config.contaCnpj,
    TipoEntrega: tipoEntrega,
    SiglaServico: servico,
    UnidadeOrigemSigla: config.unidadeOrigem,
    UnidadeDestinoSigla: unidadeDestino,
    ProdutoNatureza: natureza,
    SeguroProprio: config.seguroProprio,
    ...(config.seguroApolice ? { SeguroApolice: config.seguroApolice } : {}),
    ListaDocumentos: [
      {
        TipoDocumento: "NFe",
        DataEmissao: ctx.nota.dataEmissao,
        ValorTotal: ctx.nota.valorTotal,
        ChaveAcesso: ctx.nota.chave
      }
    ],
    ListaEmbalagens: volumes.map((v, i) => ({
      ItemNumero: i + 1,
      Altura: v.altura,
      Largura: v.largura,
      Comprimento: v.comprimento,
      PesoRealUnitario: v.pesoKg,
      Quantidade: v.quantidade
    })),
    ListaParticipantes: [ctx.emitente, destinatario, tomador]
  };

  const liberarReserva = async () => {
    const { error } = await supabase
      .from("expedicoes")
      .update({ azul_status: null })
      .eq("id_int", idInt)
      .eq("azul_status", "EMITINDO")
      .is("azul_awb", null);
    if (error) console.error(`[azul-awb] #${idInt}: reserva NAO liberada apos recusa da Azul (azul_status segue EMITINDO).`);
  };
  const marcarIncerta = async () => {
    const { error } = await supabase
      .from("expedicoes")
      .update({ azul_status: "INCERTA" })
      .eq("id_int", idInt)
      .eq("azul_status", "EMITINDO")
      .is("azul_awb", null);
    if (error) console.error(`[azul-awb] #${idInt}: nao consegui marcar INCERTA (azul_status segue EMITINDO).`);
  };

  // 3. Chamada a Azul.
  const resposta = await chamarAzul(config, "/api/EmissaoAWB/Enviar", payload);

  // 4a. Recusa: nada foi criado la. Libera e mostra o texto da Azul.
  if (resposta.desfecho === "erro") {
    await liberarReserva();
    console.warn(`[azul-awb] #${idInt}: recusada pela Azul (${config.ambiente}).`);
    return erro(resposta.texto, 422, { code: "AZUL_RECUSOU" });
  }

  // 4b. Sem resposta: a Azul pode ter criado a AWB. NAO libera sozinho.
  const awb = resposta.desfecho === "ok" ? String(resposta.value ?? "").trim() : "";
  if (resposta.desfecho === "incerto" || !awb) {
    await marcarIncerta();
    console.warn(`[azul-awb] #${idInt}: emissao INCERTA (${config.ambiente}).`);
    return erro(
      "Emissão incerta: a Azul não respondeu com a AWB. Confira no portal da Azul se ela foi criada antes de tentar de novo. " +
        "O pedido fica travado até essa conferência.",
      502,
      { code: "INCERTA" }
    );
  }

  // 4c. Sucesso: grava com UPDATE condicional.
  const { data: gravada, error: erroGravar } = await supabase
    .from("expedicoes")
    .update({ azul_awb: awb, azul_status: "EMITIDA", azul_emitida_em: new Date().toISOString(), azul_emitida_por: nome })
    .eq("id_int", idInt)
    .eq("azul_status", "EMITINDO")
    .is("azul_awb", null)
    .select("id_int")
    .maybeSingle();
  if (erroGravar || !gravada) {
    await marcarIncerta();
    console.error(`[azul-awb] #${idInt}: AWB ${awb} emitida na Azul mas NAO gravada.`);
    return erro(
      `A Azul emitiu a AWB ${awb}, mas não consegui gravá-la no pedido. Anote o número e avise o suporte; o pedido ficou travado.`,
      500,
      { code: "AWB_NAO_GRAVADA", awb }
    );
  }

  console.info(`[azul-awb] #${idInt}: AWB emitida (${config.ambiente}).`);
  return NextResponse.json({ success: true, awb, ambiente: config.ambiente });
}
