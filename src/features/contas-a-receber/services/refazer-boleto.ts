/**
 * REFAZER BOLETO (C6) — 01/10/2026.
 *
 * POR QUE EXISTE
 *   O Financeiro precisava refazer um boleto já registrado porque faltou
 *   informação (o número da NF, por exemplo), e a única saída era "Cancelar
 *   recebível": o título saía do Contas a Receber, a cobrança voltava para o
 *   Registro de recebíveis e as parcelas tinham de ser lançadas de novo.
 *
 * O QUE FAZ
 *   Troca SÓ o boleto. O recebível — a linha de `boletos` com a parcela, o
 *   valor e o vínculo com a cobrança — continua o mesmo; a cobrança não é
 *   tocada e por isso não volta ao Registro de recebíveis.
 *
 *     1. relê o título e confere se pode (registrado, não pago, não vencido,
 *        empresa do C6);
 *     2. CONSULTA o C6: pago bloqueia; sem resposta também (não dá para
 *        afirmar que não foi pago);
 *     3. cancela o boleto no C6 (pula se o banco já o mostra cancelado);
 *     4. grava o boleto antigo como uma linha de HISTÓRICO, CANCELADO e
 *        anotado como substituído;
 *     5. o título recebe a NF, a descrição e o vencimento corrigidos e fica
 *        SEM registro bancário;
 *     6. registra o boleto novo e grava o que o banco devolveu.
 *
 * POR QUE O TÍTULO É REAPROVEITADO, E NÃO RECRIADO
 *   As escritas vão uma a uma pelo PostgREST, sem transação. Cancelar a linha
 *   antiga e inserir outra deixa uma janela sem volta: antiga cancelada, nova
 *   não criada, e a parcela some do Contas a Receber sem que a cobrança volte
 *   ao Registro. Aqui o ponto sem volta é UMA escrita (o passo 5), e até ela o
 *   título segue na tela como estava — basta clicar em Refazer de novo, que a
 *   consulta vê o boleto já cancelado e não repete o cancelamento. Em nenhum
 *   momento existem duas linhas ativas para a mesma parcela: o histórico já
 *   nasce CANCELADO, fora dos índices únicos `boletos_unico_parcela_ativo` e
 *   `idx_boletos_n_doc_boleto_ativo`.
 *
 * SEM DEPENDÊNCIA DE TELA NEM DE BANCO EMISSOR
 *   Consulta, cancelamento e registro chegam por `DependenciasDoRefazer`. A
 *   tela passa as funções oficiais; o teste passa respostas simuladas
 *   (scripts/testes/refazer-boleto.test.mts) — nenhum boleto real é tocado.
 *
 * SÓ C6. A Ideal Birô (Banco Inter) fica de fora: lá o fluxo de cancelamento
 * apaga a linha do título, e o desenho teria de ser outro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const EMPRESA_BIRO = 2;

export const MENSAGEM_PARCELA_VENCIDA = "Parcela vencida: fale com o Financeiro";

/** Começo da anotação do boleto antigo: a tela reconhece o "substituído" por ele. */
export const MARCA_SUBSTITUIDO = "Substituído pelo Refazer boleto";

/** A linha de `boletos` como o banco a devolve em `select *`. */
export type LinhaBoleto = Record<string, unknown> & { id: string };

export type PedidoDeRefazer = {
  boletoId: string;
  /** Número da NF corrigido. Vazio = boleto sem NF. */
  nNf: string;
  descricao: string;
  /** AAAA-MM-DD. Não pode ser anterior a `hoje`. */
  vencimento: string;
  motivo: string;
  /** AAAA-MM-DD, no fuso da tela. */
  hoje: string;
  usuario: string;
  agoraIso: string;
  /** Nome e documento do pagador lidos do cadastro na hora; ausente = fica o do título. */
  pagador?: { nome?: string | null; documento?: string | null };
};

export type DependenciasDoRefazer = {
  client: SupabaseClient;
  /** Situação do boleto no banco: `status` e `payments`, como o C6 devolve. */
  consultarBanco: (idBoletoBanco: string, idEmpresa: number) => Promise<unknown>;
  /** Cancela no banco. Recusa = exceção com o motivo; não pode alterar nada local. */
  cancelarNoBanco: (boletoId: string, idBoletoBanco: string, idEmpresa: number, motivo: string) => Promise<unknown>;
  /** Registra o título (já corrigido) no banco e devolve os dados do boleto novo. */
  registrarNoBanco: (linha: LinhaBoleto) => Promise<{ data?: Record<string, unknown> | null } | null | undefined>;
  /** PDF do boleto novo. Devolve a falha em texto, ou null se gerou. */
  gerarPdf?: (boletoId: string, idEmpresa: number) => Promise<string | null>;
};

