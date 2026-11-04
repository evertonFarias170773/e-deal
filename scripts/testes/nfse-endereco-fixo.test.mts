/**
 * NFS-e: endereço do tomador fixo e versão da janela (04/11/2026, pedido do financeiro; modelo 23991).
 *
 *   node --experimental-strip-types scripts/testes/nfse-endereco-fixo.test.mts
 *
 * O QUE PROVA
 *   1. O endereço que vai na nota é o PRINCIPAL do tomador, pela regra do destinatário
 *      da NF-e (escolherEnderecoPrincipal): Maxion (1 endereço) e Zaffari (5 endereços).
 *   2. Sem endereço utilizável (nenhum, sem principal, principal incompleto), há motivo
 *      e o rascunho não sai.
 *   3. A janela não tem mais seletor de endereço; a rota usa o endereço do servidor e
 *      recusa janela de versão anterior (a causa da frase nas complementares).
 */
import { readFileSync } from "node:fs";
import { escolherEnderecoPrincipal } from "../../src/lib/fiscal/endereco-principal.ts";
import { motivoSemEnderecoDoTomador } from "../../src/features/nfse/lib/composicao-nfse.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}${ok ? "" : `\n      obtido:   ${JSON.stringify(obtido)}\n      esperado: ${JSON.stringify(esperado)}`}`);
}
const end = (o: Record<string, string | null>) => ({ id: "x", logradouro: "Rua A", numero: "1", complemento: "", bairro: "Centro", cidade: "Porto Alegre", uf: "RS", cep: "90000000", tipo_endereco: "ENTREGA", data_criacao: "2026-10-01", ...o });

// 1. O principal, como na NF-e (dados do banco em 04/11/2026)
const maxion = [end({ id: "228a53b3", logradouro: "RUA FURRIEL LUIZ ANTONIO DE VARGAS", numero: "239", tipo_endereco: "PRINCIPAL", data_criacao: "2026-10-20T19:49:15" })];
checar("23991: Maxion, o único endereço (principal)", escolherEnderecoPrincipal(maxion)?.id, "228a53b3");
const zaffari = [
  end({ id: "c980bbba", logradouro: "AVENIDA PLINIO BRASIL MILANO", tipo_endereco: "PRINCIPAL", data_criacao: "2025-12-20T19:32:26" }),
  end({ id: "6f4ff007", tipo_endereco: "ENTREGA", data_criacao: "2026-10-20T19:54:14" }),
  end({ id: "7dbafdfb", tipo_endereco: "ENTREGA", data_criacao: "2026-10-20T20:11:43" }),
  end({ id: "fd59db35", tipo_endereco: "ENTREGA", data_criacao: "2026-11-03T14:04:50" }),
  end({ id: "680f4455", tipo_endereco: "ENTREGA", data_criacao: "2026-11-03T19:33:19" })
];
checar("24623: Zaffari com 5 endereços -> só o principal (Plinio Brasil Milano)", escolherEnderecoPrincipal(zaffari)?.id, "c980bbba");
checar("principal duplicado: CAIXA ALTA vence (regra da NF-e)", escolherEnderecoPrincipal([end({ id: "a", tipo_endereco: "Principal", data_criacao: "2026-11-01" }), end({ id: "b", tipo_endereco: "PRINCIPAL", data_criacao: "2026-01-01" })])?.id, "b");

// 2. Motivos
const comLinha = (e: ReturnType<typeof end>) => ({ ...e, logradouro: e.logradouro ?? "", numero: e.numero ?? "", complemento: e.complemento ?? "", bairro: e.bairro ?? "", cidade: e.cidade ?? "", uf: e.uf ?? "", cep: e.cep ?? "" });
checar("com principal utilizável: sem motivo", motivoSemEnderecoDoTomador(1, comLinha(maxion[0])), null);
checar("sem endereço nenhum: motivo", /não tem endereço cadastrado/.test(String(motivoSemEnderecoDoTomador(0, null))), true);
checar("com endereços, sem principal: motivo", /não tem endereço principal/.test(String(motivoSemEnderecoDoTomador(3, null))), true);
checar("principal com texto quebrado: motivo", /cadastro incompleto/.test(String(motivoSemEnderecoDoTomador(1, comLinha(end({ bairro: "NULL" }))))), true);
checar("principal sem cidade: motivo", /cadastro incompleto/.test(String(motivoSemEnderecoDoTomador(1, comLinha(end({ cidade: "" }))))), true);

// 3. Janela, rota e servidor
const modal = readFileSync("src/features/nfse/components/GerarNfseModal.tsx", "utf8");
const rota = readFileSync("src/app/api/fiscal/rascunho-nfse/route.ts", "utf8");
const servidor = readFileSync("src/features/nfse/services/nfse-pedido.server.ts", "utf8");
checar("janela: sem seletor de endereço", /id="nfse-endereco"|<select[^>]*idEndereco|Escolha o endereço do tomador/.test(modal), false);
checar("janela: mostra o endereço fixo", /data-endereco-fixo/.test(modal), true);
checar("janela: sem endereço utilizável, Criar rascunho desligado", /Boolean\(semEnderecoUtilizavel\)/.test(modal), true);
checar("janela: manda a versão, não o endereço", /versao_janela: VERSAO_DA_JANELA_NFSE/.test(modal) && !/id_endereco:/.test(modal), true);
checar("rota: endereço do servidor, não do navegador", /p_id_endereco_tomador: enderecoDoTomador\.id/.test(rota) && !/corpo\?\.id_endereco/.test(rota), true);
checar("rota: recusa janela de versão anterior", /corpo\?\.versao_janela !== VERSAO_DA_JANELA_NFSE/.test(rota) && /JANELA_DESATUALIZADA/.test(rota), true);
checar("servidor: principal pela regra da NF-e", /escolherEnderecoPrincipal\(/.test(servidor) && /data_criacao/.test(servidor), true);
checar("janela: complementares seguem nascendo vazias", /setInfComp\(""\)/.test(modal), true);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
