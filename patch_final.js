import fs from "fs";

const path = "src/features/orcamentos/OrcamentoFormPage.tsx";
let content = fs.readFileSync(path, "utf-8");

// 1. Add hasActiveCobranca
const hasCobOld = `const hasCobrancas = proposta?.id_int ? getCobrancasByProposta(proposta.id_int).length > 0 : false;`;
const newCobLogic = `const cobrancasVinculadas = proposta?.id_int ? getCobrancasByProposta(proposta.id_int) : [];
  const hasCobrancas = cobrancasVinculadas.length > 0;
  const hasActiveCobranca = cobrancasVinculadas.some(c => c.status !== "CANCELADO" && c.status !== "CANCELADA" && c.status !== "EXTORNADO" && c.status !== "RECUSADO");`;

if (content.includes(hasCobOld)) {
  content = content.replace(hasCobOld, newCobLogic);
  console.log("hasActiveCobranca inserido");
} else {
  console.log("hasCobrancas antigo não encontrado");
}

// 2. Fix the Toast using regex
const regexToast = /showToast\(\{\s*type: "success",\s*title: mode === "edit" \? "Orçamento atualizado com sucesso\." : "Orçamento criado com sucesso\.",\s*description: "Aguardando sua escolha\.\.\."\s*\}\);/;

const newToastLines = `showToast({
          type: res.errorMessage ? "info" : "success",
          title: res.errorMessage ? "Salvamento Parcial" : (mode === "edit" ? "Orçamento atualizado com sucesso." : "Orçamento criado com sucesso."),
          description: res.errorMessage || "Aguardando sua escolha..."
        });`;

if (regexToast.test(content)) {
  content = content.replace(regexToast, newToastLines);
  console.log("Toast success atualizado");
} else {
  console.log("Toast success antigo não encontrado!");
}

// 3. Produtos
const produtosTab = `{activeFormTab === "produtos" && (`;
if (content.includes(produtosTab)) {
  const pieces = content.split(produtosTab);
  pieces[1] = pieces[1].replace(/<div className="space-y-6">/, `<fieldset disabled={hasActiveCobranca} className="group space-y-6">`);
  pieces[1] = pieces[1].replace(/<\/div>\s*\)\}\s*\{activeFormTab === "fretes"/, `</fieldset>\n              )}\n\n              {activeFormTab === "fretes"`);
  content = pieces.join(produtosTab);
}

// 4. Fretes
const fretesTab = `{activeFormTab === "fretes" && (`;
if (content.includes(fretesTab)) {
  const pieces = content.split(fretesTab);
  pieces[1] = pieces[1].replace(/<div className="space-y-6">/, `<fieldset disabled={hasActiveCobranca} className="group space-y-6">`);
  pieces[1] = pieces[1].replace(/<\/div>\s*\)\}\s*\{activeFormTab === "pedido"/, `</fieldset>\n              )}\n\n              {activeFormTab === "pedido"`);
  content = pieces.join(fretesTab);
}

// 5. Pagamentos
const pagamentosTab = `{activeFormTab === "pagamentos" && (`;
if (content.includes(pagamentosTab)) {
  const pieces = content.split(pagamentosTab);
  pieces[1] = pieces[1].replace(/<div className="space-y-6">/, `<fieldset disabled={hasActiveCobranca} className="group space-y-6">`);
  pieces[1] = pieces[1].replace(/<\/div>\s*\)\}\s*\{activeFormTab === "historico"/, `</fieldset>\n              )}\n\n              {activeFormTab === "historico"`);
  content = pieces.join(pagamentosTab);
}

fs.writeFileSync(path, content, "utf-8");
console.log("Tabs bloqueadas de forma correta e limpa!");
