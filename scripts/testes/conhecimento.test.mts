/**
 * Conhecimento da transportadora x rastreio dos Correios (15/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/conhecimento.test.mts
 */
import {
  ORIGEM_LOG_CONHECIMENTO,
  campoCodigoVisivel,
  despachoEhCorreios,
  deveRegistrarConhecimento,
  ehConhecimento,
  motivoDoConhecimento,
  pareceObjetoCorreios,
  rotuloDoCampoCodigo
} from "../../src/features/expedicao/lib/conhecimento.ts";
import { registrarAutoriaConhecimento } from "../../src/features/expedicao/services/conhecimento-autoria.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  if (JSON.stringify(real) !== JSON.stringify(esperado)) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else console.log(`ok      ${nome}`);
}

// ── o campo e o rotulo por despacho
checar("CORREIOS: campo e rotulo de sempre", [campoCodigoVisivel("CORREIOS"), rotuloDoCampoCodigo("CORREIOS")], [true, "Código de rastreio (manual)"]);
checar("TRANSPORTADORA: campo 'Conhecimento'", [campoCodigoVisivel("TRANSPORTADORA"), rotuloDoCampoCodigo("TRANSPORTADORA")], [true, "Conhecimento"]);
checar("MOTOBOY: campo 'Conhecimento'", [campoCodigoVisivel("MOTOBOY"), rotuloDoCampoCodigo("MOTOBOY")], [true, "Conhecimento"]);
checar("retirada no balcao: sem campo", campoCodigoVisivel("RETIRA_BALCAO"), false);
checar("ehConhecimento", [ehConhecimento("TRANSPORTADORA"), ehConhecimento("MOTOBOY"), ehConhecimento("CORREIOS"), ehConhecimento(null)], [true, true, false, false]);

// ── so o despacho CORREIOS e rastreado
checar("CORREIOS e rastreavel", despachoEhCorreios({ tipoFrete: "CORREIOS", codigo: "AD123456789BR" }), true);
checar("CORREIOS com codigo digitado fora do formato continua igual a hoje (rastreavel)", despachoEhCorreios({ tipoFrete: "CORREIOS", codigo: "XYZ" }), true);
checar("TRANSPORTADORA nunca e Correios", despachoEhCorreios({ tipoFrete: "TRANSPORTADORA", codigo: "123456" }), false);
checar("MOTOBOY nunca e Correios", despachoEhCorreios({ tipoFrete: "MOTOBOY", codigo: "98765" }), false);
checar("TRANSPORTADORA com numero parecido com objeto: ainda nao e Correios", despachoEhCorreios({ tipoFrete: "TRANSPORTADORA", codigo: "AD123456789BR" }), false);
checar("prepostagem gravada e Correios por definicao", despachoEhCorreios({ tipoFrete: "TRANSPORTADORA", correiosIdPrepostagem: "PR123" }), true);
checar("objeto dos Correios gravado e Correios", despachoEhCorreios({ tipoFrete: null, correiosCodigoObjeto: "AD123456789BR" }), true);
checar("legado sem despacho registrado: vale o formato oficial", [despachoEhCorreios({ tipoFrete: null, codigo: "AD123456789BR" }), despachoEhCorreios({ tipoFrete: "INDEFINIDO", codigo: "123456" })], [true, false]);
checar("pedido COTADO como SEDEX mas despachado por transportadora: a cotacao nao decide (nao e entrada)", despachoEhCorreios({ tipoFrete: "TRANSPORTADORA", codigo: "5544" }), false);
checar("formato oficial", [pareceObjetoCorreios("ad123456789br"), pareceObjetoCorreios("12345"), pareceObjetoCorreios(null)], [true, false, false]);

