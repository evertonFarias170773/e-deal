"use client";

import { useState } from "react";

import { useAppToast } from "@/components/common/AppToast";
import { isValidCnpj, isValidCpf, normalizeDocumentDigits } from "@/features/cadastros/utils/documento";
import { fetchComSessao } from "@/lib/supabase/sessao";

/**
 * O documento do recebedor, o botão VALIDAR e a Inscrição Estadual — UMA vez.
 *
 * POR QUE COMPARTILHADO (17/09/2026)
 *   O bloco "Adicionar novo endereço" existe em dois lugares: o JSX inline do
 *   Cadastro de Cliente e o `AddressModal` da aba Geral da proposta. O botão
 *   VALIDAR já nasceu duplicado (824213c e 6d1fa22); aceitar CNPJ seria a
 *   terceira cópia da mesma regra. Aqui ela existe uma vez só, e as duas telas
 *   nunca mais discordam sobre o que é documento válido.
 *
 * O QUE ELE NÃO FAZ
 *   Não conhece o formato do estado de quem o usa. Ele devolve o resultado da
 *   consulta por `onValidado` e cada tela aplica no seu próprio rascunho — é o
 *   que permite que o Cadastro (um array de endereços) e a proposta (um
 *   rascunho único) compartilhem o mesmo código sem se contaminarem.
 *
 * SÓ POR CLIQUE
 *   Nada dispara por digitação, blur, abertura ou salvamento: a consulta gasta
 *   cota da empresa. A validação local vem ANTES e é ela que protege a cota —
 *   documento com dígito errado não chega a sair da máquina.
 *
 * FALHA NUNCA TRAVA NADA
 *   Qualquer desfecho ruim vira aviso na tela. Nome, IE e endereço seguem
 *   editáveis à mão, e salvar não depende de ter clicado aqui.
 */

export type ResultadoValidacaoRecebedor = {
  tipo: "CPF" | "CNPJ";
  /** Nome da pessoa (CPF) ou razão social (CNPJ). Nunca vazio. */
  nome: string;
  /** IE ativa na Receita. Vazia no CPF e no CNPJ sem inscrição. */
  insEstadual: string;
  /** Endereço campo a campo. `null` no CPF: a consulta de CPF não traz endereço. */
  endereco: {
    cep: string;
    endereco: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    uf: string;
  } | null;
};

type Props = {
  /** Valor cru do campo — pode vir com máscara do banco; o que vale são os dígitos. */
  documento: string;
  onDocumentoChange: (valor: string) => void;
  ie: string;
  onIeChange: (valor: string) => void;
  onValidado: (resultado: ResultadoValidacaoRecebedor) => void;
  inputClassName: string;
  botaoClassName?: string;
  /** Campos somente leitura (endereço principal de CNPJ, usuário sem permissão). */
  bloqueado?: boolean;
  /** Outra consulta em andamento na mesma tela. Só desabilita o botão. */
  ocupadoPorOutro?: boolean;
  /** Avisa a tela que esta consulta começou/terminou, para ela travar as outras. */
  onOcupadoChange?: (ocupado: boolean) => void;
};

const BOTAO_PADRAO =
  "inline-flex shrink-0 items-center gap-1.5 rounded-2xl border border-[#d7e5e8] bg-white px-3.5 py-3 text-xs font-bold text-[#0b2f4a] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Máscara que troca de forma pelo número de dígitos: CPF até 11, CNPJ a partir
 * do 12º. Aceita colagem já formatada — o que vale são os dígitos, e 18
 * caracteres é o tamanho de um CNPJ com máscara (00.000.000/0000-00).
 */
