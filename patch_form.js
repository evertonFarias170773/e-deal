import fs from "fs";

const path = "src/features/orcamentos/OrcamentoFormPage.tsx";
let content = fs.readFileSync(path, "utf-8");

// 1. Add hasActiveCobranca
const hookFind = `const { getCobrancasByProposta } = useCobrancas();`;
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

// 2. Fix the Toast for partial success
const toastSuccessOld = `        showToast({
          type: "success",
          title: mode === "edit" ? "Orçamento atualizado com sucesso." : "Orçamento criado com sucesso.",
          description: "Aguardando sua escolha..."
        });`;

const toastSuccessNew = `        showToast({
          type: res.errorMessage ? "info" : "success",
          title: res.errorMessage ? "Salvamento Parcial" : (mode === "edit" ? "Orçamento atualizado com sucesso." : "Orçamento criado com sucesso."),
          description: res.errorMessage || "Aguardando sua escolha..."
        });`;

if (content.includes(toastSuccessOld)) {
  content = content.replace(toastSuccessOld, toastSuccessNew);
  console.log("Toast success atualizado");
} else {
  console.log("Toast success antigo não encontrado");
}

// 3. Disable sections using regex
// For Forma de Pagamento
content = content.replace(
  /<FormSection title="4\. Forma de Pagamento" description="Como o cliente vai pagar\.">/g,
  '<fieldset disabled={hasActiveCobranca} className="group">\n                    <FormSection title="4. Forma de Pagamento" description="Como o cliente vai pagar.">'
);

// Close FormSection for Forma de Pagamento
// Need to find exactly where it closes before Desconto Geral
content = content.replace(
  /<\/FormSection>\s*\{\/\* Desconto Geral \*\/\}/g,
  '</FormSection>\n                    </fieldset>\n\n                {/* Desconto Geral */}'
);

// For Desconto Geral
content = content.replace(
  /<FormSection title="5\. Desconto Geral" description="Desconto aplicado ao final\.">/g,
  '<fieldset disabled={hasActiveCobranca} className="group">\n                  <FormSection title="5. Desconto Geral" description="Desconto aplicado ao final.">'
);
content = content.replace(
  /<\/FormSection>\s*<\/div>\s*\)\}/g,
  '</FormSection>\n                  </fieldset>\n                </div>\n              )}'
);

// For Produtos Tab
content = content.replace(
  /<FormSection\s+title="6\. Produtos"\s+description=\{form\.isAvulso/g,
  '<fieldset disabled={hasActiveCobranca} className="group">\n                  <FormSection\n                    title="6. Produtos"\n                    description={form.isAvulso'
);
content = content.replace(
  /<\/FormSection>\s*<\/div>\s*\)\}\s*\{activeFormTab === "fretes"/g,
  '</FormSection>\n                  </fieldset>\n                </div>\n              )}\n\n              {activeFormTab === "fretes"'
);

// For Fretes Tab
content = content.replace(
  /<FormSection \s*title="7\. Fretes e Entrega"\s*description=\{form\.isAvulso/g,
  '<fieldset disabled={hasActiveCobranca} className="group">\n                  <FormSection \n            title="7. Fretes e Entrega" \n            description={form.isAvulso'
);
content = content.replace(
  /<\/FormSection>\s*<\/div>\s*\)\}\s*\{activeFormTab === "pedido"/g,
  '</FormSection>\n                  </fieldset>\n                </div>\n              )}\n\n              {activeFormTab === "pedido"'
);

fs.writeFileSync(path, content, "utf-8");
console.log("OrcamentoFormPage.tsx atualizado com sucesso!");