// ── autoria: quando registrar
checar("transportadora: salvar pela 1a vez registra", deveRegistrarConhecimento("TRANSPORTADORA", null, "CTE 123"), true);
checar("transportadora: corrigir registra", deveRegistrarConhecimento("TRANSPORTADORA", "CTE 123", "CTE 124"), true);
checar("motoboy: registra", deveRegistrarConhecimento("MOTOBOY", "", "55"), true);
checar("mesmo valor (so espacos): nao registra", deveRegistrarConhecimento("TRANSPORTADORA", "CTE 123", "  CTE 123 "), false);
checar("CORREIOS: tudo igual a hoje, nao registra", deveRegistrarConhecimento("CORREIOS", "AD1", "AD2"), false);
checar("apagar o conhecimento registra", deveRegistrarConhecimento("TRANSPORTADORA", "CTE 123", ""), true);
checar("texto: valor antigo e novo", motivoDoConhecimento("CTE 123", "CTE 124"), 'Conhecimento: "CTE 123" -> "CTE 124"');
checar("texto: antes vazio", motivoDoConhecimento(null, "CTE 1"), 'Conhecimento: (vazio) -> "CTE 1"');

// ── autoria: o que vai para o os_status_log (cliente simulado)
type Linha = Record<string, unknown>;
const cliente = (erro?: string) => {
  const gravadas: { tabela: string; linha: Linha }[] = [];
  return {
    gravadas,
    from: (tabela: string) => ({
      insert: async (linha: Linha) => {
        gravadas.push({ tabela, linha });
        return { error: erro ? { message: erro } : null };
      }
    })
  };
};
const ator = { uid: "uid-1", nome: "Ana Expedidora" };

let c = cliente();
let r = await registrarAutoriaConhecimento(c, { idInt: 100, statusAtual: "EM TRANSITO", tipoEfetivo: "TRANSPORTADORA", antes: null, depois: "CTE 777", ator });
checar("transportadora salva DEPOIS do despacho: 1 linha no os_status_log", [r.registrou, c.gravadas.length, c.gravadas[0]?.tabela], [true, 1, "os_status_log"]);
checar("linha: status nao muda, autor, origem e valores", [c.gravadas[0].linha.status_anterior, c.gravadas[0].linha.status_novo, c.gravadas[0].linha.ator_nome, c.gravadas[0].linha.ator_uid, c.gravadas[0].linha.origem, c.gravadas[0].linha.motivo, c.gravadas[0].linha.resultado, c.gravadas[0].linha.id_int],
  ["EM TRANSITO", "EM TRANSITO", "Ana Expedidora", "uid-1", ORIGEM_LOG_CONHECIMENTO, 'Conhecimento: (vazio) -> "CTE 777"', "sucesso", 100]);
c = cliente();
r = await registrarAutoriaConhecimento(c, { idInt: 100, statusAtual: "ENTREGUE", tipoEfetivo: "TRANSPORTADORA", antes: "CTE 777", depois: "CTE 778", ator });
checar("corrige depois (ENTREGUE): antigo -> novo", c.gravadas[0].linha.motivo, 'Conhecimento: "CTE 777" -> "CTE 778"');
c = cliente();
r = await registrarAutoriaConhecimento(c, { idInt: 7, statusAtual: "EM TRANSITO", tipoEfetivo: "CORREIOS", antes: "AD1", depois: "AD2", ator });
checar("pedido CORREIOS: nada registrado", [r.registrou, c.gravadas.length], [false, 0]);
c = cliente();
r = await registrarAutoriaConhecimento(c, { idInt: 7, statusAtual: "EM TRANSITO", tipoEfetivo: "TRANSPORTADORA", antes: "X", depois: "X", ator });
checar("sem mudanca: nada registrado", c.gravadas.length, 0);
c = cliente("falha de rede");
r = await registrarAutoriaConhecimento(c, { idInt: 7, statusAtual: "EXPEDICAO", tipoEfetivo: "MOTOBOY", antes: null, depois: "55", ator });
checar("falha no log: devolve aviso, nao estoura", [r.registrou, r.aviso], [false, "falha de rede"]);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
