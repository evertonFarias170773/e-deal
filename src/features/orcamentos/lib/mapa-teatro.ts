/**
 * Mapa de Teatro: leitura dos setores, revisão e retrato (snapshot).
 *
 * POR QUE EXISTE (03/10/2026)
 *   O botão "Mapa Teatro" da aba Pedido cria um modelo por SETOR de um mapa
 *   cadastrado em `public.producao_mapas_teatro`. O mapa é mantido por outro
 *   sistema (o parceiro de imposição); aqui ele só é LIDO. Tudo o que se sabe
 *   do setor sai do JSON `config`:
 *
 *     config.setores[]            { id, nome, cadeiras, ... }
 *     setor.cadeiras              objeto: chave de posição ("0,2") → cadeira
 *     cadeira                     { prefixo, num, tipo, isErased? }
 *     config.tiposAssento[]       { id, nome, sufixo, cor, icone }
 *
 *   `total_lugares` e `lugares_por_setor` NÃO existem no banco: a quantidade é
 *   contada aqui, cadeira por cadeira.
 *
 * UMA REGRA SÓ, DOIS LADOS
 *   A tela (lista de mapas, prévia dos setores) e o servidor (gravação do
 *   vínculo) usam estas mesmas funções. Sem imports de propósito: roda no
 *   navegador, na rota e no teste do Node, igual.
 *
 * O VÍNCULO É POR ID
 *   Mapa pelo `id` (uuid), setor pelo `id` dele dentro de `config.setores[]`.
 *   Nunca por nome, nunca por posição na lista. Por isso mapa com setor sem id,
 *   ou com dois setores de mesmo id, NÃO cria vínculo.
 *
 * O QUE ESTE MÓDULO RECUSA, EM VEZ DE ADIVINHAR
 *   - cadeiras em `config.cadeiras` (formato legado, fora dos setores);
 *   - setor sem `id`, ou id repetido;
 *   - `setor.cadeiras` que não seja um objeto chave → cadeira.
 *   Nenhum desses casos é "consertado": inferir setor por nome ou renumerar
 *   assento criaria um vínculo que o outro sistema não reconhece.
 *
 * A REVISÃO — o algoritmo exato, para quem calcula do outro lado
 *   revisao = SHA-256( UTF-8( JCS(config) ) ), em hexadecimal minúsculo (64).
 *   JCS é a RFC 8785 (JSON Canonicalization Scheme), aplicada ao valor JSON da
 *   coluna `config` INTEIRA:
 *     1. objeto: chaves ordenadas pela sequência de unidades UTF-16 (a ordem
 *        padrão de comparação de strings do JavaScript), sem repetição, em
 *        TODOS os níveis. Vale para chave puramente inteira também: "10" vem
 *        antes de "2". Atenção de quem implementa em JavaScript: o motor
 *        enumera essas chaves em ordem numérica, então reordenar o objeto e
 *        chamar `JSON.stringify` NÃO dá JCS — é preciso montar o texto chave a
 *        chave, na ordem ordenada (é o que `jsonCanonico` faz);
 *     2. array: na ordem em que está;
 *     3. sem espaço nenhum entre os tokens — separadores "," e ":";
 *     4. string: como o `JSON.stringify` do ECMAScript escreve — aspas duplas,
 *        só `"`, `\` e os controles U+0000–U+001F escapados (\b \t \n \f \r ou
 *        \u00xx minúsculo); todo o resto literal, inclusive acento e emoji;
 *     5. número: como o `JSON.stringify` escreve (16 → `16`, 1.50 → `1.5`,
 *        1.0 → `1`); `true`, `false` e `null` literais;
 *     6. o texto resultante é codificado em UTF-8, sem BOM, e passa pelo
 *        SHA-256.
 *   SÓ A CONFIG entra (decisão do dono, 04/10/2026): `id` e `name` do mapa
 *   ficam de fora, para renomear o mapa não desfazer o vínculo. Texto com
 *   substituto solto (Unicode inválido) é recusado, como a RFC manda.
 *   Em Python: `hashlib.sha256(jcs.canonicalize(config)).hexdigest()` (pacote
 *   `jcs`), ou `json.dumps(config, sort_keys=True, separators=(",", ":"),
 *   ensure_ascii=False)` enquanto a config só tiver números inteiros e chaves
 *   no plano básico (é o caso de hoje).
 */

/** O que um setor do mapa vira: um modelo. */
export type SetorDoMapaTeatro = {
  /** `config.setores[].id` — a chave do vínculo. */
  id: string;
  nome: string;
  /** Cadeiras do setor, fora as apagadas: a quantidade do modelo. */
  lugares: number;
  /** Cadeiras apagadas (tipo "Apagado" ou isErased = true): ficam no retrato, não contam. */
  apagadas: number;
};