export function mascararDocumento(valor: string) {
  const digitos = normalizeDocumentDigits(valor).slice(0, 14);

  if (digitos.length <= 11) {
    return digitos
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }

  return digitos
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

/** O mesmo julgamento nos dois lugares: 11 dígitos é CPF, 14 é CNPJ. */
export function documentoRecebedorValido(valor: string) {
  const digitos = normalizeDocumentDigits(valor);
  if (digitos.length === 14) {
    return isValidCnpj(digitos);
  }

  return isValidCpf(digitos);
}

export function DocumentoRecebedorFields({
  documento,
  onDocumentoChange,
  ie,
  onIeChange,
  onValidado,
  inputClassName,
  botaoClassName = BOTAO_PADRAO,
  bloqueado = false,
  ocupadoPorOutro = false,
  onOcupadoChange
}: Props) {
  const { showToast } = useAppToast();
  const [validando, setValidando] = useState(false);

  function marcarOcupado(ocupado: boolean) {
    setValidando(ocupado);
    onOcupadoChange?.(ocupado);
  }

  async function validar() {
    const digitos = normalizeDocumentDigits(documento || "");

    if (!digitos) {
      showToast({
        type: "warning",
        title: "Informe o CPF ou CNPJ do recebedor",
        description: "Digite o documento antes de validar."
      });
      return;
    }

    const ehCnpj = digitos.length === 14;
    if (digitos.length !== 11 && !ehCnpj) {
      showToast({
        type: "error",
        title: "Documento do recebedor incompleto",
        description: "Informe 11 dígitos para CPF ou 14 para CNPJ — nenhuma consulta foi feita."
      });
      return;
    }

    if (ehCnpj ? !isValidCnpj(digitos) : !isValidCpf(digitos)) {
      showToast({
        type: "error",
        title: ehCnpj ? "CNPJ do recebedor invalido" : "CPF do recebedor invalido",
        description: "Os digitos nao conferem. Corrija o numero — nenhuma consulta foi feita."
      });
      return;
    }

    marcarOcupado(true);
    try {
      /*
        DUAS ROTAS, E NENHUMA DELAS É A DE CADASTRO.
          CPF  → /api/verificacao/cpf
          CNPJ → /api/verificacao (ramo CNPJ)
        As duas exigem sessão válida e leem o token só no servidor. A terceira,
        `/api/cadastros/consultar-documento`, recusa com 409 documento já
        cadastrado — correto ao criar cliente, errado aqui: o recebedor pode ser
        cliente da casa.
      */
      const resposta = ehCnpj
        ? await fetchComSessao("/api/verificacao", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tipo: "CNPJ", documento: digitos })
          })
        : await fetchComSessao("/api/verificacao/cpf", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cpf: digitos })
          });

      const corpo = (await resposta.json().catch(() => ({}))) as {
        success?: boolean;
        data?: {
          nome?: string;
          razaoSocial?: string;
          insEstadual?: string;
          enderecoCampos?: ResultadoValidacaoRecebedor["endereco"];
        };
        errorMessage?: string;
        message?: string;
      };

      const nome = String(corpo?.data?.nome ?? corpo?.data?.razaoSocial ?? "").trim();

      if (!resposta.ok || !corpo?.success || !nome) {
        showToast({
          type: "error",
          title: ehCnpj ? "Nao foi possivel validar o CNPJ" : "Nao foi possivel validar o CPF",
          description:
            corpo?.errorMessage ||
            corpo?.message ||
            "O servico de consulta nao respondeu. Preencha os dados a mao."
        });
        return;
      }

      const insEstadual = String(corpo?.data?.insEstadual ?? "").trim();
      const enderecoConsultado = ehCnpj ? corpo?.data?.enderecoCampos ?? null : null;

      onValidado({
        tipo: ehCnpj ? "CNPJ" : "CPF",
        nome,
        insEstadual,
        endereco: enderecoConsultado
      });

      showToast({
        type: "success",
        title: ehCnpj ? "CNPJ validado" : "CPF validado",
        description: ehCnpj
          ? "Razao social, endereco e IE preenchidos pela consulta."
          : "Nome do recebedor preenchido pela consulta."
      });
    } catch (erro) {
      showToast({
        type: "error",
        title: "Falha ao consultar o documento",
        description: erro instanceof Error ? erro.message : "Sem resposta do servico. Preencha os dados a mao."
      });
    } finally {
      marcarOcupado(false);
    }
  }

  return (
    <>
      <label className="block space-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          CPF / CNPJ do Recebedor
        </span>
        <div className="flex items-center gap-2">
          <input
            value={mascararDocumento(documento || "")}
            readOnly={bloqueado}
            onChange={(event) => onDocumentoChange(event.target.value)}
            className={`${inputClassName} flex-1`}
            placeholder="000.000.000-00 ou 00.000.000/0000-00"
            maxLength={18}
          />
          {/* Consulta SO por clique — ver o cabecalho deste arquivo. */}
          <button
            type="button"
            onClick={() => void validar()}
            disabled={bloqueado || validando || ocupadoPorOutro}
            title="Consulta o documento e preenche os dados do recebedor"
            className={botaoClassName}
          >
            {validando ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-[#0b2f4a]" />
                Validando…
              </>
            ) : (
              "Validar"
            )}
          </button>
        </div>
      </label>
      <label className="block space-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Inscrição Estadual do Recebedor
        </span>
        {/* SEMPRE digitável: a consulta preenche quando existe, e quem sabe a IE
            correta é quem está na frente do cliente. */}
        <input
          value={ie || ""}
          readOnly={bloqueado}
          onChange={(event) => onIeChange(event.target.value)}
          className={inputClassName}
          placeholder="ISENTO quando não houver"
        />
      </label>
    </>
  );
}
