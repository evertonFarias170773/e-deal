/**
 * O texto do consentimento do cadastro online, e a versao dele.
 *
 * FONTE UNICA. Tres lugares dependem deste arquivo e precisam concordar:
 *   1. o formulario publico (/c/[token]) — mostra o texto ao lado do checkbox;
 *   2. a rota de envio — grava `consentimento_texto` e `consentimento_versao`
 *      em `cadastros_online`;
 *   3. o aviso de privacidade (/privacidade) — detalha o que o texto resume.
 *
 * POR QUE A VERSAO E CALCULADA, E NAO DIGITADA
 * -------------------------------------------
 * O requisito e que "a versao gravada muda quando o texto mudar". Uma constante
 * digitada a mao depende de alguem lembrar de troca-la — e quem edita o texto
 * raramente lembra. Entao a versao carrega um hash do proprio texto: mudou uma
 * virgula, muda a versao, sem ninguem fazer nada.
 *
 * A data continua no comeco porque e o que um humano le primeiro ("de quando e
 * este texto?"). O hash e o que garante a corretude.
 *
 * O hash NAO e criptografico de proposito: precisa ser sincrono e identico no
 * browser e no servidor, e `crypto.subtle` e assincrono. Aqui ele so precisa
 * mudar quando o texto muda — nao ha adversario tentando forjar colisao.
 */

const CONSENTIMENTO_DATA = "2026-09-07";

export const CONSENTIMENTO_TEXTO =
  "Autorizo a Ideal Etiquetas a usar os dados que enviei neste formulario para " +
  "abrir e manter meu cadastro de cliente, emitir notas fiscais e cobrancas, e " +
  "entrar em contato comigo sobre pedidos e orcamentos. Li o aviso de " +
  "privacidade e sei que posso pedir a correcao ou a exclusao dos meus dados a " +
  "qualquer momento.";

function hashCurto(texto: string): string {
  // djb2. Suficiente para detectar edicao de texto, e igual nos dois lados.
  let h = 5381;
  for (let i = 0; i < texto.length; i += 1) {
    h = ((h << 5) + h + texto.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

export const CONSENTIMENTO_VERSAO = `${CONSENTIMENTO_DATA}.${hashCurto(CONSENTIMENTO_TEXTO)}`;

/**
 * O conteudo do aviso de privacidade, como dado.
 *
 * Fica aqui, e nao dentro da pagina, para que o texto do consentimento e o
 * aviso nao possam divergir em silencio: quem editar um esbarra no outro. As
 * quatro secoes sao as quatro perguntas que o dono pediu que a pagina
 * respondesse — o que coleta, para que, por quanto tempo, e como pedir exclusao.
 */
export const AVISO_PRIVACIDADE_SECOES: Array<{ titulo: string; paragrafos: string[] }> = [
  {
    titulo: "Quem trata os seus dados",
    paragrafos: [
      "A Ideal Etiquetas e a responsavel pelo tratamento dos dados enviados por este formulario. " +
        "O formulario e enviado por um atendente da empresa, e o cadastro criado fica vinculado a ele."
    ]
  },
  {
    titulo: "O que coletamos",
    paragrafos: [
      "Somente o que voce digita no formulario: CPF ou CNPJ, nome ou razao social, nome fantasia, " +
        "e-mail, WhatsApp, telefone fixo e o endereco completo (CEP, logradouro, numero, complemento, " +
        "bairro, cidade e estado).",
      "Para CNPJ, complementamos o cadastro com os dados publicos da Receita Federal — os mesmos que " +
        "qualquer pessoa consulta informando o CNPJ.",
      "Nao guardamos o seu endereco de IP. Guardamos apenas um codigo derivado dele, que serve para " +
        "identificar uso abusivo do formulario e nao permite chegar de volta ao endereco. Nao usamos " +
        "cookies de rastreamento nesta pagina, e ela nao e indexada por buscadores."
    ]
  },
  {
    titulo: "Para que usamos",
    paragrafos: [
      "Para abrir e manter o seu cadastro de cliente, emitir notas fiscais e cobrancas, entregar " +
        "pedidos no endereco informado, e falar com voce sobre pedidos e orcamentos.",
      "Nao vendemos os seus dados e nao os usamos para publicidade de terceiros. Eles sao " +
        "compartilhados apenas com quem e necessario para atender voce: o orgao fiscal, na emissao " +
        "da nota; o banco, na cobranca; e a transportadora ou os Correios, na entrega."
    ]
  },
  {
    titulo: "Por quanto tempo guardamos",
    paragrafos: [
      "Enquanto o cadastro estiver ativo, e depois pelo prazo que a lei exige para documentos " +
        "fiscais e contabeis — cinco anos, contados do fim do exercicio em que a operacao aconteceu.",
      "O registro deste envio (o que voce preencheu, a data e o texto que voce aceitou) e guardado " +
        "pelo mesmo prazo, porque e ele que comprova a autorizacao que voce deu."
    ]
  },
  {
    titulo: "Como corrigir ou pedir exclusao",
    paragrafos: [
      "Fale com o seu atendente, ou escreva para contato@idealetiquetas.com.br pedindo correcao, " +
        "copia ou exclusao dos seus dados. Respondemos em ate 15 dias.",
      "A exclusao vale para o que nao somos obrigados a guardar. Dados de notas fiscais e cobrancas " +
        "ja emitidas continuam arquivados pelo prazo legal, mesmo apos o pedido — nesse caso o " +
        "cadastro e desativado e deixa de ser usado para contato."
    ]
  }
];
