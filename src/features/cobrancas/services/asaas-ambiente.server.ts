/**
 * PONTO UNICO DE TROCA DA CREDENCIAL ASAAS.
 * =========================================================================
 *
 * ATENCAO — A CONTA ASAAS EM USO HOJE NAO E DA IDEAL.
 *
 * Verificado em 01/08/2026 por leitura de `GET /v3/myAccount` com a chave
 * `CHAVE_API_ASAAS` presente no .env.local (HTTP 200):
 *
 *     titular   : LISITON DOCUMENTOS SEGUROS LTDA
 *     personType: JURIDICA
 *     CNPJ      : 41**********00
 *
 * Essa conta pertence a um terceiro e esta sendo usada APENAS PARA
 * HOMOLOGACAO. Ela NAO deve receber cobranca de producao: uma cobranca da
 * empresa 1 emitida nela cai em outro CNPJ, e nenhum teste funcional acusa —
 * o checkout abre, o pagamento passa, o webhook confirma e o pagamentos_v2
 * marca PAID. O erro so aparece na conciliacao bancaria.
 *
 * !!! HOMOLOGACAO_LISITON NAO E SANDBOX !!!
 * A conta e a chave sao de PRODUCAO (prefixo $aact_prod_, host
 * api.asaas.com). Nao existe rede de protecao aqui: qualquer chamada real a
 * /v3/payments cria COBRANCA REAL, cobravel, com dinheiro real, na conta de
 * um terceiro. "Homologacao" descreve a INTENCAO DE USO, nao o ambiente
 * tecnico. Enquanto ASAAS_AMBIENTE=HOMOLOGACAO_LISITON:
 *   - manter os workflows do n8n DESATIVADOS;
 *   - executar so com pin data nos nos externos;
 *   - o no `Config` de cada workflow deve seguir em api-sandbox.asaas.com.
 * Teste sem risco financeiro exige chave de sandbox ($aact_hmlg_), que ainda
 * nao existe neste ambiente.
 *
 * -------------------------------------------------------------------------
 * ONDE TROCAR PELA CONTA OFICIAL DA IDEAL GRAFICA (empresa 1)
 * -------------------------------------------------------------------------
 * A chave nunca é lida por este arquivo nem por qualquer rota: quem fala com
 * a Asaas é o n8n. A troca acontece em DOIS lugares, e este comentario é a
 * lista canonica — nao existe outra:
 *
 *   1. CREDENCIAL DO n8n (operacional, é a que realmente autentica)
 *        credencial : "Asaas API | Ideal (access_token)"
 *        id         : 6cc6kI5oylQKhBQt
 *        header     : access_token
 *        usada por  : ASAAS-CARTAO-IDEAL (4EBHwK2wBLubUjln)
 *                     ASAAS-CANCELAR     (oo91eeuq6tnSrsFp)
 *
 *   2. ESTA VARIAVEL DE AMBIENTE (declaracao, alimenta o log e a conferencia)
 *        ASAAS_AMBIENTE   -> PRODUCAO_IDEAL
 *        CHAVE_API_ASAAS  -> chave da conta oficial da Ideal Grafica
 *
 * Trocar so o item 1 deixa o log mentindo sobre o ambiente; trocar so o
 * item 2 nao muda quem autentica. Os dois, sempre juntos.
 *
 * A base da URL (sandbox x producao) vive no no `Config` de cada workflow do
 * n8n e nasce apontando para api-sandbox.asaas.com.
 * =========================================================================
 *
 * Este modulo é puramente informativo: NAO altera fluxo de cobranca, regra de
 * negocio nem id_empresa. Serve para que o ambiente Asaas em uso fique
 * explicito no log do servidor.
 */

export type AsaasAmbiente = "SANDBOX" | "HOMOLOGACAO_LISITON" | "PRODUCAO_IDEAL";

const AMBIENTES_VALIDOS: AsaasAmbiente[] = ["SANDBOX", "HOMOLOGACAO_LISITON", "PRODUCAO_IDEAL"];

