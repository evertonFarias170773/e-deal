/**
 * Qual ambiente a tela mostra, e a qual PERGUNTA ela está respondendo.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 *   A tela exibia `notas_fiscais.ambiente` cru. Essa coluna é `NOT NULL DEFAULT
 *   'homologacao'`, e ninguém escreve o valor real no nascimento — os dois
 *   caminhos de `nfe.service.ts` cravam o literal e `fn_criar_rascunho_nfe` nem
 *   preenche o campo, caindo no default. Resultado medido em 12/09/2026: os 15
 *   rascunhos do banco diziam HOMOLOGAÇÃO, nas TRÊS empresas que estão em
 *   produção.
 *
 *   O payload sai certo — a rota resolve o ambiente e regrava a coluna ANTES de
 *   transmitir. Quem lia errado era o operador, e é ele quem decide clicar.
 *   Ver HOMOLOGAÇÃO num rascunho de empresa em produção e concluir "é teste"
 *   termina em NF-e real.
 *
 * DUAS PERGUNTAS DIFERENTES, E O RÓTULO DIZ QUAL ESTÁ SENDO RESPONDIDA
 *   Antes de transmitir, a pergunta é ONDE ISTO VAI SAIR — e quem responde é
 *   `empresas.ambiente_nfe`, o mesmo campo que a rota vai ler no envio.
 *   Depois de transmitir, a pergunta é ONDE ISTO SAIU — e aí só
 *   `notas_fiscais.ambiente` responde: é registro histórico, e a empresa pode
 *   ter virado de ambiente no meio do caminho.
 *
 *   Trocar o rótulo junto com o valor é o que impede a correção de virar uma
 *   ambiguidade nova. "PRODUÇÃO" sozinho não diz se já aconteceu.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O CRITÉRIO DE "JÁ TRANSMITIDA" NÃO PODE SER SÓ NÚMERO E CHAVE
 * ═══════════════════════════════════════════════════════════════════════════
 *   Nota transmitida que a SEFAZ REJEITOU não tem número nem chave — e mesmo
 *   assim já saiu. Medido em 12/09/2026, quatro notas da E3 estão exatamente
 *   nesse estado (NFE-20481-001 em PROCESSANDO, NFE-20872-001, NFE-20943-001 e
 *   NFE-21078-001 em ERRO_AUTORIZACAO, com 1 a 3 tentativas). Olhar só número e
 *   chave diria "ainda não transmitida" e prometeria "sairá em PRODUÇÃO" para
 *   as quatro — uma mentira nova, na direção oposta.
 *
 *   Por isso entra `tentativas_envio`: a rota de emissão o incrementa NO MESMO
 *   UPDATE em que carimba o ambiente (emitir-nfe/route.ts, o compare-and-swap
 *   da reserva). Contador acima de zero é prova de que a coluna `ambiente` já
 *   foi carimbada pela resolução real — que é exatamente a condição para
 *   confiar nela.
 *
 * ESTA FUNÇÃO NÃO GRAVA NADA. Não corrige a coluna, não sincroniza rascunho e
 *   não decide para onde a nota vai. Ela só escolhe o que EXIBIR. Gravar o
 *   ambiente resolvido no nascimento é erro documentado em
 *   `@/features/fiscal/services/ambiente-fiscal`: rascunho de agosto emitido em
 *   setembro tem de sair com o ambiente de HOJE, não com o de quando nasceu.
 */

/** O mínimo que a nota precisa expor. Espelha as colunas, sem depender do tipo. */
export type NotaParaAmbiente = {
  status?: string | null;
  ambiente?: string | null;
  /**
   * `string | number` porque a coluna é `text` no banco, mas o tipo da tela
   * (`SupabaseNfeRow`) a declara como `number`. As duas formas chegam aqui, e
   * as duas são tratadas — tudo passa por `String()` antes de ser lido.
   */
  numero_nf?: string | number | null;
  chave_nfe?: string | null;
  tentativas_envio?: number | null;
};

/**
 * Os únicos status em que a nota NUNCA saiu do ERP.
 *
 * A lista é pela NEGATIVA de propósito: status desconhecido — um novo, ou um
 * escrito pelo n8n que o app ainda não conhece — cai em "já transmitida", e aí
 * a tela mostra o carimbo em vez de prometer um destino. Errar para o lado de
 * não prometer é o lado barato.
 */
const NUNCA_SAIU = [
  "RASCUNHO",
  "PENDENTE",
  "PRONTA_PARA_ENVIO",
  "ERRO_VALIDACAO",
  "BLOQUEADA_VALIDACAO"
];

export type AmbienteExibido =
  /** Ainda não saiu: mostramos para onde VAI, lido da empresa. */
  | { tipo: "SAIRA_EM"; ambiente: "producao" | "homologacao" }
  /** Já saiu: mostramos onde SAIU, lido do carimbo da nota. */
  | { tipo: "TRANSMITIDA_EM"; ambiente: string }
  /** Empresa ainda carregando, ou sem ambiente definido. Não se promete nada. */
  | { tipo: "INDETERMINADO" };

const VALIDOS = ["producao", "homologacao"] as const;

