import { normalizarTipoContribuinte, OPCOES_TIPO_CONTRIBUINTE } from "@/lib/fiscal/tipo-contribuinte";
import type {
  ReconsultaCamposCadastro,
  ReconsultaEnderecoReceita
} from "@/features/cadastros/services/cadastros.service";
import type { CadastroEndereco, CadastroFormState } from "@/features/cadastros/types";

/**
 * A REGRA da reconsulta de CNPJ, fora da tela.
 *
 * POR QUE E UM MODULO PROPRIO
 *   Isto decide o que sera SOBRESCRITO num cadastro que ja existe — inclusive o
 *   endereco principal, que alimenta a etiqueta dos Correios e o destinatario da
 *   NF-e. Regra dessa consequencia nao pode morar dentro de um componente de
 *   2.500 linhas, onde nenhum teste alcanca. Aqui ela e pura: entra o que esta
 *   gravado e o que a Receita devolveu, sai a lista do que muda.
 *
 *   `scripts/testes/reconsulta-cnpj.test.mts` exercita exatamente estas funcoes
 *   — as mesmas que a tela usa, nao uma copia.
 */

/** O que a rota `/api/cadastros/consultar-documento` devolve. */
export type ConsultaDocumentoApiPayload = {
  nome: string;
  fantasia: string;
  documento: string;
  tipoPessoa: "FISICA" | "JURIDICA";
  dataFundacao: string;
  emailContato: string;
  telefoneFixo: string;
  cidadeUf: string;
  insEstadual: string;
  tipoContribuinte: string;
  enderecoPreparado: {
    // `null` no cadastro automatico (o numero so existe apos o insert). A
    // reconsulta, que e de edicao, sempre manda o id — este campo nao e lido.
    id_cliente: number | null;
    cep: string;
    endereco: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    uf: string;
    tipo_endereco: "PRINCIPAL";
    obs: string;
  } | null;
};

/** Uma linha da comparação: o que está gravado × o que a Receita devolveu. */
export interface LinhaComparacaoReconsulta {
  rotulo: string;
  atual: string;
  novo: string;
  mudou: boolean;
}

/**
 * O que a reconsulta vai fazer, decidido ANTES de gravar.
 *
 * Existe para que a tela mostre e o usuário confirme exatamente aquilo que será
 * gravado — sem recalcular nada depois do "Aplicar". O que está aqui é o que vai.
 */
export interface ReconsultaPrevia {
  /** As linhas da tabela do modal. */
  campos: LinhaComparacaoReconsulta[];
  /** Só os campos que MUDAM, no formato das colunas de `clientes`. */
  camposParaGravar: ReconsultaCamposCadastro;
  /** Espelho dos mesmos campos no estado do formulário. */
  camposParaFormulario: Partial<CadastroFormState>;
  /** `null` quando a consulta não devolveu endereço ou quando ele não mudou. */
  enderecoParaGravar: ReconsultaEnderecoReceita | null;
  enderecoAtualTexto: string | null;
  enderecoNovoTexto: string | null;
  enderecoMudou: boolean;
  criaEnderecoPrincipal: boolean;
}

/** Uma linha de endereço em texto corrido, do jeito que sai numa etiqueta. */
export function formatarEnderecoLinha(endereco: {
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
}): string {
  const logradouro = [endereco.endereco, endereco.numero]
    .map((parte) => (parte || "").trim())
    .filter(Boolean)
    .join(", ");
  const cidadeUf = [endereco.cidade, endereco.uf]
    .map((parte) => (parte || "").trim())
    .filter(Boolean)
    .join("/");
  const cep = (endereco.cep || "").replace(/\D/g, "");
  return [
    logradouro,
    (endereco.complemento || "").trim(),
    (endereco.bairro || "").trim(),
    cidadeUf,
    cep ? `CEP ${cep}` : ""
  ]
    .filter(Boolean)
    .join(" — ");
}

