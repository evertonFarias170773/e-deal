import fs from "fs";

const path = "src/features/orcamentos/OrcamentoFormPage.tsx";
let content = fs.readFileSync(path, "utf-8");

// 1. Produtos
const produtosTab = `{activeFormTab === "produtos" && (`;
if (content.includes(produtosTab)) {
  const pieces = content.split(produtosTab);
  pieces[1] = pieces[1].replace(/<div className="space-y-6">/, `<fieldset disabled={hasActiveCobranca} className="group space-y-6">`);
  // we must also replace the closing </div> of that tab.
  // The tab ends at:
  //               )}
  // 
  //               {activeFormTab === "fretes"
  pieces[1] = pieces[1].replace(/<\/div>\s*\)\}\s*\{activeFormTab === "fretes"/, `</fieldset>\n              )}\n\n              {activeFormTab === "fretes"`);
  content = pieces.join(produtosTab);
}

// 2. Fretes
const fretesTab = `{activeFormTab === "fretes" && (`;
if (content.includes(fretesTab)) {
  const pieces = content.split(fretesTab);
  pieces[1] = pieces[1].replace(/<div className="space-y-6">/, `<fieldset disabled={hasActiveCobranca} className="group space-y-6">`);
  pieces[1] = pieces[1].replace(/<\/div>\s*\)\}\s*\{activeFormTab === "pedido"/, `</fieldset>\n              )}\n\n              {activeFormTab === "pedido"`);
  content = pieces.join(fretesTab);
}

// 3. Pagamentos
const pagamentosTab = `{activeFormTab === "pagamentos" && (`;
if (content.includes(pagamentosTab)) {
  const pieces = content.split(pagamentosTab);
  pieces[1] = pieces[1].replace(/<div className="space-y-6">/, `<fieldset disabled={hasActiveCobranca} className="group space-y-6">`);
  pieces[1] = pieces[1].replace(/<\/div>\s*\)\}\s*\{activeFormTab === "historico"/, `</fieldset>\n              )}\n\n              {activeFormTab === "historico"`);
  content = pieces.join(pagamentosTab);
}

fs.writeFileSync(path, content, "utf-8");
console.log("Tabs bloqueadas de forma correta e limpa!");
