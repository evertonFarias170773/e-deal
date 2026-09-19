"use client";

import { useState } from "react";
import { Search } from "lucide-react";

import { useAppToast } from "@/components/common/AppToast";
import { normalizeDocumentDigits, isValidCpf, isValidCnpj, formatDocumentDigits } from "@/features/cadastros/utils/documento";
import { fetchComSessao } from "@/lib/supabase/sessao";

/**
 * "Adicionar novo sócio" SEM SAIR DO ORÇAMENTO — bloco 4 (19/09/2026).
 *
 * Antes este botão abria o cadastro do cliente em outra aba e o atendente
 * percorria ~13 passos, terminando num F5 para o sócio aparecer na lista. Aqui
 * ele digita o documento, vê o que vai acontecer e confirma UMA vez.
 *
 * QUATRO DESFECHOS, decididos pelo SERVIDOR (`/api/orcamentos/socio-pagador`):
 *   A — já é vínculo do cliente  → seleciona como pagador, sem escrever nada;
 *   B — tem cadastro, sem vínculo → confirma, e a rota cria o vínculo;
 *   C — CNPJ sem cadastro        → prévia da Receita e, ao confirmar, a rota
 *       cria cadastro + endereço + vínculo;
 *   D — CPF sem cadastro         → segue manual, porque não há consulta pública
 *       de CPF. A tela diz isso e não inventa caminho.
 *
 * A CONSULTA DO CNPJ é a MESMA da tela "Novo cliente"
 * (`/api/cadastros/consultar-documento`, no modo reconsulta para não tropeçar
 * na guarda de duplicidade): o sócio nasce com os mesmos dados que nasceria por
 * lá.
 *
 * CLIQUE DUPLO: o botão fica desabilitado enquanto a promessa está no ar, e a
 * rota é repetível por construção (procura o documento antes de criar). Duas
 * tentativas não geram dois cadastros nem dois vínculos.
 */

export type SocioConfirmado = {
  idCliente: number;
  nome: string;
  fantasia: string | null;
  documento: string;
  tipoRelacao: string;
  enderecoPrincipalId: string | null;
};

type Previa = {
  nome: string;
  fantasia?: string | null;
  emailContato?: string | null;
  telefoneFixo?: string | null;
  cidadeUf?: string | null;
  insEstadual?: string | null;
  tipoContribuinte?: string | null;
  dataFundacao?: string | null;
  endereco?: SocioConfirmado extends never ? never : {
    cep: string;
    endereco: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    uf: string;
  } | null;
};

type Estado =
  | { fase: "vazio" }
  | { fase: "achado_vinculado"; socio: SocioConfirmado }
  | { fase: "achado_sem_vinculo"; socio: SocioConfirmado }
  | { fase: "novo_cnpj"; previa: Previa }
  | { fase: "cpf_sem_cadastro" }
  | { fase: "recado"; texto: string };

type Props = {
  /** `0` quando o orçamento ainda não foi salvo — a rota aceita e não grava pagador. */
  idInt: number;
  /** Dono do vínculo. Indispensável no orçamento novo, onde não há proposta. */
  idClientePrincipal: number;
  /** Trava da proposta (mesma da tela) ou pedido complementar. */
  desabilitado: boolean;
  motivoDesabilitado?: string;
  onSocioPronto: (socio: SocioConfirmado) => void;
  inputClassName: string;
};