export type ResultadoDoRefazer =
  | {
      ok: false;
      etapa: "VALIDACAO" | "CONSULTA" | "PAGO_NO_BANCO" | "CANCELAMENTO" | "GRAVACAO";
      mensagem: string;
      /** O boleto antigo já foi cancelado no banco quando a falha aconteceu. */
      canceladoNoBanco: boolean;
    }
  | { ok: true; registrado: true; falhaPdf: string | null }
  /** Boleto antigo substituído, mas o novo não foi registrado: título pendente de registro. */
  | { ok: true; registrado: false; erroRegistro: string };

const texto = (valor: unknown) => (valor === null || valor === undefined ? "" : String(valor).trim());
const dia = (valor: unknown) => texto(valor).slice(0, 10);

/**
 * Por que este título não pode ser refeito — ou null quando pode.
 * A mesma regra decide se o item aparece no menu e se a operação roda.
 */
export function motivoDeNaoRefazer(linha: Record<string, unknown>, hoje: string): string | null {
  if (linha.deposito_conta) return "Depósito em conta não tem boleto para refazer.";
  if (Number(linha.id_empresa) === EMPRESA_BIRO) {
    return "O Refazer boleto ainda não vale para a Ideal Birô (Banco Inter).";
  }
  const status = texto(linha.status).toUpperCase();
  if (status === "PAID" || linha.paid_at) return "Título liquidado não pode ser refeito.";
  if (status === "CANCELADO") return "Título cancelado não pode ser refeito.";
  if (!texto(linha.id_boleto_c6)) {
    return 'Este título ainda não tem boleto registrado no banco. Use "Registrar boleto no banco".';
  }
  if (dia(linha.vencimento) < hoje) return MENSAGEM_PARCELA_VENCIDA;
  return null;
}

/**
 * O que gravar no título a partir da resposta do registro. O n8n devolve o
 * objeto do C6 (`id`, `our_number`, `digitable_line`, `bar_code`); os nomes em
 * português cobrem respostas já traduzidas. Mesma leitura do modal de registro.
 */
export function camposDoRetornoBancario(retorno: Record<string, unknown> | null | undefined): Record<string, string> {
  const r = retorno || {};
  const campos: Record<string, string> = {};
  const status = texto(r.status);
  campos.status = ["A_RECEBER", "A_VENCER", "PAID", "CANCELADO"].includes(status) ? status : "A_VENCER";
  const idBoleto = texto(r.id_boleto_c6) || texto(r.id);
  const nossoNumero = texto(r.nosso_numero) || texto(r.our_number);
  const linhaDigitavel = texto(r.linha_digitavel) || texto(r.digitable_line);
  const codigoBarras = texto(r.codigo_barras) || texto(r.bar_code);
  if (idBoleto) campos.id_boleto_c6 = idBoleto;
  if (nossoNumero) campos.nosso_numero = nossoNumero;
  if (linhaDigitavel) campos.linha_digitavel = linhaDigitavel;
  if (codigoBarras) campos.codigo_barras = codigoBarras;
  return campos;
}

