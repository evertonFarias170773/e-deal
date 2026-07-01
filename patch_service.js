import fs from "fs";

const path = "src/features/orcamentos/services/orcamentos.service.ts";
let content = fs.readFileSync(path, "utf-8");

const newLogic = `
  let hasActiveCharge = false;

  if (isUpdate && id_int) {
    // Revalidação de segurança no service antes de salvar
    const { data: billings, error: billingsError } = await client
      .from("pagamentos_v2")
      .select("id, status")
      .eq("id_int", id_int);

    if (billingsError) {
      console.error("Erro ao verificar cobranças antes de salvar proposta:", billingsError);
    } else if (billings && billings.length > 0) {
      hasActiveCharge = billings.some(b => b.status !== "CANCELADO" && b.status !== "CANCELADA" && b.status !== "EXTORNADO" && b.status !== "RECUSADO");
      
      if (hasActiveCharge) {
        // Salvamento Parcial Seguro
        const { error: partialUpdateError } = await client
          .from("propostas")
          .update({
            obs_proposta: formState.observacoes
          })
          .eq("id_int", id_int);

        if (partialUpdateError) {
          return {
            success: false,
            errorMessage: "Erro ao salvar observações da proposta: " + partialUpdateError.message
          };
        }

        return {
          success: true,
          id_int: id_int,
          errorMessage: "Campos operacionais salvos. Produtos, valores, descontos e frete permanecem bloqueados porque existe cobrança gerada."
        };
      }
    }
  }
`;

content = content.replace(
  /if \(isUpdate && id_int\) \{[\s\S]*?errorMessage: "Esta proposta possui cobrança gerada\. Para alterar, exclua primeiro a cobrança pendente\."[\s\S]*?\}\s*\}/,
  newLogic.trim()
);

fs.writeFileSync(path, content, "utf-8");
console.log("orcamentos.service.ts atualizado com sucesso!");