export function SocioPagadorInline({
  idInt,
  idClientePrincipal,
  desabilitado,
  motivoDesabilitado,
  onSocioPronto,
  inputClassName
}: Props) {
  const { showToast } = useAppToast();
  const [aberto, setAberto] = useState(false);
  const [documento, setDocumento] = useState("");
  const [estado, setEstado] = useState<Estado>({ fase: "vazio" });
  const [ocupado, setOcupado] = useState(false);

  const digitos = normalizeDocumentDigits(documento);
  const documentoValido = digitos.length === 14 ? isValidCnpj(digitos) : isValidCpf(digitos);

  /**
   * Em orçamento NOVO não há `idInt`: a rota recebe o cliente principal e faz
   * tudo menos gravar o pagador, que sai no primeiro Salvar.
   */
  const alvo = idInt > 0 ? { idInt } : { idClientePrincipal };

  function fechar() {
    setAberto(false);
    setDocumento("");
    setEstado({ fase: "vazio" });
  }

  async function buscar() {
    if (ocupado) return;
    if (!documentoValido) {
      showToast({
        type: "error",
        title: "Documento inválido",
        description: "Confira os dígitos do CPF ou CNPJ — nenhuma consulta foi feita."
      });
      return;
    }

    setOcupado(true);
    setEstado({ fase: "vazio" });
    try {
      const resposta = await fetchComSessao("/api/orcamentos/socio-pagador", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "buscar", ...alvo, documento: digitos })
      });
      const corpo = (await resposta.json().catch(() => ({}))) as {
        success?: boolean;
        caso?: "A" | "B" | "C" | "D" | "PROPRIO_CLIENTE";
        socio?: SocioConfirmado;
        message?: string;
      };

      if (!resposta.ok || !corpo?.success) {
        setEstado({ fase: "recado", texto: corpo?.message || "Não foi possível consultar agora." });
        return;
      }

      if (corpo.caso === "PROPRIO_CLIENTE") {
        setEstado({ fase: "recado", texto: corpo.message || "Este é o próprio cliente da proposta." });
        return;
      }
      if (corpo.caso === "A" && corpo.socio) {
        setEstado({ fase: "achado_vinculado", socio: corpo.socio });
        return;
      }
      if (corpo.caso === "B" && corpo.socio) {
        setEstado({ fase: "achado_sem_vinculo", socio: corpo.socio });
        return;
      }
      if (corpo.caso === "D") {
        setEstado({ fase: "cpf_sem_cadastro" });
        return;
      }

      // Caso C: sem cadastro e é CNPJ — a prévia vem da consulta oficial.
      const consulta = await fetchComSessao("/api/cadastros/consultar-documento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipoPessoa: "JURIDICA", documento: digitos, modo: "reconsulta" })
      });
      const dados = (await consulta.json().catch(() => ({}))) as {
        success?: boolean;
        payload?: {
          nome: string;
          fantasia: string;
          emailContato: string;
          telefoneFixo: string;
          cidadeUf: string;
          insEstadual: string;
          tipoContribuinte: string;
          dataFundacao: string;
          enderecoPreparado: Previa["endereco"];
        };
        message?: string;
      };

      if (!consulta.ok || !dados?.success || !dados.payload?.nome) {
        setEstado({
          fase: "recado",
          texto: dados?.message || "A consulta do CNPJ não respondeu. Cadastre o sócio pela tela de Clientes."
        });
        return;
      }

      setEstado({
        fase: "novo_cnpj",
        previa: {
          nome: dados.payload.nome,
          fantasia: dados.payload.fantasia,
          emailContato: dados.payload.emailContato,
          telefoneFixo: dados.payload.telefoneFixo,
          cidadeUf: dados.payload.cidadeUf,
          insEstadual: dados.payload.insEstadual,
          tipoContribuinte: dados.payload.tipoContribuinte,
          dataFundacao: dados.payload.dataFundacao,
          endereco: dados.payload.enderecoPreparado
        }
      });
    } catch (erro) {
      setEstado({
        fase: "recado",
        texto: erro instanceof Error ? erro.message : "Sem resposta do servidor."
      });
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar(cadastroNovo?: Previa) {
    if (ocupado) return;
    setOcupado(true);
    try {
      const resposta = await fetchComSessao("/api/orcamentos/socio-pagador", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "confirmar", ...alvo, documento: digitos, cadastroNovo })
      });
      const corpo = (await resposta.json().catch(() => ({}))) as {
        success?: boolean;
        socio?: SocioConfirmado;
        criouCadastro?: boolean;
        criouVinculo?: boolean;
        message?: string;
      };

      if (!resposta.ok || !corpo?.success || !corpo.socio) {
        showToast({
          type: "error",
          title: "Não foi possível concluir",
          description: corpo?.message || "O servidor recusou a operação."
        });
        return;
      }

      onSocioPronto(corpo.socio);
      showToast({
        type: "success",
        title: corpo.criouCadastro ? "Sócio cadastrado e vinculado" : "Sócio vinculado",
        description: `${corpo.socio.nome} agora é o pagador desta proposta.`
      });
      fechar();
    } catch (erro) {
      showToast({
        type: "error",
        title: "Falha na comunicação",
        description: erro instanceof Error ? erro.message : "Sem resposta do servidor."
      });
    } finally {
      setOcupado(false);
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        disabled={desabilitado}
        title={desabilitado ? motivoDesabilitado : "Buscar pelo CPF/CNPJ e vincular sem sair daqui"}
        className="mt-4 rounded-2xl border border-[#d7e5e8] bg-white px-4 py-3 text-sm font-semibold text-[#0b2f4a] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        + Adicionar novo sócio
      </button>
    );
  }

  const rotuloOcupado = ocupado ? "Aguarde..." : null;

  return (
    <div className="mt-4 rounded-2xl border border-[#d7e5e8] bg-slate-50 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={documento}
          onChange={(evento) => {
            setDocumento(evento.target.value);
            setEstado({ fase: "vazio" });
          }}
          onKeyDown={(evento) => {
            if (evento.key === "Enter") {
              evento.preventDefault();
              void buscar();
            }
          }}
          placeholder="CPF ou CNPJ do sócio"
          maxLength={18}
          className={`${inputClassName} flex-1`}
          disabled={ocupado || desabilitado}
        />
        <button
          type="button"
          onClick={() => void buscar()}
          disabled={ocupado || desabilitado}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-2xl bg-[#0b2f4a] px-4 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Search className="h-4 w-4" />
          {rotuloOcupado ?? "Buscar"}
        </button>
        <button
          type="button"
          onClick={fechar}
          disabled={ocupado}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition disabled:opacity-60"
        >
          Cancelar
        </button>
      </div>

      {estado.fase === "achado_vinculado" ? (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-sm font-semibold text-slate-900">{estado.socio.nome}</p>
          <p className="text-xs text-slate-500">
            {formatDocumentDigits(estado.socio.documento)} · já é vínculo deste cliente
          </p>
          <button
            type="button"
            onClick={() => {
              onSocioPronto(estado.socio);
              showToast({ type: "success", title: "Pagador selecionado", description: estado.socio.nome });
              fechar();
            }}
            disabled={ocupado}
            className="mt-3 rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            Selecionar como pagador
          </button>
        </div>
      ) : null}

      {estado.fase === "achado_sem_vinculo" ? (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-sm font-semibold text-slate-900">{estado.socio.nome}</p>
          <p className="text-xs text-slate-500">
            {formatDocumentDigits(estado.socio.documento)} · cadastro existente, ainda sem vínculo
          </p>
          <button
            type="button"
            onClick={() => void confirmar()}
            disabled={ocupado}
            className="mt-3 rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {ocupado ? "Vinculando..." : "Vincular e usar como pagador"}
          </button>
        </div>
      ) : null}

      {estado.fase === "novo_cnpj" ? (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sem cadastro — dados da Receita</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{estado.previa.nome}</p>
          <p className="text-xs text-slate-500">
            {formatDocumentDigits(digitos)}
            {estado.previa.cidadeUf ? ` · ${estado.previa.cidadeUf}` : ""}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Ao confirmar: cria o cadastro, o endereço principal e o vínculo, e seleciona como pagador.
          </p>
          <button
            type="button"
            onClick={() => void confirmar(estado.previa)}
            disabled={ocupado}
            className="mt-3 rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {ocupado ? "Criando..." : "Confirmar e usar como pagador"}
          </button>
        </div>
      ) : null}

      {estado.fase === "cpf_sem_cadastro" ? (
        <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          CPF sem cadastro. Não há consulta pública de CPF: cadastre a pessoa na tela de Clientes e volte aqui para
          vinculá-la pelo documento.
        </p>
      ) : null}

      {estado.fase === "recado" ? (
        <p className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-700">{estado.texto}</p>
      ) : null}
    </div>
  );
}