function dataHora(agoraIso: string): string {
  return new Date(agoraIso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/**
 * A mensagem de uma falha, em texto de gente. O registro lança o corpo cru da
 * resposta quando o n8n devolve erro (`{"success":false,"message":"..."}`):
 * mostrar isso ao Financeiro esconde o motivo dentro de chaves e aspas.
 */
function mensagemDe(erro: unknown, padrao: string): string {
  const bruta = erro instanceof Error ? erro.message : texto(erro);
  if (!bruta) return padrao;
  if (bruta.trim().startsWith("{")) {
    try {
      const corpo = JSON.parse(bruta) as { message?: unknown; detail?: unknown; error?: unknown };
      const dentro = corpo.error && typeof corpo.error === "object" ? (corpo.error as { message?: unknown }).message : corpo.error;
      return texto(corpo.detail) || texto(corpo.message) || texto(dentro) || bruta;
    } catch {
      return bruta;
    }
  }
  return bruta;
}

export async function refazerBoletoC6(
  pedido: PedidoDeRefazer,
  deps: DependenciasDoRefazer
): Promise<ResultadoDoRefazer> {
  const { client } = deps;
  const falha = (
    etapa: Extract<ResultadoDoRefazer, { ok: false }>["etapa"],
    mensagem: string,
    canceladoNoBanco = false
  ): ResultadoDoRefazer => ({ ok: false, etapa, mensagem, canceladoNoBanco });

  // 1. O título, relido do banco: a tela pode estar velha.
  const { data: lida, error: erroLeitura } = await client
    .from("boletos")
    .select("*")
    .eq("id", pedido.boletoId)
    .maybeSingle();
  if (erroLeitura || !lida) {
    return falha("VALIDACAO", `Título não encontrado${erroLeitura?.message ? `: ${erroLeitura.message}` : "."}`);
  }
  const linha = lida as LinhaBoleto;

  const impedimento = motivoDeNaoRefazer(linha, pedido.hoje);
  if (impedimento) return falha("VALIDACAO", impedimento);

  const motivo = pedido.motivo.trim();
  if (!motivo) return falha("VALIDACAO", "Informe o motivo para refazer o boleto.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pedido.vencimento)) return falha("VALIDACAO", "Informe o vencimento.");
  if (pedido.vencimento < pedido.hoje) return falha("VALIDACAO", "O vencimento não pode ser no passado.");

  const codAntigo = texto(linha.id_boleto_c6);
  const idEmpresa = Number(linha.id_empresa) || 1;

  // 2. O banco manda: pago bloqueia. Sem resposta não se cancela às cegas.
  type SituacaoNoBanco = { status?: unknown; payments?: unknown } | null;
  let detalhes: SituacaoNoBanco;
  try {
    detalhes = (await deps.consultarBanco(codAntigo, idEmpresa)) as SituacaoNoBanco;
  } catch (erro) {
    return falha(
      "CONSULTA",
      `Não foi possível consultar o boleto no C6 (${mensagemDe(erro, "sem resposta")}). Nada foi alterado.`
    );
  }
  const statusBanco = texto(detalhes?.status).toUpperCase();
  const temPagamento = Array.isArray(detalhes?.payments) && detalhes.payments.length > 0;
  if (statusBanco === "PAID" || temPagamento) {
    return falha(
      "PAGO_NO_BANCO",
      'O banco indica este boleto como pago. Refazer bloqueado: use "Consultar pagamento C6" para dar a baixa.'
    );
  }
  if (!statusBanco) {
    return falha("CONSULTA", "O C6 não informou a situação deste boleto. Nada foi alterado.");
  }

  // 3. Cancela no banco — uma vez só: numa segunda tentativa o banco já mostra
  //    o boleto cancelado e este passo é pulado.
  if (!statusBanco.includes("CANCEL")) {
    try {
      await deps.cancelarNoBanco(linha.id, codAntigo, idEmpresa, `Refazer boleto: ${motivo}`);
    } catch (erro) {
      return falha(
        "CANCELAMENTO",
        `${mensagemDe(erro, "O banco recusou o cancelamento.")} Nada foi alterado no Contas a Receber.`
      );
    }
  }

  const quando = dataHora(pedido.agoraIso);
  const nNfNovo = pedido.nNf.trim() || null;
  const descricaoNova = pedido.descricao.trim();
  const tenteDeNovo =
    "O boleto já está cancelado no C6. Clique em Refazer boleto de novo: o cancelamento não se repete.";

  // 4. O boleto antigo vira histórico, já CANCELADO. Numa nova tentativa o
  //    histórico pode já existir: não se grava dois.
  const { data: jaGravado, error: erroHistorico } = await client
    .from("boletos")
    .select("id")
    .eq("id_boleto_c6", codAntigo)
    .eq("status", "CANCELADO")
    .neq("id", linha.id)
    .limit(1);
  if (erroHistorico) {
    return falha("GRAVACAO", `Falha ao conferir o histórico do boleto (${erroHistorico.message}). ${tenteDeNovo}`, true);
  }
  if (!jaGravado || jaGravado.length === 0) {
    const { id: _id, ...copia } = linha;
    void _id;
    const { error: erroInsert } = await client.from("boletos").insert({
      ...copia,
      status: "CANCELADO",
      paid_at: null,
      // O PDF fica num caminho por parcela e será regravado pelo boleto novo.
      url_pdf: null,
      pdf_storage: null,
      motivo_prorg: `${MARCA_SUBSTITUIDO} em ${quando} por ${pedido.usuario}. Motivo: ${motivo}.`
    });
    if (erroInsert) {
      return falha("GRAVACAO", `Falha ao gravar o histórico do boleto antigo (${erroInsert.message}). ${tenteDeNovo}`, true);
    }
  }

  // 5. O título recebe os dados corrigidos e fica sem registro bancário. A
  //    guarda por `id_boleto_c6` impede regravar um título que outra pessoa já
  //    refez ou registrou nesse meio-tempo.
  const mudancas = [
    texto(linha.n_nf) !== texto(nNfNovo) ? `NF ${texto(linha.n_nf) || "S/N"} -> ${nNfNovo || "S/N"}` : null,
    dia(linha.vencimento) !== pedido.vencimento ? `vencimento ${dia(linha.vencimento)} -> ${pedido.vencimento}` : null,
    texto(linha.descricao) !== descricaoNova ? "descrição alterada" : null
  ].filter(Boolean);
  const anotacaoAnterior = texto(linha.motivo_prorg);
  const nomePagador = texto(pedido.pagador?.nome);
  const documentoPagador = texto(pedido.pagador?.documento).replace(/\D/g, "");

  const { data: atualizadas, error: erroUpdate } = await client
    .from("boletos")
    .update({
      n_nf: nNfNovo,
      descricao: descricaoNova,
      vencimento: pedido.vencimento,
      status: "A_VENCER",
      id_boleto_c6: null,
      nosso_numero: null,
      linha_digitavel: null,
      codigo_barras: null,
      url_pdf: null,
      pdf_storage: null,
      ...(nomePagador ? { nome_cliente: nomePagador } : {}),
      ...(documentoPagador ? { documento: documentoPagador } : {}),
      motivo_prorg:
        `Boleto refeito em ${quando} por ${pedido.usuario} (anterior: nosso número ${texto(linha.nosso_numero) || codAntigo}). ` +
        `Motivo: ${motivo}.${mudancas.length > 0 ? ` Alterado: ${mudancas.join("; ")}.` : ""}` +
        (anotacaoAnterior ? ` | ${anotacaoAnterior}` : "")
    })
    .eq("id", linha.id)
    .eq("id_boleto_c6", codAntigo)
    .select("*");
  if (erroUpdate) {
    return falha("GRAVACAO", `Falha ao atualizar o título (${erroUpdate.message}). ${tenteDeNovo}`, true);
  }
  const linhaNova = (atualizadas?.[0] ?? null) as LinhaBoleto | null;
  if (!linhaNova) {
    return falha(
      "GRAVACAO",
      "O título mudou enquanto o boleto era refeito (outra pessoa pode tê-lo alterado). Recarregue a página e confira antes de tentar de novo.",
      true
    );
  }

  // 6. Boleto novo. Falha aqui NÃO desfaz nada: o título fica pendente de
  //    registro, com o botão Registrar, e nunca com dois boletos.
  let registroNoBanco: Record<string, string> | null = null;
  try {
    const retorno = await deps.registrarNoBanco(linhaNova);
    const campos = camposDoRetornoBancario(retorno?.data ?? null);
    if (!campos.id_boleto_c6 && !campos.linha_digitavel) {
      throw new Error("O banco não devolveu os dados do boleto novo.");
    }
    registroNoBanco = campos;
  } catch (erro) {
    return { ok: true, registrado: false, erroRegistro: mensagemDe(erro, "Falha ao registrar o boleto novo.") };
  }

  const { error: erroDadosBanco } = await client.from("boletos").update(registroNoBanco).eq("id", linha.id);
  if (erroDadosBanco) {
    // O boleto EXISTE no banco; só o que ele devolveu não foi gravado. Registrar
    // de novo criaria um segundo boleto para a mesma parcela.
    return {
      ok: true,
      registrado: false,
      erroRegistro:
        `O boleto novo foi registrado no C6 (identificador ${registroNoBanco.id_boleto_c6 || "não informado"}), ` +
        `mas os dados dele não foram gravados: ${erroDadosBanco.message}. NÃO registre de novo — avise o suporte.`
    };
  }

  let falhaPdf: string | null = null;
  if (deps.gerarPdf) {
    try {
      falhaPdf = await deps.gerarPdf(linha.id, idEmpresa);
    } catch (erro) {
      falhaPdf = mensagemDe(erro, "Falha ao gerar o PDF.");
    }
  }

  return { ok: true, registrado: true, falhaPdf };
}
