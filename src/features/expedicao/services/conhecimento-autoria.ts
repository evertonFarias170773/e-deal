import { ORIGEM_LOG_CONHECIMENTO, deveRegistrarConhecimento, motivoDoConhecimento } from "../lib/conhecimento";

/**
 * AUTORIA DO CONHECIMENTO (15/10/2026). Quem salvou ou corrigiu o numero, com o valor antigo
 * e o novo, em `os_status_log` — a mesma trilha que as acoes da Expedicao ja usam. Nao muda
 * status nem valor: a linha repete o status atual em `status_anterior` e `status_novo`.
 *
 * Falha no log NAO desfaz o conhecimento ja gravado (trilha e observabilidade, como em
 * `transicionar`): devolve o aviso para quem chama logar.
 */
export type ClienteLog = {
  from: (tabela: string) => {
    insert: (linha: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
  };
};

export async function registrarAutoriaConhecimento(
  client: ClienteLog,
  entrada: {
    idInt: number;
    statusAtual: string;
    tipoEfetivo: string | null | undefined;
    antes: string | null | undefined;
    depois: string | null | undefined;
    ator: { uid: string | null; nome: string | null };
  }
): Promise<{ registrou: boolean; aviso: string | null }> {
  if (!deveRegistrarConhecimento(entrada.tipoEfetivo, entrada.antes, entrada.depois)) {
    return { registrou: false, aviso: null };
  }
  const { error } = await client.from("os_status_log").insert({
    id_int: entrada.idInt,
    status_anterior: entrada.statusAtual,
    status_novo: entrada.statusAtual,
    resultado: "sucesso",
    motivo: motivoDoConhecimento(entrada.antes, entrada.depois),
    origem: ORIGEM_LOG_CONHECIMENTO,
    ator_tipo: "USUARIO",
    ator_uid: entrada.ator.uid,
    ator_nome: entrada.ator.nome
  });
  return error ? { registrou: false, aviso: error.message } : { registrou: true, aviso: null };
}