/** O rótulo do drop, para o modal não mostrar só o número cru. */
export function rotuloTipoContribuinte(codigo: string): string {
  return OPCOES_TIPO_CONTRIBUINTE.find((opcao) => opcao.valor === codigo)?.rotulo ?? codigo;
}

/**
 * Compara o que está gravado com o que a Receita devolveu.
 *
 * DUAS REGRAS GOVERNAM TUDO AQUI:
 *
 *   1. CAMPO VAZIO NA RECEITA NÃO ENTRA. Nem na tabela, nem na gravação. A
 *      consulta não saber um telefone não é motivo para apagar o telefone que o
 *      Comercial digitou. É também o que protege whatsapp, limite de crédito,
 *      vendedor e todo o resto que a Receita nem conhece.
 *   2. SÓ O QUE MUDA É GRAVADO. Campo igual aparece na tabela (para o usuário
 *      ver que a Receita confirmou) mas fica fora do UPDATE.
 *
 * O ENDEREÇO segue regra própria: é um bloco único, tudo ou nada. Meia troca —
 * rua nova com bairro velho — seria pior do que não trocar.
 */
export function montarPreviaReconsulta(
  form: Pick<
    CadastroFormState,
    | "nome"
    | "fantasia"
    | "dataFundacao"
    | "email"
    | "telefoneFixo"
    | "cidadeUf"
    | "inscricaoEstadual"
    | "tipoContribuinte"
    | "enderecos"
  >,
  payload: ConsultaDocumentoApiPayload
): ReconsultaPrevia {
  const tipoContribuinteAtual = normalizarTipoContribuinte(form.tipoContribuinte) ?? "";

  const definicoes: Array<{
    rotulo: string;
    atual: string;
    novo: string;
    colunas: Array<keyof ReconsultaCamposCadastro>;
    campoForm: keyof CadastroFormState;
    exibir?: (valor: string) => string;
  }> = [
    { rotulo: "Razão social", atual: form.nome, novo: payload.nome, colunas: ["nome"], campoForm: "nome" },
    { rotulo: "Nome fantasia", atual: form.fantasia, novo: payload.fantasia, colunas: ["fantasia"], campoForm: "fantasia" },
    { rotulo: "Data de fundação", atual: form.dataFundacao, novo: payload.dataFundacao, colunas: ["data_fundacao"], campoForm: "dataFundacao" },
    // O mesmo e-mail mora em duas colunas desde antes desta rodada; manter as
    // duas em sincronia é o comportamento já existente do salvamento normal.
    { rotulo: "E-mail", atual: form.email, novo: payload.emailContato, colunas: ["email_contato", "email"], campoForm: "email" },
    { rotulo: "Telefone fixo", atual: form.telefoneFixo, novo: payload.telefoneFixo, colunas: ["telefone_fixo"], campoForm: "telefoneFixo" },
    { rotulo: "Cidade / UF", atual: form.cidadeUf, novo: payload.cidadeUf, colunas: ["cidade_uf"], campoForm: "cidadeUf" },
    { rotulo: "Inscrição estadual", atual: form.inscricaoEstadual, novo: payload.insEstadual, colunas: ["ins_estadual"], campoForm: "inscricaoEstadual" },
    {
      rotulo: "Tipo de contribuinte",
      atual: tipoContribuinteAtual,
      novo: payload.tipoContribuinte,
      colunas: ["tipo_contribuinte"],
      campoForm: "tipoContribuinte",
      exibir: rotuloTipoContribuinte
    }
  ];

  const campos: LinhaComparacaoReconsulta[] = [];
  const camposParaGravar: ReconsultaCamposCadastro = {};
  const camposParaFormulario: Partial<CadastroFormState> = {};

  definicoes.forEach((definicao) => {
    const novo = (definicao.novo || "").trim();
    if (!novo) return; // regra 1: a Receita não disse nada sobre este campo.

    const atual = (definicao.atual || "").trim();
    const mudou = novo !== atual;

    campos.push({
      rotulo: definicao.rotulo,
      atual: atual ? (definicao.exibir ? definicao.exibir(atual) : atual) : "",
      novo: definicao.exibir ? definicao.exibir(novo) : novo,
      mudou
    });

    if (!mudou) return; // regra 2.
    definicao.colunas.forEach((coluna) => {
      camposParaGravar[coluna] = novo;
    });
    Object.assign(camposParaFormulario, { [definicao.campoForm]: novo });
  });

  const preparado = payload.enderecoPreparado;
  const enderecoNovo: ReconsultaEnderecoReceita | null = preparado
    ? {
        cep: preparado.cep || "",
        endereco: preparado.endereco || "",
        numero: preparado.numero || "",
        complemento: preparado.complemento || "",
        bairro: preparado.bairro || "",
        cidade: preparado.cidade || "",
        uf: (preparado.uf || "").toUpperCase().slice(0, 2)
      }
    : null;

  const principalAtual = form.enderecos.find((item) => item.tipo === "principal") ?? null;
  const enderecoAtualTexto = principalAtual ? formatarEnderecoLinha(principalAtual) : null;
  const enderecoNovoTexto = enderecoNovo ? formatarEnderecoLinha(enderecoNovo) : null;
  const criaEnderecoPrincipal = principalAtual === null;
  const enderecoMudou = Boolean(enderecoNovo) && enderecoNovoTexto !== enderecoAtualTexto;

  return {
    campos,
    camposParaGravar,
    camposParaFormulario,
    // Endereço idêntico não é regravado: seria só trocar a assinatura de `obs`
    // por uma nova, sugerindo uma correção que não houve.
    enderecoParaGravar: enderecoNovo && (enderecoMudou || criaEnderecoPrincipal) ? enderecoNovo : null,
    enderecoAtualTexto,
    enderecoNovoTexto,
    enderecoMudou,
    criaEnderecoPrincipal
  };
}

