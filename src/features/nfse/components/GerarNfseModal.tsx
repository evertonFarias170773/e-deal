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
 *   sem nota viva        → formulário (endereço, valor, descrição);
 *   rascunho             → a nota, os alertas e o botão de emitir;
 *   erro de envio        → a mesma nota, com "Reenviar";
 *   em análise           → acompanhamento;
 *   autorizada           → leitura, com PDF e XML.
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
import { AlertTriangle, Copy, Download, ExternalLink, Loader2, X } from "lucide-react";
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
  nomeDoArquivoNfse,
  situacaoDoStatus,
  valorDifereDoPedido
} from "@/features/nfse/lib/regras-emissao";
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

const ROTULO_DO_STATUS: Record<string, string> = {
  PENDENTE: "Rascunho",
  PRONTA_PARA_ENVIO: "Pronta para envio",
  PROCESSANDO: "Em processamento",
  AUTORIZADA: "Autorizada",
  ERRO_ENVIO: "Erro de envio",
  ERRO_VALIDACAO: "Bloqueada na conferência",
  ERRO_AUTORIZACAO: "Recusada pela prefeitura",
  CANCELADA: "Cancelada",
  REJEITADA: "Rejeitada"
};

function rotuloDoStatus(status: string | null): string {
  const chave = String(status ?? "").toUpperCase();
  return ROTULO_DO_STATUS[chave] ?? (situacaoDoStatus(status) === "EM_ANALISE" ? "Em análise" : chave || "Sem status");
}

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

  /** Mostra o que o pedido tem: formulário, rascunho, acompanhamento ou a nota autorizada. */
  const aplicarContexto = useCallback(
    (lido: ContextoNfseDoPedido, opcoes?: { acompanhar?: boolean }) => {
      setContexto(lido);
      setConfirmando(false);
      setIdServico((atual) => (atual !== null && lido.servicos.some((sv) => sv.id === atual) ? atual : lido.idServicoPadrao));

      if (lido.decisao.acao === "CRIAR") {
        setIdEndereco(lido.enderecos.length === 1 ? lido.enderecos[0].id : "");
        setValorTexto(lido.totalDoPedido > 0 ? lido.totalDoPedido.toFixed(2).replace(".", ",") : "");
        setDescricao(lido.descricaoSugerida);
        setAlertas([]);
        setModo({ tipo: "FORMULARIO", novo: false });
        return;
      }

      const nota = lido.decisao.nota;
      const emAnalise = lido.decisao.acao === "EM_ANALISE";
      setModo({ tipo: "NOTA", nota, acompanhando: opcoes?.acompanhar === true || emAnalise });
      if (lido.decisao.acao === "REABRIR_RASCUNHO" || lido.decisao.acao === "REENVIAR") void carregarAlertas(nota.ref);
      else setAlertas([]);
    },
    [carregarAlertas]
  );

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
    const servicoDoRascunho = conferirServico(contexto.servicos.find((sv) => sv.id === idServico) ?? null);
    if (!servicoDoRascunho.ok) return setValidacao(servicoDoRascunho.motivo);

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
  const enderecoEscolhido = contexto?.enderecos.find((e) => e.id === idEndereco) ?? null;
  const valorConferido = conferirValor(valorTexto);
  const caracteres = descricao.replace(/\r\n/g, "\n").trim().length;
  const descricaoEstourou = caracteres > LIMITE_DESCRICAO_NFSE;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gerar-nfse-titulo"
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 id="gerar-nfse-titulo" className="text-xl font-semibold text-slate-950">
              Gerar NFS-e
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Pedido <span className="font-semibold text-slate-700">#{idInt}</span> · nota fiscal de serviço
            </p>
          </div>
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

        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
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
              <div
                data-ambiente={ambiente ?? "indefinido"}
                className={
                  ambiente === "producao"
                    ? "rounded-2xl border-2 border-red-700 bg-red-600 p-3 text-center text-base font-extrabold tracking-wide text-white"
                    : "rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-900"
                }
              >
                {ambiente === "producao" && "PRODUÇÃO: NOTA COM VALOR FISCAL"}
                {ambiente === "homologacao" && "HOMOLOGAÇÃO: NOTA DE TESTE, sem valor fiscal"}
                {ambiente === null && "Ambiente da NFS-e não definido no cadastro da empresa"}
              </div>

              <div data-servico-nfse>
                <label htmlFor="nfse-servico" className="text-xs font-semibold uppercase text-slate-400">
                  Serviço
                </label>
                {modo.tipo === "FORMULARIO" ? (
                  <>
                    <select
                      id="nfse-servico"
                      value={idServico ?? ""}
                      onChange={(e) => setIdServico(Number(e.target.value) || null)}
                      disabled={contexto.servicos.length === 0 || ocupado !== null}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-400 disabled:bg-slate-50"
                    >
                      {contexto.servicos.length === 0 && <option value="">Nenhum serviço disponível</option>}
                      {contexto.servicos.map((sv) => (
                        <option key={sv.id} value={sv.id}>
                          {[sv.codigo, sv.nome].filter(Boolean).join(" · ")}
                        </option>
                      ))}
                    </select>
                    {servicoEscolhido && (
                      <p className="mt-1 text-xs text-slate-600" data-servico-escolhido>
                        Código de tributação <strong>{servicoEscolhido.codigo || "não informado"}</strong> · NBS{" "}
                        <strong>{servicoEscolhido.nbs || "não informado"}</strong>
                        {servicoEscolhido.descricao ? ` · ${servicoEscolhido.descricao}` : ""}
                      </p>
                    )}
                    {!servicoConferido.ok && (
                      <p role="alert" className="mt-1 text-xs font-semibold text-red-700">
                        {contexto.servicos.length === 0
                          ? "Não foi possível ler os serviços da NFS-e. Sem serviço, o rascunho não é criado."
                          : servicoConferido.motivo}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-sm text-slate-900" data-servico-escolhido>
                    {modo.tipo === "NOTA"
                      ? `Código de tributação ${modo.nota.codigo_servico || "não informado"} · NBS ${modo.nota.codigo_nbs || "não informado"}`
                      : ""}
                  </p>
                )}
              </div>

              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold uppercase text-slate-400">Tomador</dt>
                  <dd className="font-semibold text-slate-900">{contexto.tomador.nome}</dd>
                  <dd className="text-xs text-slate-500">
                    {contexto.tomador.documentoOk ? `${contexto.tomador.tipoDocumento} no cadastro` : "Sem CPF ou CNPJ válido"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-slate-400">Empresa emissora</dt>
                  <dd className="font-semibold text-slate-900">{contexto.empresa.nome}</dd>
                </div>
              </dl>

              {!contexto.empresa.liberada && (
                <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                  A emissão de NFS-e pelo Vibe não está liberada para {contexto.empresa.nome}.
                </p>
              )}
            </>
          )}

          {contexto && modo.tipo === "FORMULARIO" && contexto.empresa.liberada && (
            <>
              {!contexto.tomador.documentoOk && (
                <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                  O cliente não tem CPF (11 dígitos) ou CNPJ (14 dígitos) no cadastro. Corrija o cadastro do cliente para
                  gerar a NFS-e.
                </p>
              )}

              <fieldset>
                <legend className="text-xs font-semibold uppercase text-slate-400">Endereço do tomador</legend>
                {contexto.enderecos.length === 0 ? (
                  <p className="mt-1 text-sm text-amber-700">
                    O cliente não tem endereço cadastrado. A nota sairá sem o endereço do tomador.
                  </p>
                ) : (
                  <div className="mt-1 space-y-1.5">
                    {contexto.enderecos.map((e) => (
                      <label
                        key={e.id}
                        className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 p-2.5 text-sm hover:border-teal-300"
                      >
                        <input
                          type="radio"
                          name="endereco-tomador"
                          className="mt-1"
                          checked={idEndereco === e.id}
                          onChange={() => setIdEndereco(e.id)}
                        />
                        <span>
                          <span className="font-semibold text-slate-900">{e.linha}</span>
                          <span className="block text-xs text-slate-500">
                            {[e.cidade && e.uf ? `${e.cidade}/${e.uf}` : e.cidade || e.uf, e.cep && `CEP ${e.cep}`, e.tipo]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {enderecoEscolhido && !enderecoEscolhido.municipioReconhecido && (
                  <p role="status" className="mt-2 text-xs font-semibold text-amber-700">
                    O município deste endereço não foi reconhecido. A nota sairá sem o endereço do tomador.
                  </p>
                )}
              </fieldset>

              <div>
                <label htmlFor="nfse-valor" className="text-xs font-semibold uppercase text-slate-400">
                  Valor do serviço (R$)
                </label>
                <input
                  id="nfse-valor"
                  inputMode="decimal"
                  value={valorTexto}
                  onChange={(e) => setValorTexto(e.target.value)}
                  className="mt-1 w-48 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-400"
                />
                {valorConferido.ok && valorDifereDoPedido(valorConferido.valor, contexto.totalDoPedido) && (
                  <p role="status" className="mt-1 text-xs font-semibold text-amber-700">
                    O valor difere do total do pedido ({formatCurrency(contexto.totalDoPedido)}).
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="nfse-descricao" className="text-xs font-semibold uppercase text-slate-400">
                  Descrição do serviço
                </label>
                <textarea
                  id="nfse-descricao"
                  rows={7}
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-400"
                />
                <p
                  data-contador-descricao
                  className={descricaoEstourou ? "text-xs font-semibold text-red-600" : "text-xs text-slate-500"}
                >
                  {caracteres} de {LIMITE_DESCRICAO_NFSE} caracteres
                  {descricaoEstourou && ": reduza o texto para criar o rascunho."}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Depois de criado, o rascunho não é editado. Se precisar corrigir, crie outro.
                </p>
              </div>
            </>
          )}

          {contexto && modo.tipo === "NOTA" && (
            <div className="space-y-3 rounded-2xl border border-slate-200 p-4 text-sm" data-ref-nfse={modo.nota.ref}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-slate-900">
                  {modo.nota.numero_nfse ? `NFS-e nº ${modo.nota.numero_nfse}` : modo.nota.ref}
                </span>
                <span
                  data-status-nfse={String(modo.nota.status ?? "")}
                  className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
                >
                  {rotuloDoStatus(modo.nota.status)}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Referência {modo.nota.ref}
                {modo.nota.ambiente ? ` · gravada em ${modo.nota.ambiente}` : ""}
              </p>
              <p>
                Valor do serviço: <strong>{formatCurrency(Number(modo.nota.valor_servicos) || 0)}</strong>
              </p>
              <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-700">{modo.nota.discriminacao}</p>
              <p className="text-xs text-slate-500">
                Endereço do tomador:{" "}
                {(() => {
                  const e = contexto.enderecos.find((x) => x.id === modo.nota.id_endereco_tomador);
                  if (!e) return "não gravado nesta nota";
                  return `${e.linha} · ${e.cidade}/${e.uf}${e.municipioReconhecido ? "" : " (município não reconhecido: a nota sai sem endereço)"}`;
                })()}
              </p>

              {(modo.nota.mensagem_prefeitura || modo.nota.erro_mensagem) && situacaoDoStatus(modo.nota.status) !== "AUTORIZADA" && (
                <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
                  {modo.nota.mensagem_prefeitura || modo.nota.erro_mensagem}
                </p>
              )}

              {situacaoDoStatus(modo.nota.status) === "AUTORIZADA" && (
                <div className="flex flex-wrap gap-2">
                  {modo.nota.url_pdf && (
                    <button
                      type="button"
                      onClick={() => abrirLinkDeDocumentoFiscal(modo.nota.url_pdf)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Abrir PDF
                    </button>
                  )}
                  {modo.nota.url_xml && (
                    <button
                      type="button"
                      onClick={() => abrirLinkDeDocumentoFiscal(modo.nota.url_xml)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Abrir XML
                    </button>
                  )}
                  {modo.nota.url_pdf && (
                    <button
                      type="button"
                      onClick={() => void baixar(modo.nota, "pdf")}
                      disabled={baixando !== null}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {baixando === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      Baixar PDF
                    </button>
                  )}
                  {modo.nota.url_xml && (
                    <button
                      type="button"
                      onClick={() => void baixar(modo.nota, "xml")}
                      disabled={baixando !== null}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {baixando === "xml" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      Baixar XML
                    </button>
                  )}
                  {!modo.nota.url_pdf && !modo.nota.url_xml && (
                    <span className="text-xs text-slate-500">PDF e XML ainda não disponíveis.</span>
                  )}
                </div>
              )}

              {modo.acompanhando && (
                <p role="status" className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                  {consultas < MAXIMO_DE_CONSULTAS_NFSE ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Aguardando o retorno da prefeitura. A janela consulta
                      sozinha a cada 15 segundos.
                    </>
                  ) : (
                    "A nota continua em análise. Consulte depois."
                  )}
                </p>
              )}

              {alertas.length > 0 && (
                <ul className="space-y-1" data-alertas-nfse>
                  {alertas.map((a) => (
                    <li
                      key={a.codigo}
                      className={
                        a.bloqueia_envio
                          ? "flex gap-2 text-xs font-semibold text-red-700"
                          : "flex gap-2 text-xs text-amber-700"
                      }
                    >
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        {a.mensagem}
                        {a.bloqueia_envio && " A integração vai recusar o envio enquanto isso não for corrigido."}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {aviso && (
            <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
              {aviso}
            </p>
          )}
          {contexto && modo.tipo === "NOTA" && confirmando && (
            <div data-confirmacao-producao className="rounded-2xl border-2 border-red-700 bg-red-50 p-4 text-sm text-slate-900">
              <p className="rounded-xl bg-red-600 px-3 py-2 text-center text-base font-extrabold tracking-wide text-white">
                PRODUÇÃO
              </p>
              <p className="mt-3 font-semibold">Esta nota tem valor fiscal. Confira antes de emitir:</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-slate-500">Empresa</dt>
                <dd className="font-semibold">{contexto.empresa.nome}</dd>
                <dt className="text-slate-500">Tomador</dt>
                <dd className="font-semibold">{contexto.tomador.nome}</dd>
                <dt className="text-slate-500">Valor</dt>
                <dd className="font-semibold">{formatCurrency(Number(modo.nota.valor_servicos) || 0)}</dd>
              </dl>
            </div>
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

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          {emEspera && (
            <p role="status" data-espera className="mr-auto flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Loader2 className="h-4 w-4 animate-spin" /> {textoDeEspera(decorrido)}
            </p>
          )}
          {contexto && modo.tipo === "NOTA" && contexto.empresa.liberada && !modo.acompanhando &&
            (situacaoDoStatus(modo.nota.status) === "RASCUNHO" || situacaoDoStatus(modo.nota.status) === "REENVIAR") && (
              <>
                <button
                  type="button"
                  disabled={ocupado !== null}
                  onClick={() => {
                    setValidacao(null);
                    setConfirmando(false);
                    setIdEndereco(contexto.enderecos.length === 1 ? contexto.enderecos[0].id : "");
                    setValorTexto(contexto.totalDoPedido > 0 ? contexto.totalDoPedido.toFixed(2).replace(".", ",") : "");
                    setDescricao(contexto.descricaoSugerida);
                    setModo({ tipo: "FORMULARIO", novo: true });
                  }}
                  className="mr-auto rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Criar outro rascunho
                </button>
                {confirmando ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setConfirmando(false)}
                      disabled={ocupado !== null}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Voltar
                    </button>
                    <button
                      type="button"
                      onClick={() => void emitir(modo.nota)}
                      disabled={ocupado !== null}
                      className="inline-flex items-center gap-2 rounded-2xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {rotuloDoBotaoDeEmitir("producao", situacaoDoStatus(modo.nota.status) === "REENVIAR")}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    // Homologação emite direto. Só produção abre a confirmação — uma.
                    onClick={() => (emissaoPedeConfirmacao(ambiente) ? setConfirmando(true) : void emitir(modo.nota))}
                    disabled={ocupado !== null}
                    className="inline-flex items-center gap-2 rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#061d2e] disabled:opacity-50"
                  >
                    {situacaoDoStatus(modo.nota.status) === "REENVIAR" ? "Reenviar NFS-e" : "Emitir NFS-e"}
                  </button>
                )}
              </>
            )}

          {modo.tipo === "NOTA" && (modo.acompanhando || situacaoDoStatus(modo.nota.status) === "EM_ANALISE") && (
            <button
              type="button"
              onClick={() => void consultar(modo.nota.ref, true)}
              disabled={ocupado !== null}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {ocupado === "consultar" && <Loader2 className="h-4 w-4 animate-spin" />}
              Consultar agora
            </button>
          )}

          {contexto && modo.tipo === "FORMULARIO" && contexto.empresa.liberada && (
            <>
              {modo.novo && (
                <button
                  type="button"
                  disabled={ocupado !== null}
                  onClick={() => {
                    setValidacao(null);
                    void carregar();
                  }}
                  className="mr-auto rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Voltar ao rascunho atual
                </button>
              )}
              <button
                type="button"
                onClick={() => void criarRascunho(modo.novo)}
                disabled={ocupado !== null || !contexto.tomador.documentoOk || descricaoEstourou || !servicoConferido.ok}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#061d2e] disabled:opacity-50"
              >
                {ocupado === "criar" && <Loader2 className="h-4 w-4 animate-spin" />}
                Criar rascunho
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onClose}
            disabled={ocupado !== null}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