export type CadeiraDoRetrato = {
  /** Chave de posição dentro do setor, exatamente como está no mapa ("0,2"). */
  chave: string;
  prefixo: string | number | null;
  num: string | number | null;
  tipo: string | null;
  /** Só quando a cadeira está apagada. */
  apagada?: true;
};

/** `pedidos_modelos.mapa_teatro_snapshot`. */
export type RetratoDoSetor = {
  versao: 1;
  mapa: { id: string; nome: string };
  setor: { id: string; nome: string };
  /** Na ordem em que vêm do mapa, sem renumerar. */
  cadeiras: CadeiraDoRetrato[];
  /** Os tipos de `config.tiposAssento` que alguma cadeira do setor usa. */
  tiposAssento: Record<string, unknown>[];
};

export type LeituraDoMapaTeatro =
  | { ok: true; setores: SetorDoMapaTeatro[] }
  | { ok: false; motivo: string };

type Json = unknown;

function ehObjeto(valor: Json): valor is Record<string, Json> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function texto(valor: Json): string {
  return typeof valor === "string" ? valor.trim() : typeof valor === "number" ? String(valor) : "";
}

/** Apagada: tipo "Apagado" ou `isErased` verdadeiro. Não conta como lugar. */
export function cadeiraApagada(cadeira: Json): boolean {
  if (!ehObjeto(cadeira)) return false;
  return cadeira.isErased === true || texto(cadeira.tipo).toLowerCase() === "apagado";
}

/** Há cadeira no formato legado, direto em `config.cadeiras`? Vazio não é legado. */
function temCadeirasLegadas(config: Record<string, Json>): boolean {
  const legado = config.cadeiras;
  if (Array.isArray(legado)) return legado.length > 0;
  if (ehObjeto(legado)) return Object.keys(legado).length > 0;
  return false;
}

/**
 * Os setores do mapa, com a quantidade de lugares de cada um — ou o motivo de
 * o mapa não poder ser vinculado. Setor sem cadeiras volta com `lugares: 0`:
 * quem chama decide não criar modelo e avisar.
 */
export function lerSetoresDoMapaTeatro(config: Json): LeituraDoMapaTeatro {
  if (!ehObjeto(config)) return { ok: false, motivo: "O mapa não tem configuração." };
  if (temCadeirasLegadas(config)) {
    return {
      ok: false,
      motivo: "Este mapa guarda cadeiras fora dos setores (formato antigo). Ele precisa ser salvo de novo no editor de mapas antes de ser usado."
    };
  }
  if (!Array.isArray(config.setores) || config.setores.length === 0) {
    return { ok: false, motivo: "O mapa não tem nenhum setor." };
  }

  const setores: SetorDoMapaTeatro[] = [];
  const vistos = new Set<string>();
  for (const bruto of config.setores) {
    if (!ehObjeto(bruto)) return { ok: false, motivo: "O mapa tem um setor em formato não reconhecido." };
    const id = texto(bruto.id);
    const nome = texto(bruto.nome);
    if (!id) {
      return { ok: false, motivo: `O setor "${nome || "sem nome"}" não tem identificador. O vínculo é feito pelo id do setor.` };
    }
    if (vistos.has(id)) {
      return { ok: false, motivo: `O mapa tem dois setores com o mesmo identificador (${id}).` };
    }
    vistos.add(id);

    const cadeiras = bruto.cadeiras;
    if (cadeiras !== undefined && cadeiras !== null && !ehObjeto(cadeiras)) {
      return { ok: false, motivo: `As cadeiras do setor "${nome || id}" estão em formato não reconhecido.` };
    }
    const lista = ehObjeto(cadeiras) ? Object.values(cadeiras) : [];
    const apagadas = lista.filter(cadeiraApagada).length;
    setores.push({ id, nome, lugares: lista.length - apagadas, apagadas });
  }
  return { ok: true, setores };
}

/** O total de lugares do mapa, somando os setores. */
export function totalDeLugares(setores: readonly SetorDoMapaTeatro[]): number {
  return setores.reduce((total, s) => total + s.lugares, 0);
}

/**
 * O retrato de UM setor, para `mapa_teatro_snapshot`. Cadeira apagada entra,
 * marcada, porque a posição dela faz parte do desenho; prefixo e num vão como
 * estão — nada é renumerado. `null` quando o setor não existe no mapa.
 */