/**
 * Espelha no formulário o que acabou de ser gravado, para a tela não precisar
 * de recarga.
 *
 * O `id` vem do BANCO (`enderecoId`), nunca inventado: um id temporário faria o
 * próximo "Salvar" INSERIR uma segunda linha principal em vez de atualizar
 * esta. Sem id devolvido, o endereço não entra no estado — a tela fica
 * desatualizada até o refresh, o que é muito melhor do que duplicar.
 */
export function aplicarReconsultaNoFormulario(
  atual: CadastroFormState,
  previa: ReconsultaPrevia,
  enderecoId: string | undefined,
  enderecoObs: string | undefined
): CadastroFormState {
  const proximo: CadastroFormState = { ...atual, ...previa.camposParaFormulario };

  if (!previa.enderecoParaGravar || !enderecoId) return proximo;

  const novoPrincipal: CadastroEndereco = {
    id: enderecoId,
    tipo: "principal",
    cep: previa.enderecoParaGravar.cep,
    endereco: previa.enderecoParaGravar.endereco,
    numero: previa.enderecoParaGravar.numero,
    complemento: previa.enderecoParaGravar.complemento,
    bairro: previa.enderecoParaGravar.bairro,
    cidade: previa.enderecoParaGravar.cidade,
    uf: previa.enderecoParaGravar.uf,
    obs: enderecoObs ?? "",
    recebedor: "",
    cpfRecebedor: ""
  };

  const indicePrincipal = proximo.enderecos.findIndex((item) => item.tipo === "principal");
  if (indicePrincipal === -1) {
    // Principal recém-criado entra na frente, como em qualquer cadastro novo.
    proximo.enderecos = [novoPrincipal, ...proximo.enderecos];
  } else {
    proximo.enderecos = proximo.enderecos.map((item, indice) =>
      indice === indicePrincipal ? { ...item, ...novoPrincipal } : item
    );
  }

  return proximo;
}
