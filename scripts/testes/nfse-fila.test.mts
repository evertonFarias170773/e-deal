/**
 * Fila de Faturamento × NFS-e — src/features/nfse/lib/fila-nfse.ts
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/nfse-fila.test.mts
 *
 * O QUE PROVA
 *   1. Só a NFS-e AUTORIZADA esconde o pedido da Fila; rascunho, em análise,
 *      erro de envio, recusada e cancelada continuam visíveis.
 *   2. A caixa "Mostrar também pedidos com NFS-e emitida" traz os pedidos de volta.
 *   3. Fail-safe: leitura carregando ou com falha não esconde nada.
 *   4. Os contadores: o da Fila conta só o visível, e "(+M com NFS-e emitida)"
 *      conta os ocultos — a soma dos dois é o total de antes.
 */
import { pedidoOcultoPorNfse, pedidoTemNfseAutorizada, rotuloDosOcultosPorNfse } from "../../src/features/nfse/lib/fila-nfse.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : `\n       obtido:   ${JSON.stringify(obtido)}\n       esperado: ${JSON.stringify(esperado)}`}`);
}

const nota = (ref: string, status: string, numero_nfse: string | null = null, created_at = "2026-10-07T10:00:00Z") => ({ ref, status, numero_nfse, created_at });

// 1. Só AUTORIZADA esconde
checar("autorizada: o pedido tem NFS-e emitida", pedidoTemNfseAutorizada([nota("NFS-23248-001", "AUTORIZADA", "14")]), true);
checar(
  "os outros estados nao contam como emitida",
  ["PENDENTE", "PRONTA_PARA_ENVIO", "PROCESSANDO", "RETORNO_FOCUS", "ERRO_ENVIO", "ERRO_VALIDACAO", "ERRO_AUTORIZACAO", "CANCELADA", "REJEITADA", "ALGO_NOVO"].map((s) => pedidoTemNfseAutorizada([nota("NFS-1-001", s)])),
  [false, false, false, false, false, false, false, false, false, false]
);
checar("pedido sem nota nenhuma", [pedidoTemNfseAutorizada([]), pedidoTemNfseAutorizada(undefined)], [false, false]);
checar(
  "autorizada antiga e rascunho mais novo: continua emitida",
  pedidoTemNfseAutorizada([nota("NFS-1-001", "AUTORIZADA", "9", "2026-10-06T10:00:00Z"), nota("NFS-1-002", "PENDENTE", null, "2026-10-07T10:00:00Z")]),
  true
);
checar("autorizada que foi cancelada depois e so tem a cancelada: nao esconde", pedidoTemNfseAutorizada([nota("NFS-1-001", "CANCELADA")]), false);

// A Fila do teste: 23248, 23304 e 23309 com NFS-e autorizada; 23238 sem nota; 23180 com rascunho; 23400 em análise.
const porPedido = new Map([
  [23248, [nota("NFS-23248-001", "AUTORIZADA", "14")]],
  [23304, [nota("NFS-23304-001", "AUTORIZADA", "15")]],
  [23309, [nota("NFS-23309-001", "AUTORIZADA", "16")]],
  [23180, [nota("NFS-23180-001", "PENDENTE")]],
  [23400, [nota("NFS-23400-001", "PROCESSANDO")]],
  [23401, [nota("NFS-23401-001", "ERRO_ENVIO")]]
]);
const fila = [23248, 23304, 23309, 23238, 23180, 23400, 23401, 23206 /* E3: nem entra na leitura */];
const pronta = { porPedido, pronta: true };
const visiveis = (leitura: typeof pronta, mostrar: boolean) => fila.filter((id) => !pedidoOcultoPorNfse(id, leitura, mostrar));

checar("padrao: somem so os tres com NFS-e autorizada", visiveis(pronta, false), [23238, 23180, 23400, 23401, 23206]);
checar("rascunho, em analise e erro continuam visiveis", [23180, 23400, 23401].map((id) => pedidoOcultoPorNfse(id, pronta, false)), [false, false, false]);

// 2. A caixa
checar("caixa marcada: todos voltam", visiveis(pronta, true), fila);
checar("caixa marcada: nenhum pedido e oculto", fila.some((id) => pedidoOcultoPorNfse(id, pronta, true)), false);

// 3. Fail-safe
checar("leitura carregando ou com falha: nada e escondido", visiveis({ porPedido, pronta: false }, false), fila);
checar("leitura que nao chegou (mapa vazio, nao pronta): nada e escondido", visiveis({ porPedido: new Map(), pronta: false }, false), fila);
checar("leitura pronta e vazia: nada a esconder", visiveis({ porPedido: new Map(), pronta: true }, false), fila);
checar("id de pedido invalido nunca e escondido", [null, undefined, 0, -1, Number.NaN].map((id) => pedidoOcultoPorNfse(id as number, pronta, false)), [false, false, false, false, false]);

// 4. Contadores
const total = fila.length;
const naTela = visiveis(pronta, false).length;
const ocultos = total - naTela;
checar("contador da Fila conta so o visivel", [naTela, ocultos], [5, 3]);
checar("visiveis + ocultos = total de antes", naTela + ocultos, total);
checar("rotulo dos ocultos", [rotuloDosOcultosPorNfse(3), rotuloDosOcultosPorNfse(1), rotuloDosOcultosPorNfse(0), rotuloDosOcultosPorNfse(-2)], ["(+3 com NFS-e emitida)", "(+1 com NFS-e emitida)", "", ""]);
checar("com a caixa marcada nao ha ocultos a anunciar", rotuloDosOcultosPorNfse(total - visiveis(pronta, true).length), "");
checar("com a leitura em falha nao ha ocultos a anunciar", rotuloDosOcultosPorNfse(total - visiveis({ porPedido, pronta: false }, false).length), "");

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
