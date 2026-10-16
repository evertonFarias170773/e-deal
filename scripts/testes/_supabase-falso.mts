/**
 * Cliente Supabase FALSO para teste sem banco.
 *
 * Substitui `@/lib/supabase/client` (ver o hook no topo de quem o usa): o
 * serviço sob teste chama `getSupabaseClient()` como sempre e recebe este
 * objeto, que só ANOTA o que foi pedido — tabela, operação, payload e filtros —
 * e devolve a resposta que o teste tiver combinado para `tabela:operacao`.
 *
 * Nenhuma requisição sai daqui. Serve para provar o que um serviço GRAVA (ou
 * deixa de gravar), não para simular o banco.
 */

export type Chamada = {
  tabela: string;
  op: "select" | "insert" | "update" | "delete" | "upsert";
  payload?: unknown;
  filtros: [string, unknown][];
};

type Resposta = { data: unknown; error: { message: string; code?: string } | null };

const estado = {
  chamadas: [] as Chamada[],
  respostas: new Map<string, Resposta>(),
  // Respostas em SEQUENCIA para a mesma chave: cada consulta consome a proxima e
  // a ultima se repete. Serve a quem precisa que o "banco" mude entre duas
  // leituras (por exemplo, uma corrida entre dois cliques).
  sequencias: new Map<string, Resposta[]>(),
  // Opcional: decide a resposta olhando o payload (ex.: imitar um gatilho que
  // recusa certo INSERT). Devolver `undefined` cai na resposta combinada.
  interceptadores: new Map<string, (payload: unknown) => Resposta | undefined>(),
  // Opcional: id do usuário de `auth.getUser()` (padrão "usuario-de-teste").
  usuarioId: "usuario-de-teste"
};

/** O que o teste inspeciona e combina. */
export const falso = {
  get chamadas() {
    return estado.chamadas;
  },
  responder(chave: string, resposta: Resposta) {
    estado.respostas.set(chave, resposta);
  },
  responderEmSequencia(chave: string, respostas: Resposta[]) {
    estado.sequencias.set(chave, [...respostas]);
  },
  interceptar(chave: string, decidir: (payload: unknown) => Resposta | undefined) {
    estado.interceptadores.set(chave, decidir);
  },
  definirUsuario(id: string) {
    estado.usuarioId = id;
  },
  zerar() {
    estado.chamadas = [];
    estado.respostas.clear();
    estado.sequencias.clear();
    estado.interceptadores.clear();
    estado.usuarioId = "usuario-de-teste";
  }
};

function construtor(tabela: string) {
  const chamada: Chamada = { tabela, op: "select", filtros: [] };
  let registrada = false;

  const registrar = (op: Chamada["op"], payload?: unknown) => {
    chamada.op = op;
    if (payload !== undefined) chamada.payload = payload;
    if (!registrada) {
      estado.chamadas.push(chamada);
      registrada = true;
    }
  };

  const resposta = (): Resposta => {
    const chave = `${tabela}:${chamada.op}`;
    const interceptada = estado.interceptadores.get(chave)?.(chamada.payload);
    if (interceptada) return interceptada;
    const fila = estado.sequencias.get(chave);
    if (fila && fila.length > 0) return fila.length > 1 ? (fila.shift() as Resposta) : fila[0];
    return estado.respostas.get(chave) ?? { data: chamada.op === "select" ? [] : null, error: null };
  };

  const b: Record<string, unknown> = {
    select() {
      if (!registrada) registrar("select");
      return b;
    },
    insert(payload: unknown) {
      registrar("insert", payload);
      return b;
    },
    update(payload: unknown) {
      registrar("update", payload);
      return b;
    },
    upsert(payload: unknown) {
      registrar("upsert", payload);
      return b;
    },
    delete() {
      registrar("delete");
      return b;
    },
    then(ok: (r: Resposta) => unknown, falha?: (e: unknown) => unknown) {
      return Promise.resolve(resposta()).then(ok, falha);
    },
    maybeSingle() {
      return Promise.resolve(resposta());
    },
    single() {
      return Promise.resolve(resposta());
    }
  };

  for (const filtro of ["eq", "neq", "is", "in", "gt", "gte", "lt", "lte", "or", "not", "order", "limit", "returns", "range"]) {
    b[filtro] = (...args: unknown[]) => {
      chamada.filtros.push([filtro, args]);
      return b;
    };
  }

  return b;
}

const clienteFalso = {
  from: (tabela: string) => construtor(tabela),
  /** Função do banco: anotada como a "tabela" `rpc:<nome>`, com os argumentos no payload. */
  rpc: (nome: string, args?: unknown) => {
    estado.chamadas.push({ tabela: `rpc:${nome}`, op: "select", payload: args, filtros: [] });
    return Promise.resolve(estado.respostas.get(`rpc:${nome}`) ?? { data: null, error: null });
  },
  auth: {
    getUser: async () => ({ data: { user: { id: estado.usuarioId } }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null })
  }
};

export function getSupabaseClient() {
  return clienteFalso;
}
