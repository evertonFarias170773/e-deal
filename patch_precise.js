import fs from "fs";

const path = "src/features/orcamentos/OrcamentoFormPage.tsx";
let content = fs.readFileSync(path, "utf-8");

// Helper function to safely replace
function replaceSafe(search, replacement, name) {
  if (content.includes(search)) {
    content = content.replace(search, replacement);
    console.log("Success: " + name);
  } else {
    console.error("FAILED to find: " + name);
  }
}

replaceSafe(
  \`const hasCobrancas = proposta?.id_int ? getCobrancasByProposta(proposta.id_int).length > 0 : false;\`,
  \`const cobrancasVinculadas = proposta?.id_int ? getCobrancasByProposta(proposta.id_int) : [];
  const hasCobrancas = cobrancasVinculadas.length > 0;
  const hasActiveCobranca = cobrancasVinculadas.some(c => c.status !== "CANCELADO" && c.status !== "CANCELADA" && c.status !== "EXTORNADO" && c.status !== "RECUSADO");\`,
  "hasActiveCobranca"
);

// We need regex for the toast because of spacing
const regexToast = /showToast\\(\\{\\s*type: "success",\\s*title: mode === "edit" \\? "Orçamento atualizado com sucesso\\." : "Orçamento criado com sucesso\\.",\\s*description: "Aguardando sua escolha\\.\\.\\."\\s*\\}\\);/;
if (regexToast.test(content)) {
  content = content.replace(regexToast, \`showToast({
          type: res.errorMessage ? "info" : "success",
          title: res.errorMessage ? "Salvamento Parcial" : (mode === "edit" ? "Orçamento atualizado com sucesso." : "Orçamento criado com sucesso."),
          description: res.errorMessage || "Aguardando sua escolha..."
        });\`);
  console.log("Success: Toast");
} else {
  console.error("FAILED to find: Toast");
}

replaceSafe(
  \`              {activeFormTab === "produtos" && (
                <div className="space-y-6">
                  <FormSection\`,
  \`              {activeFormTab === "produtos" && (
                <fieldset disabled={hasActiveCobranca} className="group space-y-6">
                  <FormSection\`,
  "Produtos start"
);

replaceSafe(
  \`                  ) : null}
                </div>
              </>
            )}
          </FormSection>
        </div>
      )}\`,
  \`                  ) : null}
                </div>
              </>
            )}
          </FormSection>
        </fieldset>
      )}\`,
  "Produtos end"
);

replaceSafe(
  \`      {activeFormTab === "fretes" && (
        <div className="space-y-6">
          <FormSection\`,
  \`      {activeFormTab === "fretes" && (
        <fieldset disabled={hasActiveCobranca} className="group space-y-6">
          <FormSection\`,
  "Fretes start"
);

replaceSafe(
  \`                  ) : null}
                </div>
              </>
            )}
          </FormSection>
        </div>
      )}

      {activeFormTab === "pagamentos" && (\`,
  \`                  ) : null}
                </div>
              </>
            )}
          </FormSection>
        </fieldset>
      )}

      {activeFormTab === "pagamentos" && (\`,
  "Fretes end"
);

replaceSafe(
  \`      {activeFormTab === "pagamentos" && (
        <div className="space-y-6">
          {form.id_int === "NOVO" || !proposta ? (\`,
  \`      {activeFormTab === "pagamentos" && (
        <fieldset disabled={hasActiveCobranca} className="group space-y-6">
          {form.id_int === "NOVO" || !proposta ? (\`,
  "Pagamentos start"
);

replaceSafe(
  \`              onRefreshProposta={onReload}
            />
          )}
        </div>
      )}\`,
  \`              onRefreshProposta={onReload}
            />
          )}
        </fieldset>
      )}\`,
  "Pagamentos end"
);

replaceSafe(
  \`              <div className="mt-4">
                <div className="grid gap-3 grid-cols-[75px_1fr] items-start">
                  <Field label="Tipo">\`,
  \`              <fieldset disabled={hasActiveCobranca} className="group mt-4">
                <div className="grid gap-3 grid-cols-[75px_1fr] items-start">
                  <Field label="Tipo">\`,
  "Desconto start"
);

replaceSafe(
  \`                  </p>
                )}
              </div>
            </FormSection>\`,
  \`                  </p>
                )}
              </fieldset>
            </FormSection>\`,
  "Desconto end"
);

fs.writeFileSync(path, content, "utf-8");
console.log("Script executed.");