export function montarRetratoDoSetor(
  mapa: { id: string; name: string | null; config: Json },
  setorId: string
): RetratoDoSetor | null {
  if (!ehObjeto(mapa.config) || !Array.isArray(mapa.config.setores)) return null;
  const setor = mapa.config.setores.find((s) => ehObjeto(s) && texto(s.id) === setorId);
  if (!ehObjeto(setor)) return null;

  const cadeiras: CadeiraDoRetrato[] = [];
  const tiposUsados = new Set<string>();
  if (ehObjeto(setor.cadeiras)) {
    for (const [chave, bruta] of Object.entries(setor.cadeiras)) {
      const c = ehObjeto(bruta) ? bruta : {};
      const tipo = typeof c.tipo === "string" ? c.tipo : null;
      if (tipo) tiposUsados.add(tipo);
      const valor = (v: Json) => (typeof v === "string" || typeof v === "number" ? v : null);
      cadeiras.push({
        chave,
        prefixo: valor(c.prefixo),
        num: valor(c.num),
        tipo,
        ...(cadeiraApagada(c) ? { apagada: true as const } : {})
      });
    }
  }

  const tipos = Array.isArray(mapa.config.tiposAssento) ? mapa.config.tiposAssento : [];
  return {
    versao: 1,
    mapa: { id: mapa.id, nome: texto(mapa.name) },
    setor: { id: setorId, nome: texto(setor.nome) },
    cadeiras,
    tiposAssento: tipos.filter((t): t is Record<string, unknown> => ehObjeto(t) && tiposUsados.has(texto(t.id)))
  };
}

/**
 * JSON canônico — RFC 8785 (JCS). Ver o algoritmo no cabeçalho.
 *
 * `JSON.stringify` já escreve strings e números como a RFC pede; o que falta é
 * ordenar as chaves, e a comparação padrão de strings do JavaScript (por
 * unidade UTF-16) é exatamente a ordem da RFC.
 */
export function jsonCanonico(valor: Json): string {
  if (valor === null || typeof valor !== "object") {
    if (typeof valor === "number" && !Number.isFinite(valor)) {
      throw new Error("JSON canônico não aceita NaN nem infinito.");
    }
    if (valor === undefined) throw new Error("JSON canônico não aceita valor indefinido.");
    if (typeof valor === "string") exigirTextoBemFormado(valor);
    return JSON.stringify(valor);
  }
  if (Array.isArray(valor)) {
    return `[${valor.map((item) => jsonCanonico(item === undefined ? null : item)).join(",")}]`;
  }
  const objeto = valor as Record<string, Json>;
  // A ORDEM NÃO VEM DA ENUMERAÇÃO DO OBJETO. O JavaScript enumera chave
  // puramente inteira ("2", "10") primeiro e em ordem numérica, e é isso que
  // faz "ordenar e chamar JSON.stringify" não ser JCS. Aqui a lista de chaves é
  // ordenada explicitamente por unidade UTF-16 ("10" antes de "2") e o texto é
  // montado chave a chave, nessa ordem, em todos os níveis.
  const chaves = Object.keys(objeto)
    .filter((chave) => objeto[chave] !== undefined)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${chaves
    .map((chave) => {
      exigirTextoBemFormado(chave);
      return `${JSON.stringify(chave)}:${jsonCanonico(objeto[chave])}`;
    })
    .join(",")}}`;
}

/**
 * A RFC 8785 só aceita texto Unicode válido: substituto solto (metade de um par
 * UTF-16) é erro, não algo a escapar. O `JSON.stringify` o escreveria como
 * `\ud83d`, e dois sistemas poderiam discordar do resultado. Não acontece com o
 * que vem de uma coluna jsonb — o Postgres recusa esse texto —, mas a função não
 * depende disso para ser fiel.
 */
function exigirTextoBemFormado(texto: string): void {
  for (let i = 0; i < texto.length; i += 1) {
    const unidade = texto.charCodeAt(i);
    if (unidade >= 0xd800 && unidade <= 0xdbff) {
      const seguinte = texto.charCodeAt(i + 1);
      if (!(seguinte >= 0xdc00 && seguinte <= 0xdfff)) {
        throw new Error("JSON canônico não aceita texto com substituto solto (Unicode inválido).");
      }
      i += 1;
    } else if (unidade >= 0xdc00 && unidade <= 0xdfff) {
      throw new Error("JSON canônico não aceita texto com substituto solto (Unicode inválido).");
    }
  }
}

/**
 * A REVISÃO DO MAPA — função única, usada onde quer que o vínculo seja gravado.
 *
 * SHA-256 do JSON canônico (RFC 8785) da `config` inteira, em UTF-8, devolvido
 * em hexadecimal minúsculo. Usa a Web Crypto (`crypto.subtle`), que existe no
 * navegador e no Node, para não haver duas implementações.
 */
export async function revisaoDoMapaTeatro(config: Json): Promise<string> {
  const bytes = new TextEncoder().encode(jsonCanonico(config));
  const resumo = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(resumo), (b) => b.toString(16).padStart(2, "0")).join("");
}
