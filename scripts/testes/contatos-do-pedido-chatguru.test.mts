/**
 * Contatos do pedido pelo ChatGuru (14/11/2026, decisão da diretoria).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/contatos-do-pedido-chatguru.test.mts
 *
 * 1. Telefone para as APIs: celular de 8 dígitos ganha o 9, fixo não muda.
 * 2. E-mail do boleto: e-mail financeiro, e-mail, e-mail de contato do cadastro do pagador.
 * 3. Telefone da cobrança: a principal do Guru, senão o de antes.
 * 4. Escolha das conversas: sem repetição e com uma principal; telefone casado por DDD + 8.
 * 5. As ligações: rota, Salvar, liberação, Maestro, cobrança, Expedição.
 */
import { readFileSync } from "node:fs";
import { telefoneParaApi } from "../../src/lib/telefone/telefone-br.ts";
import { emailDoPagador, telefoneDaCobranca, MENSAGEM_PAGADOR_SEM_EMAIL } from "../../src/features/cobrancas/lib/contato-da-cobranca.ts";
import { chaveDoTelefone, escolhaDeContatos, mesmoTelefone, SEM_CONVERSA_NO_GURU } from "../../src/features/orcamentos/lib/conversa-whatsapp.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else {
    console.log(`ok      ${nome}`);
  }
}

// ── 1. Telefone para as APIs ──
checar("Guru celular sem o 9 (55 51 9910-1042) ganha o 9", telefoneParaApi("555199101042"), "51999101042");
checar("celular sem o 9 começando com 6 ganha o 9", telefoneParaApi("556181234567"), "61981234567");
checar("celular sem o 9 começando com 7 e 8 ganham o 9", [telefoneParaApi("5511712345678".slice(0, 12)), telefoneParaApi("551188123456")], ["11971234567", "11988123456"]);
checar("fixo (começa com 3) não muda", telefoneParaApi("555130932840"), "5130932840");
checar("fixo começando com 2, 4 e 5 não mudam", ["552123456789", "554134567890", "555154321000"].map(telefoneParaApi), ["2123456789", "4134567890", "5154321000"]);
checar("celular que já tem o 9 não muda", telefoneParaApi("5551991010423"), "51991010423");
checar("sem DDI também funciona", [telefoneParaApi("5199101042"), telefoneParaApi("(51) 3093-2840")], ["51999101042", "5130932840"]);
checar("inválidos devolvem vazio", ["", null, "123", "550099101042", "51199101042", "5101234567"].map(telefoneParaApi), ["", "", "", "", "", ""]);

// ── 2. E-mail do pagador ──
checar("financeiro primeiro", emailDoPagador({ email_financeiro: "fin@x.com", email: "a@x.com", email_contato: "c@x.com" }), "fin@x.com");
checar("sem financeiro: o e-mail", emailDoPagador({ email_financeiro: " ", email: "a@x.com", email_contato: "c@x.com" }), "a@x.com");
checar("sem os dois: o e-mail de contato", emailDoPagador({ email_financeiro: null, email: "", email_contato: "c@x.com" }), "c@x.com");
checar("nenhum: vazio", [emailDoPagador({}), emailDoPagador(null)], ["", ""]);
checar("mensagem do pagador sem e-mail cita os três campos", ["financeiro", "e-mail de contato"].every((t) => MENSAGEM_PAGADOR_SEM_EMAIL.includes(t)), true);

// ── 3. Telefone da cobrança ──
checar("principal do Guru vence o de antes", telefoneDaCobranca("555199101042", "51988887777"), { telefone: "51999101042", origemTelefone: "CHATGURU" });
checar("pedido antigo sem principal: o de antes, pela mesma função", telefoneDaCobranca(null, "5188887777"), { telefone: "51988887777", origemTelefone: "ANTIGO" });
checar("fixo do Guru vai como fixo", telefoneDaCobranca("555130932840", ""), { telefone: "5130932840", origemTelefone: "CHATGURU" });
checar("nada: vazio", telefoneDaCobranca(null, ""), { telefone: "", origemTelefone: null });

