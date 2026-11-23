/**
 * Telefone da conversa principal do pedido para o cartão (23/11/2026).
 *
 * CÓPIA de `telefoneParaApi` de `src/lib/telefone/telefone-br.ts` (a Edge não
 * importa do src). Mudou lá, muda aqui: o teste
 * `scripts/testes/cartao-telefone-conversa.test.mts` compara as duas.
 *
 * Regra (decidida em 17/11/2026): o telefone mandado aos bancos sai da conversa
 * principal do pedido (`propostas_contatos_chatguru`), como o ChatGuru guarda:
 *   - DDI 55 sai quando sobra um número nacional (10 ou 11 dígitos);
 *   - celular de 8 dígitos (começa de 6 a 9) ganha o 9 depois do DDD;
 *   - fixo (8 dígitos começando de 2 a 5) fica como está;
 *   - celular que já tem o 9 fica como está;
 *   - número de fora do Brasil e DDD que não existe no Brasil saem vazios.
 * Quem decide se o número serve para o cartão (só celular de 11 dígitos com o 9)
 * é o nó "Normaliza" do n8n.
 *
 * Sem dependência de Deno: roda em teste no Node.
 */

const DDDS_DO_BRASIL = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99
]);

function soDigitos(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "");
}

function numeroEstrangeiro(valor: unknown): string | null {
  const n = typeof valor === "string" || typeof valor === "number" ? soDigitos(valor) : "";
  if (!/^[1-9]\d{10,12}$/.test(n) || n.startsWith("55")) return null;
  if (n.length === 11 && DDDS_DO_BRASIL.has(Number(n.slice(0, 2)))) return null;
  return n;
}

function nacionalComDddDoBrasil(valor: unknown): string | null {
  let digitos = soDigitos(valor);
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) digitos = digitos.slice(2);
  if (digitos.length !== 10 && digitos.length !== 11) return null;
  return DDDS_DO_BRASIL.has(Number(digitos.slice(0, 2))) ? digitos : null;
}

export function telefoneParaApi(valor: unknown): string {
  if (numeroEstrangeiro(valor)) return "";
  const digitos = nacionalComDddDoBrasil(valor);
  if (!digitos) return "";
  const numero = digitos.slice(2);
  if (numero.length === 9) return numero[0] === "9" ? digitos : "";
  if (numero[0] >= "6" && numero[0] <= "9") return `${digitos.slice(0, 2)}9${numero}`;
  if (numero[0] >= "2" && numero[0] <= "5") return digitos;
  return "";
}
