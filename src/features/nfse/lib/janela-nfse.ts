/**
 * Janela "Gerar NFS-e" — as regras de CONDUTA da janela, sem tela.
 *
 * Módulo puro (sem imports): quando pedir confirmação, o que dizer enquanto uma
 * chamada roda, quando uma falha é INCERTA (a chamada pode ter chegado ao
 * servidor) e o que mostrar depois de reler a nota no banco.
 *
 * POR QUE EXISTE (06/10/2026)
 *   A primeira emissão de teste demorou, deu erro e a mensagem se perdeu. A
 *   emissão passa por n8n e Focus e leva segundos; uma resposta que não chega
 *   NÃO quer dizer que nada aconteceu. A janela nunca conclui "falhou" por
 *   tempo ou rede: relê o estado da nota e mostra o que existe. E nunca tenta
 *   de novo sozinha.
 */

export type AmbienteDaJanela = "producao" | "homologacao" | null;

/**
 * Só PRODUÇÃO pede confirmação — uma, com o resumo. Em homologação a nota é de
 * teste e o fluxo é direto: conferir, "Criar rascunho", "Emitir".
 */
export function emissaoPedeConfirmacao(ambiente: AmbienteDaJanela): boolean {
  return ambiente === "producao";
}

/** O texto do botão que emite, pelo ambiente e pelo estado da nota. */
export function rotuloDoBotaoDeEmitir(ambiente: AmbienteDaJanela, reenvio: boolean): string {
  if (ambiente === "producao") return reenvio ? "Reenviar em PRODUÇÃO" : "Emitir em PRODUÇÃO";
  return reenvio ? "Reenviar NFS-e" : "Emitir NFS-e";
}

/** A partir deste tempo a espera ganha o segundo aviso. */
export const ESPERA_LONGA_MS = 15_000;

export const TEXTO_DE_ESPERA = "Aguarde, não clique de novo";
export const TEXTO_DE_ESPERA_LONGA = "Ainda processando. Não feche nem clique de novo";

/** O que a janela diz enquanto uma chamada roda. */
export function textoDeEspera(decorridoMs: number): string {
  return decorridoMs >= ESPERA_LONGA_MS ? TEXTO_DE_ESPERA_LONGA : TEXTO_DE_ESPERA;
}

/** Quanto a janela espera cada chamada antes de desistir de OUVIR a resposta. */
export const LIMITE_DA_CHAMADA_MS = { carregar: 30_000, criar: 30_000, emitir: 75_000, consultar: 60_000 } as const;

export type EtapaDaJanela = keyof typeof LIMITE_DA_CHAMADA_MS;

export type FalhaDaChamada =
  /** A chamada não devolveu resposta: tempo esgotado ou rede. */
  | { tipo: "sem_resposta"; motivo: "tempo" | "rede" }
  /** O servidor respondeu com erro. */
  | { tipo: "http"; status: number };

/**
 * A falha é INCERTA? Sem resposta (tempo ou rede) e erro de passagem
 * (408, 502, 503, 504) não dizem se o servidor fez o trabalho. Recusa clara do
 * servidor (400, 401, 403, 404, 409, 422, 500) é certa: ele respondeu.
 */
export function falhaEhIncerta(falha: FalhaDaChamada): boolean {
  if (falha.tipo === "sem_resposta") return true;
  return [408, 502, 503, 504].includes(falha.status);
}

/** Código curto do erro, para o "Copiar detalhes". */
export function codigoDaFalha(falha: FalhaDaChamada, codigoDoServidor?: string | null): string {
  if (falha.tipo === "sem_resposta") return falha.motivo === "tempo" ? "TEMPO_ESGOTADO" : "SEM_REDE";
  const doServidor = String(codigoDoServidor ?? "").trim();
  return doServidor ? `HTTP_${falha.status}/${doServidor}` : `HTTP_${falha.status}`;
}

export type SituacaoLida = "AUTORIZADA" | "RASCUNHO" | "EM_ANALISE" | "REENVIAR" | "ENCERRADA";

/** A nota do pedido, como a releitura a devolveu. `null` = o pedido não tem nota viva. */
export type NotaRelida = {
  ref: string;
  situacao: SituacaoLida;
  numeroNfse?: string | null;
  tentativasEnvio?: number | null;
} | null;

export type OQueExiste = {
  /** O que dizer a quem estava esperando. */
  mensagem: string;
  /** O trabalho pedido aconteceu (ou pode ter acontecido)? */
  aconteceu: boolean;
  /** A janela deve acompanhar a nota (consultar sozinha)? */
  acompanhar: boolean;
};

/**
 * Depois de uma falha incerta ao CRIAR o rascunho: o que a releitura mostra.
 * `refAntes` é o rascunho que já existia antes do clique (criar outro), se havia.
 */
