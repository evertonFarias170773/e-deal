"use client";

/**
 * Janela "Gerar NFS-e" — abre no botão "NFS-e" da Fila de Notas Fiscais.
 *
 * A janela NÃO escreve em `notas_servico`. Ela conversa com três rotas:
 *   - `/api/fiscal/rascunho-nfse`  GET lê o pedido; POST cria o rascunho;
 *   - `/api/fiscal/emitir-nfse`    a rota oficial de emissão, com a `ref`;
 *   - `/api/fiscal/consultar-nfse` acompanha, devolvendo o status DO BANCO;
 *   - `/api/fiscal/nfse-arquivo`   baixa o PDF ou o XML da nota autorizada.
 *
 * O que ela mostra depende do que o pedido já tem (`decidirNfseDoPedido`, a
 * mesma função que as rotas usam):
 *   sem nota viva        → composição (endereço, serviço, itens, valor, descrição);
 *   rascunho             → a nota, a validação e o botão de emitir;
 *   erro de envio        → a mesma nota, com "Reenviar";
 *   em análise           → acompanhamento;
 *   autorizada           → leitura, com os documentos.
 *
 * DESENHO (07/10/2026)
 *   Segue a tela de rascunho da NF-e: cabeçalho com referência e selo, resumo em
 *   três cartões, seções em cartões com ícone de conferido, pagamento só para
 *   conferência e o banner verde de validado. As peças são próprias
 *   (components/PecasNfse) e as regras do que aparece ficam em
 *   lib/composicao-nfse. O que vai para as rotas: pedido, endereço, serviço,
 *   descrição, valor e o texto das informações complementares.
 *
 * INFORMAÇÕES COMPLEMENTARES (07/10/2026)
 *   A janela propõe a condição de pagamento do pedido, uma cobrança ativa por
 *   linha, num campo editável de até 2.000 caracteres. É o texto que sai escrito
 *   na NFS-e. Rascunho criado e nota autorizada mostram o texto gravado, só para
 *   leitura; a reserva do banco ("NBS:" e o código) nunca aparece.
 *
 * Rascunho não se edita: errou, cria outro ("Criar outro rascunho").
 *
 * CONDUTA (lib/janela-nfse)
 *   - Homologação não pede confirmação: conferir, "Criar rascunho", "Emitir".
 *     Produção pede UMA, com o resumo e o botão "Emitir em PRODUÇÃO".
 *   - Enquanto uma chamada roda, os botões ficam desligados e a janela diz
 *     "Aguarde, não clique de novo". Nada é tentado de novo sozinho.
 *   - Resposta que não chega (tempo ou rede) não é tratada como falha: a janela
 *     relê a nota no banco e mostra o que existe.
 *   - O erro fica na janela até ser dispensado, mesmo fechando e abrindo, com
 *     "Copiar detalhes".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Download, ExternalLink, Loader2, MoreHorizontal, X } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { fetchComSessao, SessaoExpiradaError } from "@/lib/supabase/sessao";
import { abrirLinkDeDocumentoFiscal } from "@/lib/fiscal/documento-nota";
import { formatCurrency } from "@/lib/formatters/currency";
import {
  INTERVALO_CONSULTA_NFSE_MS,
  LIMITE_DESCRICAO_NFSE,
  MAXIMO_DE_CONSULTAS_NFSE,
  conferirDescricao,
  conferirServico,
  conferirValor,
  descricaoDosItens,
  nomeDoArquivoNfse,
  situacaoDoStatus
} from "@/features/nfse/lib/regras-emissao";
import {
  LIMITE_INFORMACOES_COMPLEMENTARES_NFSE,
  alternarItemMarcado,
  enderecoInicial,
  fatorDoDesconto,
  informacoesComplementaresDaNota,
  opcoesDeEndereco,
  pagamentosParaConferencia,
  tamanhoDasInformacoesComplementares,
  textoDoPagamentoParaNota,
  mostraLinhaDeServicos,
  rotuloDosItensMarcados,
  seloDoCabecalho,
  separarAlertas,
  somaDosItensMarcados,
  valorSugeridoDaNota
} from "@/features/nfse/lib/composicao-nfse";
import {
  AvisoEmDestaque,
  BOTAO_PRIMARIO_NFSE,
  BOTAO_SECUNDARIO_NFSE,
  BannerValidado,
  CAMPO_NFSE,
  CartaoDeResumo,
  FaixaDoAmbiente,
  LinhaDeResumo,
  ROTULO_NFSE,
  SecaoNfse,
  SeloDeStatus
} from "@/features/nfse/components/PecasNfse";
import {
  LIMITE_DA_CHAMADA_MS,
  chaveDoErroGuardado,
  codigoDaFalha,
  depoisDeFalhaAoCriar,
  depoisDeFalhaAoEmitir,
  detalhesDoErro,
  emissaoPedeConfirmacao,
  falhaEhIncerta,
  lerErroGuardado,
  rotuloDoBotaoDeEmitir,
  textoDeEspera,
  type ErroDaJanela,
  type EtapaDaJanela,
  type FalhaDaChamada,
  type NotaRelida
} from "@/features/nfse/lib/janela-nfse";
import type {
  ContextoNfseDoPedido,
  NotaDeServicoLida
} from "@/features/nfse/services/nfse-pedido.server";

type Alerta = { tipo: string; codigo: string; mensagem: string; bloqueia_envio: boolean };

type Modo =
  | { tipo: "CARREGANDO" }
  | { tipo: "FALHA"; mensagem: string }
  | { tipo: "FORMULARIO"; novo: boolean }
  | { tipo: "NOTA"; nota: NotaDeServicoLida; acompanhando: boolean };

async function lerJson(resposta: Response): Promise<Record<string, unknown>> {
  try {
    return (await resposta.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** O desfecho de uma chamada da janela: resposta do servidor, sessão vencida ou silêncio. */
type Chamada =
  | { tipo: "resposta"; ok: boolean; status: number; dados: Record<string, unknown> }
  | { tipo: "sessao"; mensagem: string }
  | { tipo: "sem_resposta"; motivo: "tempo" | "rede" };

/** A nota que manda no pedido, no formato que lib/janela-nfse entende. */
function notaRelida(contexto: ContextoNfseDoPedido): NotaRelida {
  const nota = contexto.decisao.nota;
  if (!nota) return null;
  return {
    ref: nota.ref,
    situacao: situacaoDoStatus(nota.status),
    numeroNfse: nota.numero_nfse,
    tentativasEnvio: nota.tentativas_envio
  };
}

const SEM_COMO_CONFIRMAR =
  "A resposta não chegou e não foi possível conferir o estado da nota. Feche a janela, abra de novo e confira antes de tentar outra vez.";

function mensagemDaFalha(falha: unknown, padrao: string): string {
  if (falha instanceof SessaoExpiradaError) return falha.message;
  return falha instanceof Error && falha.message ? falha.message : padrao;
}

