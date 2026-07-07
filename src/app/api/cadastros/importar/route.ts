import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const MIN_TEXT_CHARS = 50;
const MAX_TEXT_CHARS = 10000;
const DEFAULT_MODEL = "gpt-4o-mini";
const REQUEST_TIMEOUT_MS = 15000;

export async function POST(req: NextRequest) {
  // 1. Validar chave OpenAI
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Serviço de importação por IA temporariamente indisponível (Chave de API ausente no servidor)." },
      { status: 500 }
    );
  }

  // 2. Ler payload
  let body: { rawText?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Dados da requisição inválidos." }, { status: 400 });
  }

  const rawText = typeof body.rawText === "string" ? body.rawText : "";

  // 3. Validar texto
  if (!rawText || rawText.trim().length < MIN_TEXT_CHARS) {
    return NextResponse.json(
      { error: `O texto colado é muito curto. Por favor, cole o bloco de texto completo do sistema antigo (mínimo ${MIN_TEXT_CHARS} caracteres).` },
      { status: 400 }
    );
  }

  if (rawText.length > MAX_TEXT_CHARS) {
    return NextResponse.json(
      { error: `O texto colado excede o limite máximo permitido de ${MAX_TEXT_CHARS} caracteres.` },
      { status: 400 }
    );
  }

  // 4. Prompt para extração estruturada
  const systemPrompt = `Você é um agente de cadastro do ERP Ideal. Receberá um texto bruto copiado de um sistema antigo e deve extrair dados cadastrais para JSON.

Regras de Mapeamento e Limpeza:
- Nunca invente dados.
- Se algum campo não existir no texto bruto, retorne string vazia.
- O campo "documento" (CPF/CNPJ) deve conter apenas números.
- Telefones e WhatsApps devem conter apenas números.
- Estado/UF deve retornar a sigla de 2 letras (ex: "Rio Grande do Sul" -> "RS", "Santa Catarina" -> "SC").
- Extraia o ID do cliente ("id_cliente") quando houver um trecho como "Cliente 8469" ou "Código 8469". Deve ser um número limpo (ex: "8469").
- Para CNPJ, use tipo_pessoa = "CNPJ". Para CPF, use tipo_pessoa = "CPF".
- Extraia o nome do atendente/vendedor no campo "nome_vendedor".
- Endereço, número, complemento, bairro, cidade, CEP (apenas números) e UF devem preencher o objeto "endereco".
- Se houver uma senha explícita (ex: "Senha: 123123"), extraia-a no campo "senha_importada".
- Razão Social deve preencher cliente.nome.
- Nome fantasia deve preencher cliente.fantasia.
- Apelido deve preencher cliente.apelido.
- E-mail deve preencher cliente.email e cliente.email_contato.
- Telefone 1 deve preencher cliente.telefone_fixo.
- WhatsApp deve preencher cliente.whatsapp_1. Se não houver campo de WhatsApp mas houver Telefone 1 ou Telefone 2 que pareça celular, sugira-o em cliente.whatsapp_1 e adicione uma nota no array "avisos".
- Datas de cadastro ou atualização devem ir para o objeto metadados.
- Retorne apenas e exclusivamente um objeto JSON válido no formato obrigatório a seguir, sem blocos de código markdown ou texto solto.

Formato de Saída Obrigatório:
{
  "cliente": {
    "id_cliente": "",
    "tipo_pessoa": "",
    "documento": "",
    "nome": "",
    "fantasia": "",
    "apelido": "",
    "contato": "",
    "ins_estadual": "",
    "ins_municipal": "",
    "email": "",
    "email_contato": "",
    "telefone_fixo": "",
    "whatsapp_1": "",
    "whatsapp_2": "",
    "senha_importada": "",
    "nome_vendedor": "",
    "site": "",
    "obs": ""
  },
  "endereco": {
    "cep": "",
    "endereco": "",
    "numero": "",
    "complemento": "",
    "bairro": "",
    "cidade": "",
    "uf": "",
    "tipo_endereco": "ENTREGA"
  },
  "contatos": [
    {
      "nome_contato": "",
      "cargo": "",
      "whats": "",
      "e_mail": ""
    }
  ],
  "metadados": {
    "origem": "sistema_antigo",
    "data_cadastro_origem": "",
    "data_atualizacao_origem": ""
  },
  "avisos": []
}`;

  const openai = new OpenAI({ apiKey });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const model = process.env.MAESTRO_OPENAI_MODEL || DEFAULT_MODEL;

    const completion = await openai.chat.completions.create(
      {
        model,
        temperature: 0.1,
        max_tokens: 1500,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: rawText }
        ],
        response_format: { type: "json_object" }
      },
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    const jsonText = completion.choices[0]?.message?.content ?? "";
    if (!jsonText) {
      return NextResponse.json(
        { error: "A inteligência artificial retornou uma resposta vazia. Revise o texto colado." },
        { status: 500 }
      );
    }

    const parsedData = JSON.parse(jsonText);

    if (parsedData.erro) {
      return NextResponse.json({ error: parsedData.erro }, { status: 400 });
    }

    return NextResponse.json(parsedData);
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    const isTimeout = err instanceof Error && err.name === "AbortError";
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    console.error(`[Cadastro Import] ${isTimeout ? "Timeout" : "Erro"}: ${message}`);

    return NextResponse.json(
      {
        error: isTimeout
          ? "O serviço de inteligência artificial demorou muito para responder. Por favor, tente novamente com um texto menor."
          : "Ocorreu um erro ao processar o texto com a inteligência artificial. Verifique se o texto colado é válido."
      },
      { status: 500 }
    );
  }
}