/**
 * Houve transmissão? QUATRO sinais, e basta um.
 *
 * O STATUS é o mais forte, e entrou depois de o teste pegar a falha: a
 * NFE-20925-001 está AUTORIZADA com `numero_nf`, `chave_nfe` e
 * `tentativas_envio` todos zerados — vítima da escrita parcial, emitida por um
 * caminho que nunca incrementou o contador. Pelos outros três sinais ela
 * passaria por rascunho e a tela prometeria "sairá em PRODUÇÃO" para uma nota
 * que já foi autorizada em homologação.
 */
export function jaFoiTransmitida(nota: NotaParaAmbiente): boolean {
  const status = String(nota.status ?? "").trim().toUpperCase();
  if (status && !NUNCA_SAIU.includes(status)) return true;
  if (String(nota.numero_nf ?? "").trim() !== "") return true;
  if (String(nota.chave_nfe ?? "").trim() !== "") return true;
  // Nota devolvida a rascunho depois de uma rejeição volta a PENDENTE, mas o
  // contador não zera — e ela de fato já saiu uma vez.
  return Number(nota.tentativas_envio ?? 0) > 0;
}

/**
 * O que exibir, e sob qual rótulo.
 *
 * `ambienteDaEmpresa` é `empresas.ambiente_nfe` da emitente — `null` enquanto a
 * tela carrega. Função pura: sem I/O, sem relógio, sem banco.
 */
export function ambienteExibido(
  nota: NotaParaAmbiente,
  ambienteDaEmpresa: string | null | undefined
): AmbienteExibido {
  if (jaFoiTransmitida(nota)) {
    const carimbado = String(nota.ambiente ?? "").trim().toLowerCase();
    // Sem carimbo legível não se inventa histórico.
    return carimbado ? { tipo: "TRANSMITIDA_EM", ambiente: carimbado } : { tipo: "INDETERMINADO" };
  }

  const daEmpresa = String(ambienteDaEmpresa ?? "").trim().toLowerCase();
  if (!VALIDOS.includes(daEmpresa as (typeof VALIDOS)[number])) return { tipo: "INDETERMINADO" };
  return { tipo: "SAIRA_EM", ambiente: daEmpresa as "producao" | "homologacao" };
}

/** "Sairá em" / "Transmitida em" / "Ambiente". O rótulo carrega o tempo verbal. */
export function rotuloAmbiente(r: AmbienteExibido): string {
  if (r.tipo === "SAIRA_EM") return "Sairá em";
  if (r.tipo === "TRANSMITIDA_EM") return "Transmitida em";
  return "Ambiente";
}

/** "PRODUÇÃO" / "HOMOLOGAÇÃO" / "—". Acentuado: é texto de tela, não enum. */
export function textoAmbiente(r: AmbienteExibido): string {
  if (r.tipo === "INDETERMINADO") return "—";
  if (r.ambiente === "producao") return "PRODUÇÃO";
  if (r.ambiente === "homologacao") return "HOMOLOGAÇÃO";
  return r.ambiente.toUpperCase();
}

/** Produção pede destaque: é o único caso em que o clique tem custo real. */
export function ambienteEhProducao(r: AmbienteExibido): boolean {
  return r.tipo !== "INDETERMINADO" && r.ambiente === "producao";
}

/**
 * O aviso da aba "Preview Técnico e Retorno".
 *
 * O texto antigo era fixo: "rascunho de nota fiscal em ambiente de testes. Não
 * houve transmissão real para o Focus API ou SEFAZ." Ele mentia em dois casos
 * distintos — em rascunho de empresa em produção, prometendo teste; e em nota
 * JÁ AUTORIZADA, afirmando que não houve transmissão, porque este bloco aparece
 * para qualquer nota, não só para rascunho.
 */
export function avisoDaPreviaTecnica(r: AmbienteExibido): { titulo: string; texto: string } {
  if (r.tipo === "TRANSMITIDA_EM") {
    return {
      titulo: "Prévia técnica — esta nota já foi transmitida",
      texto:
        `Esta nota já foi enviada à Focus em ${textoAmbiente(r)}. O que aparece abaixo é o ` +
        `material técnico do envio e do retorno; não é um rascunho e não é uma nova emissão.`
    };
  }

  if (r.tipo === "SAIRA_EM" && r.ambiente === "producao") {
    return {
      titulo: "Prévia técnica — ainda não transmitida, e sairá em PRODUÇÃO",
      texto:
        "Ainda NÃO houve transmissão para a Focus nem para a SEFAZ, e esta prévia não tem " +
        "validade fiscal. Mas a empresa emitente está em PRODUÇÃO: ao ser emitida, esta nota " +
        "terá valor fiscal, número definitivo e obrigação acessória. Não é um teste."
    };
  }

  if (r.tipo === "SAIRA_EM") {
    return {
      titulo: "Prévia técnica — ainda não transmitida",
      texto:
        "Ainda não houve transmissão para a Focus nem para a SEFAZ. A empresa emitente está em " +
        "HOMOLOGAÇÃO: quando for emitida, esta nota sairá sem valor fiscal."
    };
  }

  return {
    titulo: "Prévia técnica — ainda não transmitida",
    texto:
      "Ainda não houve transmissão para a Focus nem para a SEFAZ. Não foi possível determinar o " +
      "ambiente da empresa emitente — confira em Cadastros › Empresas antes de emitir."
  };
}