/** Titular verificado da conta de homologacao. Ver cabecalho. */
export const ASAAS_TITULAR_HOMOLOGACAO = "LISITON DOCUMENTOS SEGUROS LTDA";

/** Titular esperado quando a modalidade for para producao (empresa 1). */
export const ASAAS_TITULAR_PRODUCAO_ESPERADO = "IDEAL GRAFICA EXPRESSA EIRELI";

/**
 * Ambiente Asaas declarado em `ASAAS_AMBIENTE`.
 * Retorna null quando ausente ou invalido — nao assume um padrao, porque
 * supor o ambiente errado é exatamente o risco que este modulo existe para
 * tornar visivel.
 */
export function getAsaasAmbiente(): AsaasAmbiente | null {
  const bruto = (process.env.ASAAS_AMBIENTE || "").trim().toUpperCase();
  return (AMBIENTES_VALIDOS as string[]).includes(bruto) ? (bruto as AsaasAmbiente) : null;
}

/**
 * Classifica o PREFIXO da chave sem nunca devolver o valor.
 * As chaves Asaas trazem o ambiente no proprio prefixo, entao isso permite
 * detectar a combinacao perigosa "ambiente diz sandbox, chave é de producao".
 */
function classificarChave(): "ausente" | "producao" | "homologacao" | "formato_desconhecido" {
  const chave = (process.env.CHAVE_API_ASAAS || "").trim();
  if (!chave) return "ausente";
  if (chave.startsWith("$aact_prod_")) return "producao";
  if (chave.startsWith("$aact_hmlg_")) return "homologacao";
  return "formato_desconhecido";
}

let jaLogou = false;

/**
 * Registra uma vez por processo qual ambiente Asaas esta em uso.
 * Nunca imprime a chave — apenas a classificacao do prefixo.
 */
export function logAmbienteAsaas(origem: string): void {
  if (jaLogou) return;
  jaLogou = true;

  const ambiente = getAsaasAmbiente();
  const chave = classificarChave();

  const titular =
    ambiente === "HOMOLOGACAO_LISITON"
      ? ASAAS_TITULAR_HOMOLOGACAO
      : ambiente === "PRODUCAO_IDEAL"
        ? ASAAS_TITULAR_PRODUCAO_ESPERADO
        : "(indefinido)";

  console.info(
    `[Asaas][${origem}] ambiente=${ambiente ?? "NAO_DECLARADO"} titular_esperado="${titular}" chave=${chave}`
  );

  if (!ambiente) {
    console.warn(
      "[Asaas] ASAAS_AMBIENTE nao declarado. Defina SANDBOX, HOMOLOGACAO_LISITON ou PRODUCAO_IDEAL no .env.local."
    );
  }

  if (ambiente === "HOMOLOGACAO_LISITON") {
    console.warn(
      `[Asaas] HOMOLOGACAO: a conta em uso e de terceiro (${ASAAS_TITULAR_HOMOLOGACAO}), NAO da empresa 1. ` +
        "Nao emitir cobranca de producao aqui — o recebimento cai em outro CNPJ."
    );
    console.warn(
      "[Asaas] HOMOLOGACAO_LISITON NAO E SANDBOX: conta e chave sao de PRODUCAO. " +
        "Qualquer chamada real a /v3/payments gera cobranca REAL e cobravel. " +
        "Manter os workflows do n8n desativados e executar apenas com pin data."
    );
  }

  if (ambiente === "SANDBOX" && chave === "producao") {
    console.warn("[Asaas] INCOERENCIA: ambiente declarado SANDBOX mas a chave tem prefixo de PRODUCAO.");
  }

  if (ambiente === "PRODUCAO_IDEAL" && chave !== "producao") {
    console.warn(
      `[Asaas] INCOERENCIA: ambiente declarado PRODUCAO_IDEAL mas a chave esta como "${chave}". ` +
        "Confirmar que a credencial do n8n tambem foi trocada pela conta oficial da Ideal."
    );
  }
}