// ── 4. Escolha e telefone casado ──
checar("escolha sem repetição, principal dentro", escolhaDeContatos(["a", "b", "a", " "], "b"), { chatIds: ["a", "b"], principal: "b" });
checar("principal fora do conjunto vira a primeira", escolhaDeContatos(["a", "b"], "z"), { chatIds: ["a", "b"], principal: "a" });
checar("nenhuma conversa: null", escolhaDeContatos([], "a"), null);
checar("chave do telefone ignora 55 e o 9", [chaveDoTelefone("5551991010423"), chaveDoTelefone("555191010423"), chaveDoTelefone("(51) 9101-0423")], ["5191010423", "5191010423", "5191010423"]);
checar("mesmo telefone com e sem o 9", mesmoTelefone("51991010423", "555191010423"), true);
checar("telefones diferentes", mesmoTelefone("51991010423", "51991010424"), false);
checar("trava diz cadastre a conversa no ChatGuru", SEM_CONVERSA_NO_GURU.startsWith("Cadastre a conversa no ChatGuru"), true);

// ── 5. As ligações ──
const ler = (p: string) => readFileSync(p, "utf8");
const rota = ler("src/app/api/orcamentos/conversa-whatsapp/route.ts");
const servico = ler("src/features/orcamentos/services/orcamentos.service.ts");
const pagina = ler("src/features/orcamentos/OrcamentoFormPage.tsx");
const provedor = ler("src/features/cobrancas/CobrancasProvider.tsx");
const painel = ler("src/features/cobrancas/PropostaCobrancaPanel.tsx");
const maestro = ler("src/features/maestro/core/simple/maestro-save-proposta.server.ts");
const despacho = ler("src/features/expedicao/components/DespacharModal.tsx");
const nucleo = ler("src/features/cobrancas/services/conferencia-nucleo.server.ts");
checar("rota grava a tabela, a principal e espelha chatguru_chat_id", [rota.includes('from("propostas_contatos_chatguru")'), rota.includes("chatguru_chat_id: principal.chat_id"), rota.includes("contatoParaAPrincipal(")], [true, true, true]);
checar("rota aceita a escolha inteira e só a principal", [rota.includes("Array.isArray(corpo?.chat_ids)"), rota.includes("principalPedida = limpar(corpo?.chat_id, 80)")], [true, true]);
checar("Salvar não exige mais contato da tabela", servico.includes('"Selecione um contato antes de salvar o orçamento."'), false);
checar("Salvar não regrava id_contato e contato na alteração", servico.includes("delete (propostaData as Record<string, unknown>).id_contato;"), true);
checar("liberação exige contato do ChatGuru", [servico.includes("const contatoDoPedido = await temContatoDoChatGuru(client, idInt);"), servico.includes('code: "SEM_CONTATO_CHATGURU"')], [true, true]);
checar("liberação automática avisa no chat", nucleo.includes('liberacao.code === "SEM_CONTATO_CHATGURU"'), true);
checar("aba Geral usa os contatos do Guru, sem a lista da tabela contatos", [pagina.includes("<ContatosDoPedido"), pagina.includes('rotuloOutros="Outros contatos"')], [true, false]);
checar("cobrança não usa mais o e-mail nem o telefone do contato da tabela", [/proposta\.contato\?\.email/.test(provedor + painel), /telefone: proposta\.contato\?\.whatsapp/.test(provedor + painel), provedor.includes('.select("nome_contato, whats, e_mail")')], [false, false, false]);
checar("cobrança lê e-mail e telefone pela função única", [(provedor.match(/lerContatoDaCobranca\(/g) ?? []).length, (painel.match(/lerContatoDaCobranca\(/g) ?? []).length], [2, 2]);
checar("Maestro salva sem contato", maestro.includes("bloqueadoPorContato: true"), false);
checar("Expedição mostra os contatos do pedido no despacho", despacho.includes("<ContatosDoPedidoNoDespacho idInt={pedido.idInt}"), true);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
