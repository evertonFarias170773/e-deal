"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { formatDocument } from "@/lib/formatters/document";
import { normalizeDocumentDigits, validateDocumentByTipo } from "@/features/cadastros/utils/documento";
import {
  checkVinculoRemovability,
  createCadastroVinculosComerciais,
  deleteVinculoComercial,
  getCadastroVinculoById,
  listCadastroVinculosComerciais,
  searchCadastroVinculoByDocumento,
  updateCadastroVinculoComercial,
  type SearchCadastroVinculoItem
} from "@/features/cadastros/services/cadastros.service";
import type { CadastroVinculoComercial } from "@/features/cadastros/types";

/** Acima disso a lista ganha campo de pesquisa e passa a exibir só os primeiros. */
const LIMITE_VISIVEL = 4;

const TIPO_RELACAO_PADRAO = "vinculo_comercial";

type Toast = (toast: {
  type: "success" | "error" | "warning" | "info";
  title: string;
  description?: string;
}) => void;

export function novoVinculoEmBranco(): CadastroVinculoComercial {
  return {
    id: `vinc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    idClienteRelacionado: 0,
    nome: "",
    documento: "",
    tipoRelacao: TIPO_RELACAO_PADRAO
  };
}

function ehVinculoNovo(id: string) {
  return id.startsWith("vinc_");
}

export function VinculosNotaFiscalCard({
  idClienteOrigem,
  vinculos,
  onChange,
  persistirImediato,
  isEditAllowed,
  onToast,
  inputClass,
  vinculoInicialId,
  tipoRelacaoInicial,
  onConsumirVinculoInicial
}: {
  /** id_cliente do cadastro sendo editado — dono dos vínculos. */
  idClienteOrigem: string;
  vinculos: CadastroVinculoComercial[];
  onChange: (vinculos: CadastroVinculoComercial[]) => void;
  /**
   * Em edição grava direto no banco a cada ação. Em cadastro novo o cliente
   * ainda não existe, então não há a quem vincular: fica no estado e o save
   * principal grava junto, como sempre foi.
   */
  persistirImediato: boolean;
  isEditAllowed: boolean;
  onToast: Toast;
  inputClass: string;
  /** Cadastro recém-criado que deve voltar já selecionado (?novoVinculo=). */
  vinculoInicialId?: number;
  tipoRelacaoInicial?: string;
  onConsumirVinculoInicial?: () => void;
}) {
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [original, setOriginal] = useState<CadastroVinculoComercial | null>(null);
  const [busca, setBusca] = useState("");
  const [resultado, setResultado] = useState<SearchCadastroVinculoItem | null>(null);
  const [buscouSemResultado, setBuscouSemResultado] = useState(false);
  const [duplicado, setDuplicado] = useState<CadastroVinculoComercial | null>(null);
  const [erroBusca, setErroBusca] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [removendoId, setRemovendoId] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const [mostrarTodos, setMostrarTodos] = useState(false);

  const ocupado = salvandoId !== null || removendoId !== null;

  const limparBusca = useCallback(() => {
    setBusca("");
    setResultado(null);
    setBuscouSemResultado(false);
    setDuplicado(null);
    setErroBusca(null);
  }, []);

  const fechar = useCallback(() => {
    setAbertoId(null);
    setOriginal(null);
    limparBusca();
  }, [limparBusca]);

  function abrirVinculo(vinculo: CadastroVinculoComercial) {
    setOriginal(vinculo);
    setAbertoId(vinculo.id);
    limparBusca();
  }

  function adicionarVinculo(preSelecionado?: CadastroVinculoComercial) {
    const novo = preSelecionado ?? novoVinculoEmBranco();
    onChange([...vinculos, novo]);
    setOriginal(null);
    setAbertoId(novo.id);
    limparBusca();
  }

  function cancelarVinculo(index: number) {
    if (original) {
      onChange(vinculos.map((item, i) => (i === index ? original : item)));
    } else {
      // Vínculo novo que nunca chegou a ser gravado: sai do formulário.
      onChange(vinculos.filter((_, i) => i !== index));
    }
    fechar();
  }

  function atualizarTipo(index: number, valor: string) {
    onChange(vinculos.map((item, i) => (i === index ? { ...item, tipoRelacao: valor } : item)));
  }

  // ── Retorno de "criar cadastro novo": abre o fluxo já com o cadastro escolhido ──
  const inicialConsumido = useRef(false);
  useEffect(() => {
    if (!vinculoInicialId || inicialConsumido.current || !isEditAllowed) return;
    inicialConsumido.current = true;

    void (async () => {
      const item = await getCadastroVinculoById(vinculoInicialId);
      onConsumirVinculoInicial?.();

      if (!item) {
        onToast({
          type: "warning",
          title: "Cadastro não localizado",
          description: "O cadastro recém-criado não foi encontrado para vincular."
        });
        return;
      }

      const jaVinculado = vinculos.find((v) => v.idClienteRelacionado === item.idCliente);
      if (jaVinculado) {
        abrirVinculo(jaVinculado);
        onToast({
          type: "info",
          title: "Cadastro já vinculado",
          description: "Este cadastro já possui vínculo com este cliente. Abrimos para edição."
        });
        return;
      }

      adicionarVinculo({
        ...novoVinculoEmBranco(),
        idClienteRelacionado: item.idCliente,
        nome: item.nome,
        documento: item.documento,
        tipoRelacao: tipoRelacaoInicial || TIPO_RELACAO_PADRAO
      });
      onToast({
        type: "success",
        title: "Cadastro criado",
        description: "Confirme o vínculo para concluir."
      });
    })();
    // Só na volta do cadastro novo; as demais dependências mudam a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vinculoInicialId, isEditAllowed]);

  // ── Busca por CPF/CNPJ ──
  async function buscar() {
    const termo = busca.trim();
    const digitos = normalizeDocumentDigits(termo);
    setResultado(null);
    setDuplicado(null);
    setBuscouSemResultado(false);

    if (!digitos) {
      setErroBusca("Informe o CPF ou CNPJ para buscar.");
      return;
    }

    const validacao = validateDocumentByTipo(digitos, digitos.length > 11 ? "CNPJ" : "CPF");
    if (!validacao.isValid) {
      setErroBusca(validacao.message || "Documento inválido.");
      return;
    }

    setErroBusca(null);
    setBuscando(true);
    const encontrado = await searchCadastroVinculoByDocumento(termo);
    setBuscando(false);

    if (!encontrado) {
      setBuscouSemResultado(true);
      return;
    }

    if (encontrado.idCliente === Number(idClienteOrigem)) {
      setErroBusca("Não é permitido criar vínculo com o próprio cadastro.");
      return;
    }

    const existente = vinculos.find(
      (item) => item.id !== abertoId && item.idClienteRelacionado === encontrado.idCliente
    );
    if (existente) {
      setDuplicado(existente);
      return;
    }

    setResultado(encontrado);
  }

  function selecionar(index: number, candidato: SearchCadastroVinculoItem) {
    onChange(
      vinculos.map((item, i) =>
        i === index
          ? {
              ...item,
              idClienteRelacionado: candidato.idCliente,
              nome: candidato.nome,
              documento: candidato.documento,
              tipoRelacao: item.tipoRelacao || TIPO_RELACAO_PADRAO
            }
          : item
      )
    );
    limparBusca();
  }

  /** Abandona o vínculo novo em edição e abre o já existente. */
  function editarExistente(indexAtual: number, existente: CadastroVinculoComercial) {
    if (!original) {
      onChange(vinculos.filter((_, i) => i !== indexAtual));
    }
    limparBusca();
    setOriginal(existente);
    setAbertoId(existente.id);
  }

  // ── Persistência imediata ──
  async function concluirVinculo(index: number) {
    const vinculo = vinculos[index];
    if (!vinculo.idClienteRelacionado) {
      onToast({
        type: "warning",
        title: "Selecione um cadastro",
        description: "Busque o CPF/CNPJ e clique no resultado antes de concluir o vínculo."
      });
      return;
    }

    const tipo = vinculo.tipoRelacao.trim() || TIPO_RELACAO_PADRAO;

    if (!persistirImediato) {
      onChange(vinculos.map((item, i) => (i === index ? { ...item, tipoRelacao: tipo } : item)));
      fechar();
      onToast({
        type: "success",
        title: "Vínculo pronto",
        description: "Salve o cadastro para gravar o vínculo."
      });
      return;
    }

    setSalvandoId(vinculo.id);
    const resposta = ehVinculoNovo(vinculo.id)
      ? await createCadastroVinculosComerciais([
          {
            id_cliente_principal: Number(idClienteOrigem),
            id_cliente_socio: vinculo.idClienteRelacionado,
            tipo_relacao: tipo
          }
        ])
      : await updateCadastroVinculoComercial(vinculo.id, { tipo_relacao: tipo });

    if (!resposta.success) {
      setSalvandoId(null);
      // Erro não apaga nada: o formulário segue aberto com o que foi preenchido.
      onToast({
        type: "error",
        title: "Não foi possível salvar o vínculo",
        description: resposta.errorMessage || "Tente novamente."
      });
      return;
    }

    const lista = await listCadastroVinculosComerciais(idClienteOrigem);
    setSalvandoId(null);

    const gravado = lista.some((item) => item.idClienteRelacionado === vinculo.idClienteRelacionado);
    if (!gravado) {
      onToast({
        type: "error",
        title: "Vínculo não confirmado",
        description: "O banco não retornou o vínculo. Recarregue a tela e tente de novo."
      });
      return;
    }

    onChange(lista);
    fechar();
    onToast({
      type: "success",
      title: "Vínculo salvo",
      description: "Gravado no banco — não depende do salvar do cadastro."
    });
  }

  async function removerVinculo(index: number) {
    const vinculo = vinculos[index];

    if (ehVinculoNovo(vinculo.id)) {
      onChange(vinculos.filter((_, i) => i !== index));
      onToast({ type: "warning", title: "Vínculo removido", description: "Vínculo removido do formulário." });
      return;
    }

    setRemovendoId(vinculo.id);

    if (vinculo.idClienteRelacionado) {
      const { blocked, reason, errorMessage } = await checkVinculoRemovability(vinculo.idClienteRelacionado);
      if (blocked) {
        setRemovendoId(null);
        const message = reason || errorMessage || "Este vínculo não pode ser removido.";
        onToast({
          type: "error",
          title: "Remoção bloqueada",
          description:
            reason === "Este vínculo possui histórico financeiro."
              ? "Este vínculo possui histórico financeiro. A desativação exige campo próprio em fase futura."
              : message
        });
        return;
      }
    }

    const deleteResult = await deleteVinculoComercial(vinculo.id);
    if (!deleteResult.success) {
      setRemovendoId(null);
      onToast({
        type: "error",
        title: "Erro ao excluir",
        description: deleteResult.errorMessage || "Não foi possível excluir o vínculo."
      });
      return;
    }

    const lista = persistirImediato
      ? await listCadastroVinculosComerciais(idClienteOrigem)
      : vinculos.filter((_, i) => i !== index);
    setRemovendoId(null);
    onChange(lista);
    if (abertoId === vinculo.id) fechar();
    onToast({ type: "success", title: "Vínculo removido", description: "Removido do banco com sucesso." });
  }

  // ── Recorte da lista: pesquisa + limite compacto ──
  const termoFiltro = filtro.trim().toLowerCase();
  const digitosFiltro = normalizeDocumentDigits(filtro);
  // Só compara documento quando o termo é mesmo um documento (dígitos e
  // pontuação). Senão "3TEC" viraria o dígito "3" e casaria com qualquer CNPJ.
  const filtrarPorDocumento = digitosFiltro.length > 0 && /^[\d.\-/\s]+$/.test(filtro.trim());
  const filtrados = termoFiltro
    ? vinculos.filter((item) => {
        const alvo = `${item.nome} ${item.tipoRelacao}`.toLowerCase();
        return (
          alvo.includes(termoFiltro) ||
          (filtrarPorDocumento && normalizeDocumentDigits(item.documento).includes(digitosFiltro))
        );
      })
    : vinculos;

  const visiveis = mostrarTodos ? filtrados : filtrados.slice(0, LIMITE_VISIVEL);
  // O vínculo em edição nunca some por causa do filtro ou do limite.
  const listaFinal = [...visiveis];
  if (abertoId && !listaFinal.some((item) => item.id === abertoId)) {
    const aberto = vinculos.find((item) => item.id === abertoId);
    if (aberto) listaFinal.unshift(aberto);
  }

  const temPesquisa = vinculos.length > LIMITE_VISIVEL;
  const ocultos = filtrados.length - visiveis.length;

  return (
    // Mesma casca do FormSection do formulário de cadastro; o card precisa
    // controlar o próprio botão de ação, por isso não usa o wrapper de lá.
    <section className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Dados da Nota Fiscal</h2>
          <p className="mt-1 text-sm text-slate-500">
            Cadastros autorizados ou relacionados comercialmente a este cliente.
          </p>
        </div>
        {isEditAllowed && (
          <button
            type="button"
            onClick={() => adicionarVinculo()}
            disabled={abertoId !== null || ocupado}
            title={abertoId !== null ? "Conclua o vínculo em edição primeiro" : undefined}
            className="inline-flex items-center gap-2 rounded-2xl border border-[#d7e5e8] bg-white px-4 py-2.5 text-sm font-semibold text-[#0b2f4a] hover:bg-[#f3f7f8] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Adicionar vínculo
          </button>
        )}
      </div>

      <div className="space-y-3">
      {isEditAllowed && !persistirImediato && (
        <p className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          Neste cadastro novo os vínculos são gravados junto com o cliente, ao salvar. Depois de criado,
          cada vínculo passa a ser salvo na hora.
        </p>
      )}

      {temPesquisa && (
        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-[#0f9f9a]" />
          <input
            value={filtro}
            onChange={(event) => {
              setFiltro(event.target.value);
              setMostrarTodos(false);
            }}
            placeholder="Pesquisar vínculo por nome, CPF ou CNPJ..."
            aria-label="Pesquisar vínculo por nome, CPF ou CNPJ"
            className="w-full bg-transparent text-sm text-slate-900 outline-none"
          />
        </label>
      )}

      {vinculos.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
          Nenhum vínculo cadastrado.
          {isEditAllowed ? " Use “Adicionar vínculo” para relacionar outro cadastro a este cliente." : ""}
        </p>
      )}

      {vinculos.length > 0 && filtrados.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
          Nenhum vínculo encontrado para “{filtro.trim()}”.
        </p>
      )}

      {abertoId !== null && vinculos.length > 1 && (
        <p className="text-xs text-slate-500">Concluir ou cancelar o vínculo em edição libera as demais ações.</p>
      )}

      {listaFinal.map((vinculo) => {
        const index = vinculos.findIndex((item) => item.id === vinculo.id);
        const aberto = abertoId === vinculo.id;
        const selecionado = Boolean(vinculo.idClienteRelacionado);
        const outroAberto = abertoId !== null && !aberto;
        const salvando = salvandoId === vinculo.id;
        const removendo = removendoId === vinculo.id;

        // ── Linha compacta ──
        if (!aberto) {
          return (
            <div
              key={vinculo.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-semibold text-slate-900">
                    {vinculo.nome || "Cadastro não selecionado"}
                  </p>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                    {vinculo.tipoRelacao || TIPO_RELACAO_PADRAO}
                  </span>
                  {!selecionado && (
                    <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-800">
                      Incompleto
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {vinculo.documento
                    ? formatDocument(vinculo.documento)
                    : "Sem documento — edite para buscar o cadastro."}
                </p>
              </div>
              {isEditAllowed && (
                <div className="flex shrink-0 items-center gap-1">
                  {removendo && <span className="mr-1 text-xs font-semibold text-slate-500">Removendo...</span>}
                  <button
                    type="button"
                    onClick={() => abrirVinculo(vinculo)}
                    disabled={outroAberto || ocupado}
                    title={outroAberto ? "Conclua o vínculo em edição primeiro" : "Editar vínculo"}
                    aria-label="Editar vínculo"
                    className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void removerVinculo(index)}
                    disabled={outroAberto || ocupado}
                    title={outroAberto ? "Conclua o vínculo em edição primeiro" : "Remover vínculo"}
                    aria-label="Remover vínculo"
                    className="rounded-xl border border-red-200 bg-white p-2.5 text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          );
        }

        // ── Formulário expandido: buscar → selecionar → concluir ──
        return (
          <div key={vinculo.id} className="space-y-4 rounded-3xl border-2 border-[#0f9f9a] bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">
                {original ? "Editando vínculo" : "Novo vínculo"}
              </p>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {selecionado ? "Passo 2 de 2 — confirme e conclua" : "Passo 1 de 2 — busque o cadastro"}
              </span>
            </div>

            <label className="block space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {selecionado ? "Trocar cadastro (opcional) — buscar outro CPF ou CNPJ" : "Buscar cadastro pelo CPF ou CNPJ"}
              </span>
              <div className="flex gap-2">
                <input
                  value={busca}
                  readOnly={!isEditAllowed}
                  placeholder="Somente números ou com pontuação"
                  onChange={(event) => {
                    setBusca(event.target.value);
                    setErroBusca(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && isEditAllowed) {
                      event.preventDefault();
                      void buscar();
                    }
                  }}
                  className={
                    erroBusca
                      ? `${inputClass} border-red-300`
                      : !isEditAllowed
                        ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed`
                        : inputClass
                  }
                />
                {isEditAllowed && (
                  <button
                    type="button"
                    onClick={() => void buscar()}
                    disabled={buscando}
                    className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Search className="h-4 w-4" />
                    {buscando ? "Buscando..." : "Buscar"}
                  </button>
                )}
              </div>
            </label>
            {erroBusca ? <p className="text-xs font-medium text-red-600">{erroBusca}</p> : null}

            {duplicado ? (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">
                  Este cadastro já possui vínculo com este cliente.
                </p>
                <p className="mt-1 text-sm text-amber-800">
                  {duplicado.nome} · {formatDocument(duplicado.documento)} · {duplicado.tipoRelacao}
                </p>
                {isEditAllowed && (
                  <button
                    type="button"
                    onClick={() => editarExistente(index, duplicado)}
                    className="mt-3 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-amber-900 shadow-sm transition hover:bg-amber-100"
                  >
                    Editar vínculo existente
                  </button>
                )}
              </div>
            ) : resultado ? (
              <button
                type="button"
                onClick={() => selecionar(index, resultado)}
                className="w-full rounded-2xl border-2 border-[#0f9f9a] bg-[#eefaf9] p-4 text-left transition hover:bg-[#dff5f3] focus:outline-none focus:ring-4 focus:ring-[#dff8f6]"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-[#0b6e6a]">
                  Cadastro encontrado. Clique para selecionar.
                </p>
                <p className="mt-1 font-semibold text-slate-900">{resultado.nome}</p>
                <p className="text-sm text-slate-600">
                  #{resultado.idCliente} · {formatDocument(resultado.documento)}
                </p>
              </button>
            ) : buscouSemResultado ? (
              <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 text-center">
                <p className="text-sm font-medium text-orange-800">
                  Nenhum cadastro encontrado para o documento informado.
                </p>
                {isEditAllowed && (
                  <Link
                    href={`/cadastros/novo?documento=${normalizeDocumentDigits(busca)}&origemVinculo=${idClienteOrigem}&tipoRelacao=${encodeURIComponent(vinculo.tipoRelacao || TIPO_RELACAO_PADRAO)}`}
                    className="mt-3 inline-block rounded-xl bg-white px-4 py-2 text-sm font-semibold text-orange-900 shadow-sm transition hover:bg-orange-100"
                  >
                    + Novo Cadastro
                  </Link>
                )}
                {isEditAllowed && (
                  <p className="mt-2 text-xs text-orange-700">
                    Ao salvar o novo cadastro você volta para cá com ele já selecionado.
                  </p>
                )}
              </div>
            ) : null}

            {selecionado ? (
              <div className="rounded-2xl border border-[#0f9f9a] bg-white p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-[#0b6e6a]">
                  <CheckCircle2 className="h-4 w-4" />
                  Cadastro selecionado
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">ID relacionado</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">#{vinculo.idClienteRelacionado}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nome</p>
                    <p className="mt-1 truncate text-sm font-semibold text-slate-900">{vinculo.nome}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Documento</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{formatDocument(vinculo.documento)}</p>
                  </div>
                </div>
                <label className="mt-4 block space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tipo de relacao</span>
                  <input
                    value={vinculo.tipoRelacao}
                    readOnly={!isEditAllowed}
                    onChange={(event) => atualizarTipo(index, event.target.value)}
                    className={!isEditAllowed ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : inputClass}
                    placeholder="autorizado"
                  />
                </label>
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                Busque o CPF/CNPJ acima e clique no resultado para selecionar o cadastro deste vínculo.
              </p>
            )}

            {isEditAllowed && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => cancelarVinculo(index)}
                  disabled={salvando}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void concluirVinculo(index)}
                  disabled={!selecionado || salvando}
                  title={selecionado ? undefined : "Selecione um cadastro para concluir"}
                  className="rounded-2xl bg-[#0b2f4a] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#123f60] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {salvando ? "Salvando..." : original ? "Salvar vínculo" : "Adicionar vínculo"}
                </button>
              </div>
            )}
            <p className="text-right text-xs text-slate-500">
              {persistirImediato
                ? "Gravado no banco assim que você concluir — sem depender do salvar do cadastro."
                : "O vínculo é gravado no banco quando você salvar o cadastro."}
            </p>
          </div>
        );
      })}

      {(ocultos > 0 || (mostrarTodos && filtrados.length > LIMITE_VISIVEL)) && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <p className="text-xs text-slate-500">
            Mostrando {Math.min(visiveis.length, filtrados.length)} de {filtrados.length}
            {filtrados.length !== vinculos.length ? ` (${vinculos.length} no total)` : ""}
          </p>
          <button
            type="button"
            onClick={() => setMostrarTodos((atual) => !atual)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            {mostrarTodos ? "Mostrar menos" : `Mostrar todos (${filtrados.length})`}
          </button>
        </div>
      )}
      </div>
    </section>
  );
}