export function GerarNfseModal({
  idInt,
  onClose,
  onMudou
}: {
  idInt: number;
  onClose: () => void;
  /** Algo mudou na NFS-e do pedido: a Fila relê o estado dos botões. */
  onMudou: () => void;
}) {
  const [contexto, setContexto] = useState<ContextoNfseDoPedido | null>(null);
  const [modo, setModo] = useState<Modo>({ tipo: "CARREGANDO" });
  const [idEndereco, setIdEndereco] = useState("");
  const [idServico, setIdServico] = useState<number | null>(null);
  const [baixando, setBaixando] = useState<null | "pdf" | "xml">(null);
  const [valorTexto, setValorTexto] = useState("");
  const [descricao, setDescricao] = useState("");
  /** O texto que sai escrito na nota (xInfComp). Vem proposto do pagamento do pedido. */
  const [infComp, setInfComp] = useState("");
  const [infCompMexida, setInfCompMexida] = useState(false);
  /** Itens do pedido que entram na nota. Todos vêm marcados; ao menos um fica. */
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  /** Quem digitou no valor ou na descrição: a janela para de regerar aquele campo. */
  const [valorMexido, setValorMexido] = useState(false);
  const [descricaoMexida, setDescricaoMexida] = useState(false);
  const [avisosAbertos, setAvisosAbertos] = useState(false);
  const [maisAcoes, setMaisAcoes] = useState(false);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [ocupado, setOcupado] = useState<null | "criar" | "emitir" | "consultar">(null);
  /** Falha de uma chamada: fica na janela (e no navegador) até ser dispensada. */
  const [erro, setErro] = useState<ErroDaJanela | null>(null);
  /** Campo do formulário que falta: some na próxima tentativa. */
  const [validacao, setValidacao] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [consultas, setConsultas] = useState(0);
  const [decorrido, setDecorrido] = useState(0);
  const [copiado, setCopiado] = useState(false);
  const ativo = useRef(true);
  // A Fila passa uma função nova a cada render: guardada aqui, ela não refaz
  // os efeitos (o relógio da consulta automática recomeçava a cada render).
  const onMudouRef = useRef(onMudou);
  useEffect(() => {
    onMudouRef.current = onMudou;
  });

  useEffect(() => {
    ativo.current = true;
    return () => {
      ativo.current = false;
    };
  }, []);

  const carregarAlertas = useCallback(async (ref: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data, error } = await supabase.rpc("fn_alertas_nfse", { p_ref: ref });
    if (!ativo.current) return;
    setAlertas(error || !Array.isArray(data) ? [] : (data as Alerta[]));
  }, []);

  /** Guarda o erro na janela e no navegador: ele não some ao fechar. */
  const registrarErro = useCallback(
    (etapa: EtapaDaJanela, mensagem: string, codigo: string, ref: string | null) => {
      const novo: ErroDaJanela = { etapa, mensagem, codigo, idInt, ref, quando: new Date().toISOString() };
      setErro(novo);
      setCopiado(false);
      try {
        window.sessionStorage.setItem(chaveDoErroGuardado(idInt), JSON.stringify(novo));
      } catch {
        /* sem armazenamento: o erro fica só na janela aberta */
      }
    },
    [idInt]
  );

  const limparErro = useCallback(() => {
    setErro(null);
    try {
      window.sessionStorage.removeItem(chaveDoErroGuardado(idInt));
    } catch {
      /* nada a limpar */
    }
  }, [idInt]);

  /**
   * UMA chamada, com limite de espera. Não tenta de novo: devolve o que
   * aconteceu e quem chamou decide — inclusive reler a nota quando o servidor
   * não respondeu.
   */
  const chamar = useCallback(async (etapa: EtapaDaJanela, url: string, init: RequestInit): Promise<Chamada> => {
    const controle = new AbortController();
    let esgotou = false;
    const relogio = window.setTimeout(() => {
      esgotou = true;
      controle.abort();
    }, LIMITE_DA_CHAMADA_MS[etapa]);
    try {
      const resposta = await fetchComSessao(url, { ...init, signal: controle.signal });
      return { tipo: "resposta", ok: resposta.ok, status: resposta.status, dados: await lerJson(resposta) };
    } catch (falha) {
      if (falha instanceof SessaoExpiradaError) return { tipo: "sessao", mensagem: falha.message };
      return { tipo: "sem_resposta", motivo: esgotou ? "tempo" : "rede" };
    } finally {
      window.clearTimeout(relogio);
    }
  }, []);

  /** Lê o pedido no servidor. Só lê: quem decide o que a janela mostra é `aplicarContexto`. */
  const lerContexto = useCallback(async (): Promise<{ contexto: ContextoNfseDoPedido } | { falha: string; codigo: string }> => {
    const c = await chamar("carregar", `/api/fiscal/rascunho-nfse?id_int=${idInt}`, { cache: "no-store" });
    if (c.tipo === "sessao") return { falha: c.mensagem, codigo: "SESSAO_EXPIRADA" };
    if (c.tipo === "sem_resposta") {
      return {
        falha:
          c.motivo === "tempo"
            ? "A leitura dos dados do pedido demorou demais. Tente ler de novo."
            : "Sem conexão com o servidor para ler os dados do pedido.",
        codigo: codigoDaFalha(c)
      };
    }
    if (!c.ok || c.dados.success !== true) {
      return {
        falha: String(c.dados.message ?? "Não foi possível ler os dados do pedido."),
        codigo: codigoDaFalha({ tipo: "http", status: c.status }, c.dados.code as string | undefined)
      };
    }
    return { contexto: c.dados as unknown as ContextoNfseDoPedido };
  }, [chamar, idInt]);

  /** Abre a composição: todos os itens marcados, valor e descrição gerados deles. */
  const iniciarFormulario = useCallback((lido: ContextoNfseDoPedido, novo: boolean) => {
    const todos = new Set(lido.itens.map((item) => item.id));
    const sugerido = valorSugeridoDaNota(lido.itens, todos, lido.valorDosProdutos);
    setMarcados(todos);
    setIdEndereco(enderecoInicial(opcoesDeEndereco(lido.enderecos)));
    setValorTexto(sugerido > 0 ? sugerido.toFixed(2).replace(".", ",") : "");
    setDescricao(descricaoDosItens(lido.idInt, lido.itens));
    setInfComp(textoDoPagamentoParaNota(lido.cobrancas));
    setValorMexido(false);
    setDescricaoMexida(false);
    setInfCompMexida(false);
    setAlertas([]);
    setValidacao(null);
    setMaisAcoes(false);
    setModo({ tipo: "FORMULARIO", novo });
  }, []);

  /** Mostra o que o pedido tem: formulário, rascunho, acompanhamento ou a nota autorizada. */
  const aplicarContexto = useCallback(
    (lido: ContextoNfseDoPedido, opcoes?: { acompanhar?: boolean }) => {
      setContexto(lido);
      setConfirmando(false);
      setIdServico((atual) => (atual !== null && lido.servicos.some((sv) => sv.id === atual) ? atual : lido.idServicoPadrao));

      if (lido.decisao.acao === "CRIAR") {
        iniciarFormulario(lido, false);
        return;
      }
      setMaisAcoes(false);

      const nota = lido.decisao.nota;
      const emAnalise = lido.decisao.acao === "EM_ANALISE";
      setModo({ tipo: "NOTA", nota, acompanhando: opcoes?.acompanhar === true || emAnalise });
      if (lido.decisao.acao === "REABRIR_RASCUNHO" || lido.decisao.acao === "REENVIAR") void carregarAlertas(nota.ref);
      else setAlertas([]);
    },
    [carregarAlertas, iniciarFormulario]
  );

  /** Marca ou desmarca um item; valor e descrição acompanham enquanto ninguém os digitou. */
  function alternarItem(id: number) {
    if (!contexto) return;
    const novo = alternarItemMarcado(marcados, id);
    setMarcados(novo);
    if (!valorMexido) {
      const sugerido = valorSugeridoDaNota(contexto.itens, novo, contexto.valorDosProdutos);
      setValorTexto(sugerido > 0 ? sugerido.toFixed(2).replace(".", ",") : "");
    }
    if (!descricaoMexida) setDescricao(descricaoDosItens(contexto.idInt, contexto.itens.filter((item) => novo.has(item.id))));
  }

  /** Lê e mostra. Usado ao abrir a janela e nos botões que voltam ao estado do pedido. */
  const carregar = useCallback(
    async (opcoes?: { acompanhar?: boolean }) => {
      const lido = await lerContexto();
      if (!ativo.current) return;
      if ("falha" in lido) {
        setModo({ tipo: "FALHA", mensagem: lido.falha });
        return;
      }
      aplicarContexto(lido.contexto, opcoes);
    },
    [lerContexto, aplicarContexto]
  );

  useEffect(() => {
    // A primeira leitura — e o erro que ficou guardado da última vez neste pedido.
    const relogio = window.setTimeout(() => {
      try {
        setErro(lerErroGuardado(window.sessionStorage.getItem(chaveDoErroGuardado(idInt)), idInt));
      } catch {
        /* sem armazenamento */
      }
      void carregar();
    }, 0);
    return () => window.clearTimeout(relogio);
  }, [carregar, idInt]);

  useEffect(() => {
    const fecharComEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ocupado === null) onClose();
    };
    window.addEventListener("keydown", fecharComEsc);
    return () => window.removeEventListener("keydown", fecharComEsc);
  }, [onClose, ocupado]);

  /** Uma consulta: a rota pergunta à Focus só se a nota estiver em análise, e devolve o status do banco. */
  const consultar = useCallback(
    async (ref: string, manual: boolean) => {
      if (manual) setOcupado("consultar");
      try {
        const c = await chamar("consultar", "/api/fiscal/consultar-nfse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ref })
        });
        if (!ativo.current) return;
        if (c.tipo === "sessao") return setAviso(c.mensagem);
        if (c.tipo === "sem_resposta") {
          return setAviso("A consulta não respondeu. O status mostrado é o último lido; use Consultar agora daqui a pouco.");
        }
        if (!c.ok || c.dados.success !== true || !c.dados.nota) {
          return setAviso(String(c.dados.message ?? "Não foi possível consultar a nota agora."));
        }
        const nota = c.dados.nota as NotaDeServicoLida;
        setAviso(typeof c.dados.aviso === "string" ? c.dados.aviso : null);
        const situacao = situacaoDoStatus(nota.status);
        // Logo depois do envio o fluxo ainda não gravou "processando": o rascunho
        // continua contando como "aguardando" enquanto a janela acompanha.
        const terminou = situacao === "AUTORIZADA" || situacao === "ENCERRADA" || situacao === "REENVIAR";
        setModo((atual) =>
          atual.tipo === "NOTA" ? { tipo: "NOTA", nota, acompanhando: atual.acompanhando && !terminou } : atual
        );
        if (terminou) {
          onMudouRef.current();
          if (situacao === "AUTORIZADA") limparErro();
          if (situacao === "REENVIAR") void carregarAlertas(nota.ref);
        }
      } finally {
        if (ativo.current && manual) setOcupado(null);
      }
    },
    [chamar, carregarAlertas, limparErro]
  );

  const refAcompanhada = modo.tipo === "NOTA" && modo.acompanhando ? modo.nota.ref : null;
  useEffect(() => {
    if (!refAcompanhada || consultas >= MAXIMO_DE_CONSULTAS_NFSE) return;
    const relogio = window.setTimeout(() => {
      setConsultas((n) => n + 1);
      void consultar(refAcompanhada, false);
    }, INTERVALO_CONSULTA_NFSE_MS);
    return () => window.clearTimeout(relogio);
  }, [refAcompanhada, consultas, consultar]);

  async function criarRascunho(novo: boolean) {
    if (!contexto || ocupado) return;
    setValidacao(null);
    const desc = conferirDescricao(descricao);
    if (!desc.ok) return setValidacao(desc.motivo);
    const valor = conferirValor(valorTexto);
    if (!valor.ok) return setValidacao(valor.motivo);
    if (contexto.enderecos.length > 0 && !idEndereco) return setValidacao("Escolha o endereço do tomador.");
    if (contexto.itens.length > 0 && marcados.size === 0) return setValidacao("Marque pelo menos um item do pedido.");
    const servicoDoRascunho = conferirServico(contexto.servicos.find((sv) => sv.id === idServico) ?? null);
    if (!servicoDoRascunho.ok) return setValidacao(servicoDoRascunho.motivo);
    const tamanhoDoTexto = tamanhoDasInformacoesComplementares(infComp);
    if (tamanhoDoTexto > LIMITE_INFORMACOES_COMPLEMENTARES_NFSE) {
      return setValidacao(`As informações complementares têm ${tamanhoDoTexto} caracteres. O limite é ${LIMITE_INFORMACOES_COMPLEMENTARES_NFSE}.`);
    }

    const refAntes = contexto.decisao.nota?.ref ?? null;
    setOcupado("criar");
    try {
      const c = await chamar("criar", "/api/fiscal/rascunho-nfse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_int: idInt,
          id_endereco: idEndereco || null,
          id_servico: idServico,
          descricao: desc.texto,
          valor: valor.valor,
          informacoes_complementares: infComp,
          novo
        })
      });
      if (!ativo.current) return;

      if (c.tipo === "resposta" && c.ok && c.dados.success === true) {
        limparErro();
        onMudouRef.current();
        await carregar();
        return;
      }
      if (c.tipo === "sessao") return registrarErro("criar", c.mensagem, "SESSAO_EXPIRADA", null);

      const falha: FalhaDaChamada = c.tipo === "resposta" ? { tipo: "http", status: c.status } : c;
      const codigo = codigoDaFalha(falha, c.tipo === "resposta" ? (c.dados.code as string | undefined) : null);

      if (!falhaEhIncerta(falha)) {
        const dados = c.tipo === "resposta" ? c.dados : {};
        registrarErro("criar", String(dados.message ?? "Não foi possível criar o rascunho."), codigo, null);
        // Recusa por nota já existente: a janela passa a mostrar a nota.
        if (c.tipo === "resposta" && c.status === 409) await carregar();
        return;
      }

      // Sem resposta: não se assume que falhou. O que o pedido tem agora?
      const lido = await lerContexto();
      if (!ativo.current) return;
      if ("falha" in lido) return registrarErro("criar", SEM_COMO_CONFIRMAR, codigo, null);
      const existe = depoisDeFalhaAoCriar(notaRelida(lido.contexto), refAntes);
      registrarErro("criar", existe.mensagem, codigo, lido.contexto.decisao.nota?.ref ?? null);
      // Rascunho não criado: o formulário fica como estava, com o que foi digitado.
      if (existe.aconteceu || existe.acompanhar || lido.contexto.decisao.acao === "MOSTRAR_AUTORIZADA") {
        onMudouRef.current();
        aplicarContexto(lido.contexto, { acompanhar: existe.acompanhar });
      }
    } finally {
      if (ativo.current) setOcupado(null);
    }
  }

  async function emitir(nota: NotaDeServicoLida) {
    if (ocupado) return;
    const ref = nota.ref;
    const tentativasAntes = Number(nota.tentativas_envio ?? 0);
    setAviso(null);
    setConfirmando(false);
    setOcupado("emitir");
    try {
      const c = await chamar("emitir", "/api/fiscal/emitir-nfse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref })
      });
      if (!ativo.current) return;

      if (c.tipo === "resposta" && c.ok && c.dados.success === true) {
        // O 200 da rota é o sucesso da CHAMADA. O fluxo avisa no corpo quando a
        // conferência bloqueou ou a Focus recusou o envio; o desfecho vem do banco.
        const retornoBruto = c.dados.retorno;
        const retorno = (Array.isArray(retornoBruto) ? retornoBruto[0] : retornoBruto) as Record<string, unknown> | null;
        const recusado = retorno != null && typeof retorno === "object" && retorno.ok === false;
        if (recusado) {
          registrarErro(
            "emitir",
            String(retorno.mensagem_usuario ?? retorno.mensagem ?? "A nota não foi enviada."),
            `RECUSADA_PELA_INTEGRACAO${retorno.erro_codigo ? `/${String(retorno.erro_codigo)}` : ""}`,
            ref
          );
        } else {
          limparErro();
        }
        setConsultas(0);
        onMudouRef.current();
        await carregar({ acompanhar: !recusado });
        return;
      }
      if (c.tipo === "sessao") return registrarErro("emitir", c.mensagem, "SESSAO_EXPIRADA", ref);

      const falha: FalhaDaChamada = c.tipo === "resposta" ? { tipo: "http", status: c.status } : c;
      const codigo = codigoDaFalha(falha, c.tipo === "resposta" ? (c.dados.code as string | undefined) : null);

      // Com ou sem resposta, o que vale é o que está no banco.
      const lido = await lerContexto();
      if (!ativo.current) return;
      onMudouRef.current();

      if (!falhaEhIncerta(falha)) {
        const dados = c.tipo === "resposta" ? c.dados : {};
        registrarErro("emitir", String(dados.message ?? "Não foi possível enviar a nota."), codigo, ref);
        if ("contexto" in lido) aplicarContexto(lido.contexto);
        return;
      }

      if ("falha" in lido) return registrarErro("emitir", SEM_COMO_CONFIRMAR, codigo, ref);
      const existe = depoisDeFalhaAoEmitir(notaRelida(lido.contexto), ref, tentativasAntes);
      registrarErro("emitir", existe.mensagem, codigo, ref);
      setConsultas(0);
      aplicarContexto(lido.contexto, { acompanhar: existe.acompanhar });
    } finally {
      if (ativo.current) setOcupado(null);
    }
  }

  async function copiarDetalhes() {
    if (!erro) return;
    const texto = detalhesDoErro(erro);
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
    } catch {
      window.prompt("Copie os detalhes do erro:", texto);
    }
  }

  /** Baixa o PDF ou o XML pelo servidor (o bucket é privado) e salva com nome legível. */
  async function baixar(nota: NotaDeServicoLida, tipo: "pdf" | "xml") {
    if (baixando) return;
    setAviso(null);
    setBaixando(tipo);
    try {
      const resposta = await fetchComSessao(
        `/api/fiscal/nfse-arquivo?ref=${encodeURIComponent(nota.ref)}&arquivo=${tipo}`,
        { cache: "no-store" }
      );
      if (!resposta.ok) {
        const dados = await lerJson(resposta);
        if (ativo.current) setAviso(String(dados.message ?? "Não foi possível baixar o arquivo."));
        return;
      }
      const arquivo = await resposta.blob();
      if (arquivo.size === 0) {
        if (ativo.current) setAviso("O arquivo chegou vazio. Tente de novo.");
        return;
      }
      const endereco = URL.createObjectURL(arquivo);
      const link = document.createElement("a");
      link.href = endereco;
      link.download = nomeDoArquivoNfse({ numeroNfse: nota.numero_nfse, idInt: nota.id_int ?? idInt, ref: nota.ref, tipo });
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(endereco), 60_000);
    } catch (falha) {
      if (ativo.current) setAviso(mensagemDaFalha(falha, "Não foi possível baixar o arquivo."));
    } finally {
      if (ativo.current) setBaixando(null);
    }
  }

  // Enquanto uma chamada roda: botões desligados e o aviso de espera, que muda
  // depois de 15 segundos. Sem nova tentativa automática.
  const emEspera = modo.tipo === "CARREGANDO" || ocupado !== null;
  useEffect(() => {
    if (!emEspera) return;
    const inicio = Date.now();
    const relogio = window.setInterval(() => setDecorrido(Date.now() - inicio), 1000);
    return () => {
      window.clearInterval(relogio);
      setDecorrido(0);
    };
  }, [emEspera]);

  const servicoEscolhido = contexto?.servicos.find((sv) => sv.id === idServico) ?? null;
  const servicoConferido = conferirServico(servicoEscolhido);
  const ambiente = contexto?.empresa.ambiente ?? null;
  const valorConferido = conferirValor(valorTexto);
  const caracteres = descricao.replace(/\r\n/g, "\n").trim().length;
  const descricaoEstourou = caracteres > LIMITE_DESCRICAO_NFSE;
  const caracteresDoTexto = tamanhoDasInformacoesComplementares(infComp);
  const textoEstourou = caracteresDoTexto > LIMITE_INFORMACOES_COMPLEMENTARES_NFSE;

  const opcoesDoEndereco = contexto ? opcoesDeEndereco(contexto.enderecos) : [];
  const opcaoEscolhida = opcoesDoEndereco.find((o) => o.id === idEndereco) ?? null;
  const somaDeTodos = contexto ? somaDosItensMarcados(contexto.itens, new Set(contexto.itens.map((i) => i.id))) : 0;
  const somaMarcada = contexto ? somaDosItensMarcados(contexto.itens, marcados) : 0;
  const sugerido = contexto ? valorSugeridoDaNota(contexto.itens, marcados, contexto.valorDosProdutos) : 0;
  const temDesconto = contexto ? fatorDoDesconto(contexto.valorDosProdutos, somaDeTodos) < 1 : false;
  const pagamentos = contexto ? pagamentosParaConferencia(contexto.cobrancas) : [];
  const textoProposto = contexto ? textoDoPagamentoParaNota(contexto.cobrancas) : "";
  const alertasSeparados = separarAlertas(alertas);

  const notaAberta = modo.tipo === "NOTA" ? modo.nota : null;
  const situacaoDaNota = notaAberta ? situacaoDoStatus(notaAberta.status) : null;
  const selo = seloDoCabecalho(notaAberta !== null, situacaoDaNota);
  const emFormulario = contexto !== null && modo.tipo === "FORMULARIO" && contexto.empresa.liberada;
  const podeEmitir =
    contexto !== null && notaAberta !== null && contexto.empresa.liberada && modo.tipo === "NOTA" && !modo.acompanhando &&
    (situacaoDaNota === "RASCUNHO" || situacaoDaNota === "REENVIAR");
  const totalDaNota = notaAberta ? Number(notaAberta.valor_servicos) || 0 : valorConferido.ok ? valorConferido.valor : 0;
  /** A linha "Itens marcados (N)" do cartão Valores: só na composição, e com item no pedido. */
  const itensMarcadosNaTela = !notaAberta && contexto !== null && contexto.itens.length > 0;
  const enderecoDaNota = contexto && notaAberta ? contexto.enderecos.find((e) => e.id === notaAberta.id_endereco_tomador) ?? null : null;
  const rotuloDoAmbiente = ambiente === "producao" ? "Produção" : ambiente === "homologacao" ? "Homologação" : "não definido";
  const dataFormatada = (iso: string | null) => {
    if (!iso) return "não informada";
    const data = new Date(iso);
    return Number.isNaN(data.getTime()) ? iso : data.toLocaleString("pt-BR");
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gerar-nfse-titulo"
    >
      <div className="flex max-h-[94vh] w-full max-w-[980px] flex-col overflow-hidden rounded-3xl bg-slate-50 shadow-2xl">
        {/* Cabeçalho: pedido, referência, selo e ambiente */}
        <div className="space-y-3 border-b border-slate-200 bg-white px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="gerar-nfse-titulo" className="text-xl font-bold text-slate-950">
                NFS-e · Pedido #{idInt}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {notaAberta ? (
                  <>
                    Referência <span className="font-semibold text-slate-700">{notaAberta.ref}</span>
                    {notaAberta.numero_nfse ? ` · NFS-e nº ${notaAberta.numero_nfse}` : ""}
                  </>
                ) : (
                  "Nota fiscal de serviço ainda sem rascunho"
                )}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {contexto && modo.tipo !== "CARREGANDO" && modo.tipo !== "FALHA" && (
                <SeloDeStatus rotulo={selo.rotulo} tom={selo.tom} statusReal={notaAberta ? String(notaAberta.status ?? "") : "SEM_RASCUNHO"} />
              )}
              <button
                type="button"
                onClick={onClose}
                disabled={ocupado !== null}
                aria-label="Fechar"
                className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          {contexto && modo.tipo !== "CARREGANDO" && modo.tipo !== "FALHA" && <FaixaDoAmbiente ambiente={ambiente} />}
        </div>

        {/* Corpo, com rolagem própria */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {modo.tipo === "CARREGANDO" && (
            <p className="flex items-center gap-2 p-4 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Lendo os dados do pedido...
            </p>
          )}

          {modo.tipo === "FALHA" && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
              <p>{modo.mensagem}</p>
              <button
                type="button"
                onClick={() => {
                  setModo({ tipo: "CARREGANDO" });
                  void carregar();
                }}
                className="mt-3 rounded-xl border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
              >
                Ler de novo
              </button>
            </div>
          )}

          {contexto && modo.tipo !== "CARREGANDO" && modo.tipo !== "FALHA" && (
            <>
              {!contexto.empresa.liberada && (
                <AvisoEmDestaque tom="impede">A emissão de NFS-e pelo Vibe não está liberada para {contexto.empresa.nome}.</AvisoEmDestaque>
              )}

              {/* Resumo: três cartões, como no rascunho da NF-e */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3" data-resumo-nfse>
                <CartaoDeResumo titulo="Informações gerais">
                  <LinhaDeResumo rotulo="Empresa emissora">{contexto.empresa.nome}</LinhaDeResumo>
                  <LinhaDeResumo rotulo="Ambiente">{rotuloDoAmbiente}</LinhaDeResumo>
                  <LinhaDeResumo rotulo="Serviço fiscal">
                    <span data-servico-escolhido>
                      {notaAberta
                        ? `${notaAberta.codigo_servico || "não informado"} · NBS ${notaAberta.codigo_nbs || "não informado"}`
                        : servicoEscolhido
                          ? `${servicoEscolhido.codigo || "não informado"} · NBS ${servicoEscolhido.nbs || "não informado"}`
                          : "não escolhido"}
                    </span>
                  </LinhaDeResumo>
                </CartaoDeResumo>

                <CartaoDeResumo titulo="Valores">
                  {itensMarcadosNaTela && <LinhaDeResumo rotulo={rotuloDosItensMarcados(marcados.size)}>{formatCurrency(somaMarcada)}</LinhaDeResumo>}
                  {!notaAberta && temDesconto && <LinhaDeResumo rotulo="Desconto do pedido">-{formatCurrency(Math.max(0, somaMarcada - sugerido))}</LinhaDeResumo>}
                  {mostraLinhaDeServicos(itensMarcadosNaTela, somaMarcada, totalDaNota) && (
                    <LinhaDeResumo rotulo="Serviços">{formatCurrency(totalDaNota)}</LinhaDeResumo>
                  )}
                  <LinhaDeResumo rotulo="Total da nota" forte>
                    <span data-total-da-nota>{formatCurrency(totalDaNota)}</span>
                  </LinhaDeResumo>
                </CartaoDeResumo>

                <CartaoDeResumo titulo="Tomador">
                  <p className="text-sm font-bold text-slate-900">{contexto.tomador.nome}</p>
                  <p className="text-xs text-slate-500">
                    {contexto.tomador.tipoDocumento ?? "Documento"}: {contexto.tomador.documento || "não informado"}
                  </p>
                  <p className="text-xs text-slate-500">E-mail: {contexto.tomador.email}</p>
                  <p className="text-xs text-slate-500">Telefone: {contexto.tomador.telefone}</p>
                </CartaoDeResumo>
              </div>

              {emFormulario && !contexto.tomador.documentoOk && (
                <AvisoEmDestaque tom="impede">
                  O cliente não tem CPF (11 dígitos) ou CNPJ (14 dígitos) no cadastro. Corrija o cadastro do cliente para gerar a NFS-e.
                </AvisoEmDestaque>
              )}

              {/* Endereço do tomador */}
              <SecaoNfse
                titulo="Endereço do tomador"
                data-secao="endereco"
                estado={
                  emFormulario
                    ? opcoesDoEndereco.length === 0 || (opcaoEscolhida && !opcaoEscolhida.municipioReconhecido) || !idEndereco
                      ? "atencao"
                      : "ok"
                    : enderecoDaNota && enderecoDaNota.municipioReconhecido
                      ? "ok"
                      : "atencao"
                }
              >
                {emFormulario ? (
                  opcoesDoEndereco.length === 0 ? (
                    <p className="text-sm text-amber-700">O cliente não tem endereço cadastrado. A nota sairá sem o endereço do tomador.</p>
                  ) : (
                    <>
                      <label htmlFor="nfse-endereco" className={ROTULO_NFSE}>
                        Endereço que vai na nota
                      </label>
                      <select
                        id="nfse-endereco"
                        value={idEndereco}
                        onChange={(e) => setIdEndereco(e.target.value)}
                        disabled={ocupado !== null}
                        className={CAMPO_NFSE}
                      >
                        {opcoesDoEndereco.length > 1 && <option value="">Escolha o endereço do tomador...</option>}
                        {opcoesDoEndereco.length === 1 && opcoesDoEndereco[0].incompleto && <option value="">Nenhum endereço utilizável</option>}
                        {opcoesDoEndereco.map((o) => (
                          <option key={o.id} value={o.id} disabled={o.incompleto}>
                            {o.rotulo}
                            {o.incompleto ? " (cadastro incompleto)" : ""}
                          </option>
                        ))}
                      </select>
                      {opcoesDoEndereco.some((o) => o.incompleto) && (
                        <p className="mt-1.5 text-xs text-slate-500">
                          Endereço marcado como &quot;cadastro incompleto&quot; tem texto inválido em algum campo e não pode ser usado. Corrija-o no cadastro do cliente.
                        </p>
                      )}
                      {opcaoEscolhida && !opcaoEscolhida.municipioReconhecido && (
                        <p role="status" className="mt-2 text-xs font-semibold text-amber-700">
                          O município deste endereço não foi reconhecido. A nota sairá sem o endereço do tomador.
                        </p>
                      )}
                    </>
                  )
                ) : (
                  <p className="text-sm text-slate-700" data-endereco-da-nota>
                    {enderecoDaNota
                      ? `${opcoesDeEndereco([enderecoDaNota])[0].rotulo}${enderecoDaNota.municipioReconhecido ? "" : " — município não reconhecido: a nota sai sem endereço"}`
                      : "Esta nota não tem endereço do tomador gravado."}
                  </p>
                )}
              </SecaoNfse>

              {/* Serviço e itens */}
              <SecaoNfse
                titulo="Serviço e itens"
                data-secao="servico"
                estado={emFormulario ? (servicoConferido.ok && valorConferido.ok && !descricaoEstourou && caracteres > 0 ? "ok" : "atencao") : "ok"}
                detalhe={emFormulario && contexto.itens.length > 0 ? `${marcados.size} de ${contexto.itens.length} item(ns)` : undefined}
              >
                {emFormulario ? (
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="nfse-servico" className={ROTULO_NFSE}>
                        Serviço fiscal
                      </label>
                      <select
                        id="nfse-servico"
                        value={idServico ?? ""}
                        onChange={(e) => setIdServico(Number(e.target.value) || null)}
                        disabled={contexto.servicos.length === 0 || ocupado !== null}
                        className={CAMPO_NFSE}
                      >
                        {contexto.servicos.length === 0 && <option value="">Nenhum serviço disponível</option>}
                        {contexto.servicos.map((sv) => (
                          <option key={sv.id} value={sv.id}>
                            {[sv.codigo, sv.nome].filter(Boolean).join(" · ")}
                          </option>
                        ))}
                      </select>
                      {servicoEscolhido && (
                        <p className="mt-1.5 text-xs text-slate-600">
                          Código de tributação <strong>{servicoEscolhido.codigo || "não informado"}</strong> · NBS{" "}
                          <strong>{servicoEscolhido.nbs || "não informado"}</strong>
                          {servicoEscolhido.descricao ? ` · ${servicoEscolhido.descricao}` : ""}
                        </p>
                      )}
                      {!servicoConferido.ok && (
                        <p role="alert" className="mt-1.5 text-xs font-semibold text-red-700">
                          {contexto.servicos.length === 0
                            ? "Não foi possível ler os serviços da NFS-e. Sem serviço, o rascunho não é criado."
                            : servicoConferido.motivo}
                        </p>
                      )}
                    </div>

                    {contexto.itens.length > 0 && (
                      <div className="overflow-x-auto rounded-2xl border border-slate-200">
                        <table className="w-full text-sm" data-itens-nfse>
                          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="w-10 px-3 py-2 text-left">
                                <span className="sr-only">Entra na nota</span>
                              </th>
                              <th className="px-3 py-2 text-left">Produto</th>
                              <th className="px-3 py-2 text-right">Quantidade</th>
                              <th className="px-3 py-2 text-right">Valor unitário</th>
                              <th className="px-3 py-2 text-right">Subtotal</th>
                            </tr>
                          </thead>
                          <tbody>
                            {contexto.itens.map((item) => {
                              const marcado = marcados.has(item.id);
                              const ultimo = marcado && marcados.size === 1;
                              return (
                                <tr key={item.id} className={marcado ? "border-t border-slate-100" : "border-t border-slate-100 text-slate-400"}>
                                  <td className="px-3 py-2">
                                    <input
                                      type="checkbox"
                                      aria-label={`Incluir ${item.nome} na nota`}
                                      checked={marcado}
                                      disabled={ocupado !== null || ultimo}
                                      title={ultimo ? "Pelo menos um item tem de ficar na nota." : undefined}
                                      onChange={() => alternarItem(item.id)}
                                    />
                                  </td>
                                  <td className="px-3 py-2 font-medium">{item.nome}</td>
                                  <td className="px-3 py-2 text-right">{item.quantidade.toLocaleString("pt-BR")}</td>
                                  <td className="px-3 py-2 text-right">{formatCurrency(item.valorUnitario)}</td>
                                  <td className="px-3 py-2 text-right font-semibold">{formatCurrency(item.subtotal)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="bg-slate-50 text-sm">
                            <tr className="border-t border-slate-200">
                              <td colSpan={4} className="px-3 py-2 text-right text-slate-600">
                                Soma dos itens marcados
                                {temDesconto ? " (com o desconto do pedido)" : ""}
                              </td>
                              <td className="px-3 py-2 text-right font-bold text-slate-900" data-soma-dos-itens>
                                {formatCurrency(sugerido)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                    {contexto.itens.length > 0 && (
                      <p className="text-xs text-slate-500">
                        O subtotal do item é o que está gravado no pedido (inclui o valor fixo, quando há).
                        {contexto.freteDoPedido > 0 ? ` O frete do pedido (${formatCurrency(contexto.freteDoPedido)}) não entra na nota de serviço.` : ""} Total do pedido:{" "}
                        {formatCurrency(contexto.totalDoPedido)}.
                      </p>
                    )}

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr]">
                      <div>
                        <label htmlFor="nfse-valor" className={ROTULO_NFSE}>
                          Valor da nota (R$)
                        </label>
                        <input
                          id="nfse-valor"
                          inputMode="decimal"
                          value={valorTexto}
                          disabled={ocupado !== null}
                          onChange={(e) => {
                            setValorMexido(true);
                            setValorTexto(e.target.value);
                          }}
                          className={CAMPO_NFSE}
                        />
                        {valorConferido.ok && contexto.itens.length > 0 && Math.round(valorConferido.valor * 100) !== Math.round(sugerido * 100) && (
                          <p role="status" data-aviso-valor className="mt-1.5 text-xs font-semibold text-amber-700">
                            O valor difere da soma dos itens marcados ({formatCurrency(sugerido)}).{" "}
                            <button
                              type="button"
                              className="underline"
                              onClick={() => {
                                setValorMexido(false);
                                setValorTexto(sugerido > 0 ? sugerido.toFixed(2).replace(".", ",") : "");
                              }}
                            >
                              Usar a soma
                            </button>
                          </p>
                        )}
                      </div>
                      <div>
                        <label htmlFor="nfse-descricao" className={ROTULO_NFSE}>
                          Descrição do serviço
                        </label>
                        <textarea
                          id="nfse-descricao"
                          rows={6}
                          value={descricao}
                          disabled={ocupado !== null}
                          onChange={(e) => {
                            setDescricaoMexida(true);
                            setDescricao(e.target.value);
                          }}
                          className={CAMPO_NFSE}
                        />
                        <p data-contador-descricao className={descricaoEstourou ? "mt-1 text-xs font-semibold text-red-600" : "mt-1 text-xs text-slate-500"}>
                          {caracteres} de {LIMITE_DESCRICAO_NFSE} caracteres
                          {descricaoEstourou && ": reduza o texto para criar o rascunho."}
                          {descricaoMexida && contexto.itens.length > 0 && (
                            <>
                              {" · "}
                              <button
                                type="button"
                                className="underline"
                                onClick={() => {
                                  setDescricaoMexida(false);
                                  setDescricao(descricaoDosItens(contexto.idInt, contexto.itens.filter((item) => marcados.has(item.id))));
                                }}
                              >
                                Refazer a partir dos itens
                              </button>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500">Depois de criado, o rascunho não é editado. Se precisar corrigir, crie outro.</p>
                  </div>
                ) : notaAberta ? (
                  <div className="space-y-3" data-ref-nfse={notaAberta.ref}>
                    <p className="text-sm text-slate-700">
                      Código de tributação <strong>{notaAberta.codigo_servico || "não informado"}</strong> · NBS{" "}
                      <strong>{notaAberta.codigo_nbs || "não informado"}</strong>
                    </p>
                    <p className="text-sm text-slate-700">
                      Valor do serviço: <strong>{formatCurrency(totalDaNota)}</strong>
                    </p>
                    <div>
                      <p className={ROTULO_NFSE}>Descrição do serviço</p>
                      <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{notaAberta.discriminacao}</p>
                    </div>
                  </div>
                ) : null}
              </SecaoNfse>

              {/* Pagamento do pedido: só leitura */}
              <SecaoNfse titulo="Pagamento do pedido" estado="neutro" data-secao="pagamento">
                <p className="mb-3 text-xs text-slate-500">A NFS-e nacional não leva parcelas; a tabela é só para conferência.</p>
                {pagamentos.length === 0 ? (
                  <p className="text-sm text-slate-600">O pedido não tem cobrança ativa.</p>
                ) : (
                  <div className="overflow-x-auto rounded-2xl border border-slate-200">
                    <table className="w-full text-sm" data-pagamento-nfse>
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 text-left">Forma</th>
                          <th className="px-3 py-2 text-left">Parcela</th>
                          <th className="px-3 py-2 text-left">Vencimento</th>
                          <th className="px-3 py-2 text-right">Valor</th>
                          <th className="px-3 py-2 text-left">Situação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagamentos.flatMap((pg, i) =>
                          pg.vencimentos.map((v) => (
                            <tr key={`${i}-${v.numero}`} className="border-t border-slate-100">
                              <td className="px-3 py-2 font-medium text-slate-800">{v.numero === 1 ? pg.forma : ""}</td>
                              <td className="px-3 py-2 text-slate-600">
                                {v.numero}/{v.total}
                              </td>
                              <td className="px-3 py-2 text-slate-600">
                                {v.vencimento ? v.vencimento.split("-").reverse().join("/") : "a definir"}
                              </td>
                              <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatCurrency(v.valor)}</td>
                              <td className="px-3 py-2 text-slate-600">{v.numero === 1 ? pg.situacao : ""}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* O texto que sai escrito na nota (xInfComp) */}
                <div className="mt-4 border-t border-slate-200 pt-4" data-informacoes-complementares>
                  <p className="mb-2 text-xs font-semibold text-slate-600">O texto abaixo sai escrito na NFS-e.</p>
                  {emFormulario ? (
                    <>
                      <label htmlFor="nfse-informacoes-complementares" className={ROTULO_NFSE}>
                        Informações complementares (saem na nota)
                      </label>
                      <textarea
                        id="nfse-informacoes-complementares"
                        rows={4}
                        value={infComp}
                        disabled={ocupado !== null}
                        onChange={(e) => {
                          setInfCompMexida(true);
                          setInfComp(e.target.value);
                        }}
                        placeholder="Sem texto, a nota sai sem informações complementares."
                        className={CAMPO_NFSE}
                      />
                      <p data-contador-informacoes className={textoEstourou ? "mt-1 text-xs font-semibold text-red-600" : "mt-1 text-xs text-slate-500"}>
                        {caracteresDoTexto} de {LIMITE_INFORMACOES_COMPLEMENTARES_NFSE} caracteres
                        {textoEstourou && ": reduza o texto para criar o rascunho."}
                        {infCompMexida && infComp !== textoProposto && (
                          <>
                            {" · "}
                            <button
                              type="button"
                              className="underline"
                              onClick={() => {
                                setInfCompMexida(false);
                                setInfComp(textoProposto);
                              }}
                            >
                              Refazer a partir do pagamento
                            </button>
                          </>
                        )}
                      </p>
                    </>
                  ) : notaAberta ? (
                    <>
                      <p className={ROTULO_NFSE}>Informações complementares</p>
                      {informacoesComplementaresDaNota(notaAberta.informacoes_complementares) ? (
                        <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-700" data-texto-da-nota>
                          {informacoesComplementaresDaNota(notaAberta.informacoes_complementares)}
                        </p>
                      ) : (
                        <p className="text-sm text-slate-600" data-texto-da-nota>
                          Sem informações complementares
                        </p>
                      )}
                    </>
                  ) : null}
                </div>
              </SecaoNfse>

              {/* Validação: só com a nota (o banco confere o rascunho gravado) */}
              {notaAberta && (situacaoDaNota === "RASCUNHO" || situacaoDaNota === "REENVIAR") && (
                <SecaoNfse titulo="Validação" data-secao="validacao" estado={alertasSeparados.validado ? "ok" : "atencao"}>
                  <div className="space-y-2" data-alertas-nfse>
                    {alertasSeparados.validado ? (
                      <BannerValidado>Rascunho validado, sem erros bloqueantes.</BannerValidado>
                    ) : (
                      alertasSeparados.bloqueios.map((al) => (
                        <AvisoEmDestaque key={al.codigo} tom="impede">
                          {al.mensagem} A integração vai recusar o envio enquanto isso não for corrigido.
                        </AvisoEmDestaque>
                      ))
                    )}
                    {alertasSeparados.atencao.map((al) => (
                      <AvisoEmDestaque key={al.codigo} tom="atencao">
                        {al.mensagem}
                      </AvisoEmDestaque>
                    ))}
                    {alertasSeparados.informativos.length > 0 && (
                      <div className="rounded-xl border border-slate-200 bg-white">
                        <button
                          type="button"
                          onClick={() => setAvisosAbertos((v) => !v)}
                          aria-expanded={avisosAbertos}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-600"
                        >
                          {avisosAbertos ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          Avisos informativos ({alertasSeparados.informativos.length})
                        </button>
                        {avisosAbertos && (
                          <ul className="space-y-1 border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
                            {alertasSeparados.informativos.map((al) => (
                              <li key={al.codigo}>{al.mensagem}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                </SecaoNfse>
              )}

              {/* Acompanhamento e erro da nota */}
              {notaAberta && situacaoDaNota !== "AUTORIZADA" && (notaAberta.mensagem_prefeitura || notaAberta.erro_mensagem) && (
                <AvisoEmDestaque tom="impede">{notaAberta.mensagem_prefeitura || notaAberta.erro_mensagem}</AvisoEmDestaque>
              )}
              {modo.tipo === "NOTA" && modo.acompanhando && (
                <p role="status" data-acompanhando className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-600">
                  {consultas < MAXIMO_DE_CONSULTAS_NFSE ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Aguardando o retorno da prefeitura. A janela consulta sozinha a cada 15 segundos.
                    </>
                  ) : (
                    "A nota continua em análise. Consulte depois."
                  )}
                </p>
              )}

              {/* Documentos, depois de autorizada */}
              {notaAberta && situacaoDaNota === "AUTORIZADA" && (
                <SecaoNfse titulo="Documentos" data-secao="documentos">
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                    <div>
                      <dt className={ROTULO_NFSE}>Número da NFS-e</dt>
                      <dd className="font-bold text-slate-900">{notaAberta.numero_nfse || "não informado"}</dd>
                    </div>
                    <div>
                      <dt className={ROTULO_NFSE}>Data de emissão</dt>
                      <dd className="text-slate-800">{dataFormatada(notaAberta.data_emissao)}</dd>
                    </div>
                    <div className="sm:col-span-3">
                      <dt className={ROTULO_NFSE}>Chave de acesso</dt>
                      <dd className="break-all font-mono text-xs text-slate-800" data-chave-nfse>
                        {notaAberta.codigo_verificacao || "não informada"}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-2" data-documentos-nfse>
                    {notaAberta.url_pdf && (
                      <button type="button" onClick={() => abrirLinkDeDocumentoFiscal(notaAberta.url_pdf)} className={BOTAO_SECUNDARIO_NFSE}>
                        <ExternalLink className="h-4 w-4" /> Abrir PDF
                      </button>
                    )}
                    {notaAberta.url_pdf && (
                      <button type="button" onClick={() => void baixar(notaAberta, "pdf")} disabled={baixando !== null} className={BOTAO_SECUNDARIO_NFSE}>
                        {baixando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Baixar PDF
                      </button>
                    )}
                    {notaAberta.url_xml && (
                      <button type="button" onClick={() => abrirLinkDeDocumentoFiscal(notaAberta.url_xml)} className={BOTAO_SECUNDARIO_NFSE}>
                        <ExternalLink className="h-4 w-4" /> Abrir XML
                      </button>
                    )}
                    {notaAberta.url_xml && (
                      <button type="button" onClick={() => void baixar(notaAberta, "xml")} disabled={baixando !== null} className={BOTAO_SECUNDARIO_NFSE}>
                        {baixando === "xml" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Baixar XML
                      </button>
                    )}
                    {!notaAberta.url_pdf && !notaAberta.url_xml && <span className="text-sm text-slate-500">PDF e XML ainda não disponíveis.</span>}
                  </div>
                </SecaoNfse>
              )}

              {/* Confirmação de PRODUÇÃO: uma, com o resumo */}
              {notaAberta && confirmando && (
                <div data-confirmacao-producao className="rounded-2xl border-2 border-red-700 bg-red-50 p-4 text-sm text-slate-900">
                  <p className="rounded-xl bg-red-600 px-3 py-2 text-center text-base font-extrabold tracking-wide text-white">PRODUÇÃO</p>
                  <p className="mt-3 font-semibold">Esta nota tem valor fiscal. Confira antes de emitir:</p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    <dt className="text-slate-500">Empresa</dt>
                    <dd className="font-semibold">{contexto.empresa.nome}</dd>
                    <dt className="text-slate-500">Tomador</dt>
                    <dd className="font-semibold">{contexto.tomador.nome}</dd>
                    <dt className="text-slate-500">Valor</dt>
                    <dd className="font-semibold">{formatCurrency(totalDaNota)}</dd>
                  </dl>
                </div>
              )}
            </>
          )}

          {aviso && (
            <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
              {aviso}
            </p>
          )}

          {validacao && (
            <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
              {validacao}
            </p>
          )}

          {erro && (
            <div data-erro-nfse={erro.codigo} className="rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-semibold">{erro.mensagem}</p>
              <p className="mt-1 text-xs text-red-700">
                {erro.ref ? `Nota ${erro.ref} · ` : ""}
                {new Date(erro.quando).toLocaleString("pt-BR")} · código {erro.codigo}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copiarDetalhes()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                >
                  <Copy className="h-3.5 w-3.5" /> {copiado ? "Detalhes copiados" : "Copiar detalhes"}
                </button>
                <button
                  type="button"
                  onClick={limparErro}
                  className="rounded-xl border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                >
                  Dispensar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Rodapé fixo */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-6 py-4" data-rodape-nfse>
          {emEspera && (
            <p role="status" data-espera className="mr-auto flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Loader2 className="h-4 w-4 animate-spin" /> {textoDeEspera(decorrido)}
            </p>
          )}

          {!emEspera && podeEmitir && contexto && (
            <div className="relative mr-auto">
              <button
                type="button"
                onClick={() => setMaisAcoes((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={maisAcoes}
                className={BOTAO_SECUNDARIO_NFSE}
              >
                <MoreHorizontal className="h-4 w-4" /> Mais ações
              </button>
              {maisAcoes && (
                <div role="menu" className="absolute bottom-full left-0 z-10 mb-2 w-64 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setConfirmando(false);
                      iniciarFormulario(contexto, true);
                    }}
                    className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Criar outro rascunho
                    <span className="block text-xs font-normal text-slate-500">O rascunho atual fica sem uso.</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {!emEspera && emFormulario && modo.tipo === "FORMULARIO" && modo.novo && (
            <button
              type="button"
              onClick={() => {
                setValidacao(null);
                void carregar();
              }}
              className={`mr-auto ${BOTAO_SECUNDARIO_NFSE}`}
            >
              Voltar ao rascunho atual
            </button>
          )}

          {modo.tipo === "NOTA" && (modo.acompanhando || situacaoDaNota === "EM_ANALISE") && (
            <button type="button" onClick={() => void consultar(modo.nota.ref, true)} disabled={ocupado !== null} className={BOTAO_SECUNDARIO_NFSE}>
              {ocupado === "consultar" && <Loader2 className="h-4 w-4 animate-spin" />}
              Consultar agora
            </button>
          )}

          <button type="button" onClick={onClose} disabled={ocupado !== null} className={BOTAO_SECUNDARIO_NFSE}>
            Fechar
          </button>

          {emFormulario && modo.tipo === "FORMULARIO" && contexto && (
            <button
              type="button"
              onClick={() => void criarRascunho(modo.novo)}
              disabled={ocupado !== null || !contexto.tomador.documentoOk || descricaoEstourou || textoEstourou || !servicoConferido.ok}
              className={BOTAO_PRIMARIO_NFSE}
            >
              {ocupado === "criar" && <Loader2 className="h-4 w-4 animate-spin" />}
              Criar rascunho
            </button>
          )}

          {podeEmitir && notaAberta && confirmando && (
            <>
              <button type="button" onClick={() => setConfirmando(false)} disabled={ocupado !== null} className={BOTAO_SECUNDARIO_NFSE}>
                Voltar
              </button>
              <button
                type="button"
                onClick={() => void emitir(notaAberta)}
                disabled={ocupado !== null}
                className="inline-flex items-center gap-2 rounded-2xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {rotuloDoBotaoDeEmitir("producao", situacaoDaNota === "REENVIAR")}
              </button>
            </>
          )}

          {podeEmitir && notaAberta && !confirmando && (
            <button
              type="button"
              // Homologação emite direto. Só produção abre a confirmação — uma.
              onClick={() => {
                setMaisAcoes(false);
                if (emissaoPedeConfirmacao(ambiente)) setConfirmando(true);
                else void emitir(notaAberta);
              }}
              disabled={ocupado !== null}
              className={BOTAO_PRIMARIO_NFSE}
            >
              {ocupado === "emitir" && <Loader2 className="h-4 w-4 animate-spin" />}
              {situacaoDaNota === "REENVIAR" ? "Reenviar NFS-e" : "Emitir NFS-e"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
