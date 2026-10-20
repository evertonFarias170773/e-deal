/**
 * Seletor de telefone: o que a tela mostra (22/10/2026). Renderiza o componente REAL em HTML estatico.
 *
 *   npx --yes tsx --tsconfig tsconfig.json --import ./scratch/prova-telefone/_react-global.ts \
 *        scripts/testes/telefone-destinatario-seletor-render.test.tsx
 *
 * Sem banco e sem navegador.
 */
import "../../scratch/prova-telefone/_react-global";
import { renderToStaticMarkup } from "react-dom/server";
import { CampoTelefoneDestinatario } from "../../src/features/expedicao/components/CampoTelefoneDestinatario";
import { avaliarSelecaoDeTelefone, opcoesDeTelefone } from "../../src/features/expedicao/lib/telefone-edicao";

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${String(detalhe).slice(0, 400)}`}`);
  if (!ok) falhas++;
}

function campo(telefones: { whatsapp1: string; telefoneFixo: string; whatsapp2: string }, podeEditar: boolean, escolhida: "whatsapp_1" | "telefone_fixo" | "whatsapp_2", valor: string) {
  const opcoes = opcoesDeTelefone(telefones);
  const avaliacao = avaliarSelecaoDeTelefone({ whatsapp1: telefones.whatsapp1, exibido: valor, tocado: true, podeEditar });
  return renderToStaticMarkup(
    <CampoTelefoneDestinatario valor={valor} onChange={() => {}} podeEditar={podeEditar} avaliacao={avaliacao} nomeDestinatario="CLIENTE 10330" prepostagemJaGerada={false} opcoes={opcoes} escolhida={escolhida} onEscolher={() => {}} />
  );
}

const C10330 = { whatsapp1: "555198965", telefoneFixo: "5132304555", whatsapp2: "5132304554" };

{
  const html = campo(C10330, true, "whatsapp_1", "555198965");
  confere("com permissao e tres telefones: o seletor aparece com as tres opcoes", /aria-label="Qual telefone do cadastro usar"/.test(html) && (html.match(/<option/g) ?? []).length === 3, html);
  confere('o whatsapp_1 sem DDD vem marcado "(sem DDD)"', /WhatsApp 1: [^<]*\(sem DDD\)/.test(html), html);
  confere("o seletor esta habilitado", !/<select[^>]*disabled=""/.test(html));
  confere("o campo unico continua editavel", /<input[^>]*aria-label="Telefone do destinat/.test(html));
}
{
  const html = campo(C10330, false, "whatsapp_1", "(55) 5198-965");
  confere("sem cadastros.edit: o seletor fica bloqueado (disabled)", /<select[^>]*disabled=""/.test(html), html);
  confere("sem cadastros.edit: nao ha campo editavel, so o numero e o aviso", !/<input/.test(html) && /telefone-somente-leitura/.test(html) && /cadastros\.edit/.test(html), html);
}
{
  const html = campo({ whatsapp1: "51995506078", telefoneFixo: "", whatsapp2: "" }, true, "whatsapp_1", "(51) 99550-6078");
  confere("cliente com um so telefone: nao mostra seletor", !/<select/.test(html) && /<input/.test(html), html);
  const semPerm = campo({ whatsapp1: "51995506078", telefoneFixo: "", whatsapp2: "" }, false, "whatsapp_1", "(51) 99550-6078");
  confere("um so telefone, sem permissao: tambem sem seletor", !/<select/.test(semPerm));
}
{
  const html = campo(C10330, true, "telefone_fixo", "(51) 3230-4555");
  confere("escolhido o fixo: o aviso diz que grava no WhatsApp 1 e que os outros nao mudam", /gravado no WhatsApp 1 do cadastro de CLIENTE 10330/.test(html) && /os outros telefones não mudam/.test(html), html);
  confere("a opcao selecionada e o fixo", /<option value="telefone_fixo" selected/.test(html), html);
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