export function depoisDeFalhaAoCriar(notaDepois: NotaRelida, refAntes: string | null): OQueExiste {
  if (notaDepois && notaDepois.situacao === "RASCUNHO" && notaDepois.ref !== refAntes) {
    return {
      mensagem: `A resposta não chegou, mas o rascunho ${notaDepois.ref} foi criado. Confira e emita por ele.`,
      aconteceu: true,
      acompanhar: false
    };
  }
  if (notaDepois && notaDepois.situacao === "AUTORIZADA") {
    return { mensagem: `O pedido já tem a NFS-e${notaDepois.numeroNfse ? ` nº ${notaDepois.numeroNfse}` : ""} autorizada.`, aconteceu: false, acompanhar: false };
  }
  if (notaDepois && notaDepois.situacao === "EM_ANALISE") {
    return { mensagem: `A nota ${notaDepois.ref} deste pedido está em análise.`, aconteceu: false, acompanhar: true };
  }
  return {
    mensagem: "A resposta não chegou e o rascunho NÃO foi criado. Pode clicar em Criar rascunho de novo.",
    aconteceu: false,
    acompanhar: false
  };
}

/**
 * Depois de uma falha incerta ao EMITIR a nota `ref`: o que a releitura mostra.
 * `tentativasAntes` é o `tentativas_envio` lido antes do clique: a rota de
 * emitir soma 1 ao reservar o envio, antes de chamar a integração.
 */
export function depoisDeFalhaAoEmitir(notaDepois: NotaRelida, ref: string, tentativasAntes: number): OQueExiste {
  if (!notaDepois || notaDepois.ref !== ref) {
    return {
      mensagem: "A resposta não chegou. A janela mostra o que o pedido tem agora; confira antes de emitir de novo.",
      aconteceu: false,
      acompanhar: false
    };
  }
  if (notaDepois.situacao === "AUTORIZADA") {
    return {
      mensagem: `A resposta não chegou, mas a nota foi AUTORIZADA${notaDepois.numeroNfse ? ` (NFS-e nº ${notaDepois.numeroNfse})` : ""}.`,
      aconteceu: true,
      acompanhar: false
    };
  }
  if (notaDepois.situacao === "EM_ANALISE") {
    return { mensagem: "A resposta não chegou, mas o envio saiu: a nota está em análise.", aconteceu: true, acompanhar: true };
  }
  if (notaDepois.situacao === "REENVIAR" || notaDepois.situacao === "ENCERRADA") {
    return { mensagem: "A resposta não chegou. A nota registrou erro: leia a mensagem abaixo.", aconteceu: true, acompanhar: false };
  }
  // Continua rascunho. Se o contador de tentativas andou, o envio foi reservado
  // e pode estar a caminho: ninguém emite de novo antes de consultar.
  if (Number(notaDepois.tentativasEnvio ?? 0) > tentativasAntes) {
    return {
      mensagem: "A resposta não chegou, mas o envio foi registrado e pode estar a caminho. NÃO emita de novo: aguarde ou use Consultar agora.",
      aconteceu: true,
      acompanhar: true
    };
  }
  return {
    mensagem: "A resposta não chegou e o envio NÃO foi registrado. A nota continua como rascunho.",
    aconteceu: false,
    acompanhar: false
  };
}

export type ErroDaJanela = {
  etapa: EtapaDaJanela;
  mensagem: string;
  codigo: string;
  idInt: number;
  ref: string | null;
  /** ISO 8601. */
  quando: string;
};

const NOME_DA_ETAPA: Record<EtapaDaJanela, string> = {
  carregar: "Ler os dados do pedido",
  criar: "Criar rascunho",
  emitir: "Emitir NFS-e",
  consultar: "Consultar NFS-e"
};

/** O texto do "Copiar detalhes": o bastante para alguém investigar depois. */
export function detalhesDoErro(erro: ErroDaJanela): string {
  return [
    "Gerar NFS-e — erro",
    `Pedido: ${erro.idInt}`,
    `Referência da nota: ${erro.ref || "(sem nota)"}`,
    `Etapa: ${NOME_DA_ETAPA[erro.etapa]}`,
    `Hora: ${erro.quando}`,
    `Código: ${erro.codigo}`,
    `Mensagem: ${erro.mensagem}`
  ].join("\n");
}

/** Chave do erro guardado no navegador, por pedido (some só quando dispensado ou resolvido). */
export function chaveDoErroGuardado(idInt: number): string {
  return `vibe:nfse:erro:${idInt}`;
}

/** Lê um erro guardado, aceitando só o formato esperado. */
export function lerErroGuardado(bruto: string | null | undefined, idInt: number): ErroDaJanela | null {
  if (!bruto) return null;
  try {
    const e = JSON.parse(bruto) as Partial<ErroDaJanela> | null;
    if (!e || typeof e !== "object") return null;
    if (Number(e.idInt) !== idInt) return null;
    if (typeof e.mensagem !== "string" || typeof e.codigo !== "string" || typeof e.quando !== "string") return null;
    if (!e.etapa || !(e.etapa in NOME_DA_ETAPA)) return null;
    return { etapa: e.etapa, mensagem: e.mensagem, codigo: e.codigo, idInt, ref: typeof e.ref === "string" ? e.ref : null, quando: e.quando };
  } catch {
    return null;
  }
}
