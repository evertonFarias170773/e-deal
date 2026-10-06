import { NextResponse } from "next/server";
import {
  autenticarEmissorDeNfse,
  clienteDeServico,
  lerContextoNfseDoPedido,
  lerIdInt,
  lerServicosNfse,
  respostaDeErro
} from "@/features/nfse/services/nfse-pedido.server";
import {
  SERVICO_NFSE,
  conferirDescricao,
  conferirEndereco,
  conferirServico,
  conferirValor,
  decisaoPermiteRascunhoNovo
} from "@/features/nfse/lib/regras-emissao";

/**
 * Rascunho de NFS-e a partir de um pedido da Fila.
 *
 *   GET  ?id_int=N  o que a janela "Gerar NFS-e" mostra, relido no servidor:
 *                   tomador, empresa e ambiente, endereços (com o aviso de
 *                   município não reconhecido), descrição sugerida, as notas de
 *                   serviço que o pedido já tem e o que pode ser feito com ele.
 *   POST            cria o rascunho — ou devolve o que já existe.
 *
 * POR QUE PELO SERVIDOR
 *   `fn_criar_rascunho_nfse` só executa como servidor (migration
 *   20261005_nfse_funcoes_escrita_so_servidor): ela é SECURITY DEFINER, escreve
 *   em `notas_servico` e não confere quem chama. Quem confere é esta rota —
 *   sessão e `fiscal.emit_nfse` — ANTES de usar a chave de serviço.
 *
 * O QUE VEM DO NAVEGADOR
 *   Só o pedido, o endereço escolhido, o serviço escolhido, a descrição e o
 *   valor. Cliente, empresa e autor saem do banco e da sessão. O serviço é
 *   relido de `nfse_servicos_padrao`: tem de existir, estar ativo e ter código
 *   de tributação e NBS válidos (`conferirServico`).
 *
 * EMPRESA
 *   Lista fechada no código (`EMPRESAS_NFSE_LIBERADAS`, hoje só a Ideal Birô).
 *   O cadastro da empresa não libera ninguém.
 *
 * NÃO EMITE. Quem transmite é `/api/fiscal/emitir-nfse`, com a `ref` devolvida.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEM_CACHE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    const sessao = await autenticarEmissorDeNfse(request);
    if (sessao instanceof NextResponse) return sessao;

    const idInt = lerIdInt(new URL(request.url).searchParams.get("id_int"));
    if (!idInt) return respostaDeErro(400, "Número do pedido ausente.");

    const lido = await lerContextoNfseDoPedido(sessao.supabase, clienteDeServico(), idInt);
    if (!lido.ok) return respostaDeErro(lido.status, lido.message);

    return NextResponse.json({ success: true, ...lido.contexto }, { headers: SEM_CACHE });
  } catch (err) {
    console.error("[API][RascunhoNfse] Erro inesperado na leitura:", err);
    return respostaDeErro(500, "Erro inesperado ao ler os dados da NFS-e.");
  }
}

export async function POST(request: Request) {
  try {
    const sessao = await autenticarEmissorDeNfse(request);
    if (sessao instanceof NextResponse) return sessao;

    let corpo: Record<string, unknown>;
    try {
      corpo = (await request.json()) as Record<string, unknown>;
    } catch {
      return respostaDeErro(400, "Corpo da requisição inválido.");
    }

    const idInt = lerIdInt(corpo?.id_int);
    if (!idInt) return respostaDeErro(400, "Número do pedido ausente.");

    const servico = clienteDeServico();
    if (!servico) {
      console.error("[API][RascunhoNfse] SUPABASE_SERVICE_ROLE_KEY ausente.");
      return respostaDeErro(503, "A criação de NFS-e está indisponível neste servidor.");
    }

    const lido = await lerContextoNfseDoPedido(sessao.supabase, servico, idInt);
    if (!lido.ok) return respostaDeErro(lido.status, lido.message);
    const { empresa, tomador, enderecos, decisao } = lido.contexto;

    if (!empresa.liberada) {
      return respostaDeErro(422, `A emissão de NFS-e pelo Vibe não está liberada para ${empresa.nome}.`, {
        code: "EMPRESA_NAO_LIBERADA"
      });
    }

    // O que o pedido já tem decide ANTES de qualquer dado digitado.
    if (decisao.acao === "MOSTRAR_AUTORIZADA") {
      return respostaDeErro(409, `Este pedido já tem NFS-e autorizada${decisao.nota.numero_nfse ? ` (nº ${decisao.nota.numero_nfse})` : ""}.`, {
        code: "NFSE_JA_AUTORIZADA",
        ref: decisao.nota.ref
      });
    }
    if (decisao.acao === "EM_ANALISE") {
      return respostaDeErro(409, `A NFS-e ${decisao.nota.ref} deste pedido está em análise. Aguarde o desfecho antes de criar outra.`, {
        code: "NFSE_EM_ANALISE",
        ref: decisao.nota.ref
      });
    }

    // Rascunho ou envio com erro: devolve a MESMA nota, a não ser que quem emite
    // peça outra (rascunho não se edita; errou, cria outro).
    const pediuNovo = corpo?.novo === true;
    if (decisao.acao !== "CRIAR" && !(pediuNovo && decisaoPermiteRascunhoNovo(decisao.acao))) {
      return NextResponse.json(
        {
          success: true,
          criado: false,
          acao: decisao.acao,
          ref: decisao.nota.ref,
          status: decisao.nota.status
        },
        { headers: SEM_CACHE }
      );
    }

    if (!tomador.idCliente) {
      return respostaDeErro(422, "O pedido não tem cliente cadastrado. Vincule o cliente ao pedido antes de gerar a NFS-e.", {
        code: "TOMADOR_NAO_INFORMADO"
      });
    }
    if (!tomador.documentoOk) {
      return respostaDeErro(422, "O cliente não tem CPF (11 dígitos) ou CNPJ (14 dígitos) no cadastro. Corrija o cadastro antes de gerar a NFS-e.", {
        code: "DOCUMENTO_TOMADOR_INVALIDO"
      });
    }

    const endereco = conferirEndereco(corpo?.id_endereco, enderecos.map((e) => e.id));
    if (!endereco.ok) return respostaDeErro(422, endereco.motivo, { code: "ENDERECO_INVALIDO" });

    const descricao = conferirDescricao(corpo?.descricao);
    if (!descricao.ok) return respostaDeErro(422, descricao.motivo, { code: "DESCRICAO_INVALIDA" });

    const valor = conferirValor(corpo?.valor);
    if (!valor.ok) return respostaDeErro(422, valor.motivo, { code: "VALOR_INVALIDO" });

    // O serviço escolhido, relido do cadastro (inativos inclusive, para a recusa
    // dizer o motivo certo). Sem escolha, vale o padrão.
    const idServico = lerIdInt(corpo?.id_servico ?? SERVICO_NFSE.id);
    if (!idServico) return respostaDeErro(422, "Serviço da NFS-e inválido.", { code: "SERVICO_INVALIDO" });
    const servicoEscolhido = (await lerServicosNfse(servico, { soAtivos: false })).find((s) => s.id === idServico) ?? null;
    const servicoConferido = conferirServico(servicoEscolhido);
    if (!servicoConferido.ok) return respostaDeErro(422, servicoConferido.motivo, { code: "SERVICO_INVALIDO" });

    const { data, error } = await servico.rpc("fn_criar_rascunho_nfse", {
      p_id_int: idInt,
      p_id_empresa: empresa.id,
      p_id_cliente: tomador.idCliente,
      p_id_servico_padrao: idServico,
      p_valor_servicos: valor.valor,
      p_discriminacao: descricao.texto,
      p_criado_por_nome: sessao.nomeDoUsuario,
      p_id_endereco_tomador: endereco.idEndereco
    });

    if (error) {
      console.error("[API][RascunhoNfse] fn_criar_rascunho_nfse falhou:", error.message);
      return respostaDeErro(500, "Não foi possível criar o rascunho da NFS-e no banco.");
    }

    const retorno = (data ?? null) as { ok?: boolean; ref?: string; id?: string; erro?: string; mensagem?: string } | null;
    if (!retorno || retorno.ok !== true || !retorno.ref) {
      return respostaDeErro(422, retorno?.mensagem || "O banco recusou a criação do rascunho da NFS-e.", {
        code: retorno?.erro ?? "RASCUNHO_RECUSADO"
      });
    }

    console.info(`[API][RascunhoNfse] Rascunho ${retorno.ref} criado para o pedido ${idInt} por ${sessao.userId}.`);
    return NextResponse.json(
      { success: true, criado: true, acao: "REABRIR_RASCUNHO", ref: retorno.ref, status: "PENDENTE" },
      { headers: SEM_CACHE }
    );
  } catch (err) {
    console.error("[API][RascunhoNfse] Erro inesperado:", err);
    return respostaDeErro(500, "Erro inesperado ao criar o rascunho da NFS-e.");
  }
}
