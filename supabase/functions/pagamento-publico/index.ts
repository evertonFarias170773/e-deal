import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

if (!["GET", "POST"].includes(req.method)) {
  return new Response("Método não permitido", { status: 405 });
}

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const isJson = url.searchParams.get("json");

  if (!token) {
    return new Response("Token inválido", { status: 400 });
  }

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

if (req.method === "POST") {
  const body = await req.json();

  const parcelas = Number(body.parcelas);
  const taxa = Number(body.taxa);

  if (!token || !parcelas || taxa < 0) {
    return new Response(
      JSON.stringify({ erro: "Dados inválidos" }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }

  const { data: pagamentoAtual, error: erroBusca } = await supabase
    .from("pagamentos_v2")
    .select("id, valor, tipo_cobranca, status")
    .eq("token_publico", token)
    .maybeSingle();

  if (erroBusca || !pagamentoAtual) {
    return new Response(
      JSON.stringify({ erro: "Pagamento não encontrado" }),
      {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }

  if (pagamentoAtual.tipo_cobranca !== "CARD_PARCELADO") {
    return new Response(
      JSON.stringify({ erro: "Pagamento não é de cartão parcelado" }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }

  if (pagamentoAtual.status === "PAID") {
    return new Response(
      JSON.stringify({ erro: "Pagamento já confirmado" }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }

const valorBase = Number(pagamentoAtual.valor);

// Taxa embutida: calcula o valor bruto necessário para receber o valor base
const valorFinal = taxa > 0
  ? Number((valorBase / (1 - taxa / 100)).toFixed(2))
  : Number(valorBase.toFixed(2));

const valorTaxa = Number((valorFinal - valorBase).toFixed(2));

  const { data: atualizado, error: erroUpdate } = await supabase
    .from("pagamentos_v2")
    .update({
      cartao_parcelas: parcelas,
      cartao_taxa_percentual: taxa,
      cartao_valor_taxa: valorTaxa,
      cartao_valor_final: valorFinal,
      cartao_status: "PARCELA_ESCOLHIDA",
    })
    .eq("token_publico", token)
    .select(`
      id,
      valor,
      cartao_parcelas,
      cartao_taxa_percentual,
      cartao_valor_taxa,
      cartao_valor_final,
      cartao_status
    `)
    .single();

  if (erroUpdate) {
    return new Response(
      JSON.stringify({ erro: erroUpdate.message }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }

  return new Response(
    JSON.stringify(atualizado),
    {
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    }
  );
}

const { data: pagamento, error } = await supabase
  .from("pagamentos_v2")
  .select(`
    id_pagamento,
    id_empresa,
    valor,
    cliente,
    descricao,
    vencimento,
    status,
    paid_at,
    tipo_cobranca,
    pix_copia_cola
  `)
  .eq("token_publico", token)
  .maybeSingle();

  if (error || !pagamento) {
    return new Response("Pagamento não encontrado", { status: 404 });
  }

  // Retorno JSON para polling
  if (isJson) {
    return new Response(
      JSON.stringify({
        status: pagamento.status,
        paid_at: pagamento.paid_at,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }

  // Empresa
  let empresaNome = "";
  let empresaLogo = "";

  if (pagamento.id_empresa) {
    const { data: empresa } = await supabase
      .from("empresas")
      .select("empresa, cnpj, logotipo")
      .eq("id", pagamento.id_empresa)
      .maybeSingle();

    if (empresa) {
      empresaNome = `${empresa.empresa ?? ""} - CNPJ: ${empresa.cnpj ?? ""}`;
      empresaLogo = empresa.logotipo ?? "";
    }
  }

const isPaid = pagamento.status === "PAID";
const isCardParcelado = pagamento.tipo_cobranca === "CARD_PARCELADO";

const idEmpresa = Number(pagamento.id_empresa || 0);

const webhookPorEmpresa: Record<number, string> = {
  1: "https://10074.hostoo.net.br/webhook/card-ideal-c6",
  3: "https://10074.hostoo.net.br/webhook/card-e3-c6",
};

const n8nWebhookUrl = webhookPorEmpresa[idEmpresa] || "";

if (isCardParcelado && !n8nWebhookUrl) {
  return new Response("Webhook da empresa não configurado.", { status: 400 });
}


  const valorFormatado = Number(pagamento.valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const valorBase = Number(pagamento.valor);

function calcularOpcaoParcela(parcelas: number, taxa: number) {
  // Taxa embutida: calcula o valor bruto necessário para receber o valor base
  const valorFinal = taxa > 0
    ? valorBase / (1 - taxa / 100)
    : valorBase;

  const valorParcela = valorFinal / parcelas;

  return {
    parcelas,
    taxa,
    valorFinal,
    valorParcela,
    temJuros: taxa > 0,
    valorFinalFormatado: valorFinal.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    }),
    valorParcelaFormatado: valorParcela.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    }),
  };
}

const opcoesParcelamento = [
  calcularOpcaoParcela(1, 0),
  calcularOpcaoParcela(2, 4.3),
  calcularOpcaoParcela(3, 5.8),
  calcularOpcaoParcela(4, 7.2),
  calcularOpcaoParcela(5, 8.7),
  calcularOpcaoParcela(6, 10.5),
  

];

  const fundo = isPaid
    ? "linear-gradient(135deg,#0f5132,#198754)"
    : "linear-gradient(135deg,#140B70,#249689)";

  const statusTexto = isPaid
    ? "Pagamento confirmado"
    : "Aguardando pagamento";

  const statusCor = isPaid ? "#198754" : "#ff8c00";

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${isCardParcelado ? "Pagamento via Cartão" : "Pagamento PIX"}</title>

<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">

<style>
* { box-sizing: border-box; }

body {
  margin:0;
  font-family:'Inter', sans-serif;
  background:${fundo};
  min-height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:20px;
  transition: background 0.6s ease;
}

.card {
  background:rgba(255,255,255,0.98);
  width:100%;
  max-width:460px;
  padding:40px;
  border-radius:24px;
  text-align:center;
  box-shadow:0 25px 60px rgba(0,0,0,0.25);
}

.logo { max-width:160px; margin-bottom:20px; }

.valor {
  font-size:38px;
  font-weight:700;
  margin:12px 0;
}

.badge {
  display:inline-block;
  padding:6px 14px;
  border-radius:999px;
  font-size:13px;
  font-weight:600;
  margin-top:10px;
  background:${isPaid ? "#e6f4ea" : "#fff4e5"};
  color:${statusCor};
}

.info {
  margin-top:18px;
  font-size:14px;
  color:#555;
  line-height:1.6;
}

.qr-box {
  margin-top:25px;
  padding:22px;
  border-radius:18px;
  background:#f8f9fa;
  text-align:center;
}

.status-pago {
  font-size:22px;
  font-weight:700;
  color:#0f5132;
  margin-bottom:6px;
}

.data-pago {
  font-size:14px;
  color:#0f5132;
  opacity:0.8;
}

button {
  margin-top:22px;
  padding:15px;
  border:none;
  border-radius:14px;
  background:linear-gradient(135deg,#1a237e,#3949ab);
  color:white;
  font-weight:600;
  cursor:pointer;
  width:100%;
  font-size:15px;
}

.footer {
  margin-top:30px;
  font-size:12px;
  color:#777;
  border-top:1px solid #eee;
  padding-top:18px;
}
</style>
</head>

<body>
<div class="card">

${empresaLogo ? `<img src="${empresaLogo}" class="logo" />` : ""}

<div style="font-size:18px;font-weight:600;color:#444;">
${isCardParcelado ? "Pagamento via Cartão" : "Pagamento via PIX"}
</div>

<div class="valor">${valorFormatado}</div>

<div class="badge" id="badge">${statusTexto}</div>

<div class="info">
<strong>Proposta:</strong> ${pagamento.id_pagamento}<br/>
<strong>Cliente:</strong> ${pagamento.cliente}<br/>
<strong>Validade:</strong> ${new Date(pagamento.vencimento).toLocaleDateString("pt-BR")}
</div>

${pagamento.descricao ? `
<div style="margin-top:18px;font-size:14px;color:#555;line-height:1.6;">
  <strong>Descrição:</strong><br/>
  ${pagamento.descricao}
</div>
` : ""}

<div id="areaPagamento">
${
  isPaid
    ? `
<div class="qr-box" style="background:#e6f4ea;">
  <div class="status-pago">Pagamento confirmado</div>
  <div class="data-pago">
${
  pagamento.paid_at
    ? new Date(pagamento.paid_at).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo"
      })
    : ""
}
  </div>
</div>
`
    : isCardParcelado
    ? `
<div class="qr-box" style="text-align:left;">
  <div style="font-size:18px;font-weight:700;color:#333;margin-bottom:10px;text-align:center;">
    Escolha opção de parcela
  </div>

<select id="selectParcelamento" style="
  width:100%;
  margin-top:18px;
  padding:15px;
  border-radius:14px;
  border:1px solid #ddd;
  background:white;
  color:#222;
  font-size:16px;
  font-weight:700;
  outline:none;
">
  ${opcoesParcelamento.map((opcao) => `

<option value="${opcao.parcelas}|${opcao.taxa}">
  ${opcao.parcelas}x ${opcao.valorParcelaFormatado} — ${opcao.temJuros ? "Com juros" : "Sem juros"}
</option>
  `).join("")}
</select>

<button onclick="confirmarParcelamentoSelecionado()" style="margin-top:16px;">
  Escolher parcelamento
</button>

</div>
`
    : `
<div class="qr-box">
<img src="https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(
        pagamento.pix_copia_cola
      )}" style="width:100%;border-radius:12px;" />
</div>
<button onclick="copiar()">Copiar código PIX</button>
`
}
</div>

<div class="footer">
<strong>${empresaNome}</strong><br/>
Telefone: (51) 3093-2840
</div>

</div>

<script>

const N8N_WEBHOOK_URL = ${JSON.stringify(n8nWebhookUrl)};

function copiar() {
  navigator.clipboard.writeText("${pagamento.pix_copia_cola || ""}");
  alert("Código PIX copiado!");
  }

async function selecionarParcela(parcelas, taxa) {
  console.log("Clique detectado:", parcelas, taxa);

  try {
    const urlPost = window.location.origin + window.location.pathname + window.location.search;

    const response = await fetch(urlPost, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        parcelas: parcelas,
        taxa: taxa
      })
    });

    const data = await response.json();

    console.log("Resposta POST:", data);

    if (!response.ok) {
      alert(data.erro || "Erro ao selecionar parcelamento");
      return;
    }

    const valorFinal = Number(data.cartao_valor_final).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });

    document.getElementById("areaPagamento").innerHTML =
      '<div class="qr-box" style="text-align:center;">' +
        '<div style="font-size:18px;font-weight:700;color:#333;margin-bottom:10px;">' +
          'Parcelamento escolhido' +
        '</div>' +
        '<div style="font-size:16px;color:#555;margin-bottom:8px;">' +
          data.cartao_parcelas + 'x no cartão' +
        '</div>' +
        '<div style="font-size:28px;font-weight:700;color:#111;margin-bottom:8px;">' +
          valorFinal +
        '</div>' +
        '<div style="font-size:13px;color:#777;margin-bottom:18px;">' +
          'Valor final com taxa incluída' +
        '</div>' +
        '<button onclick="continuarPagamento()">' +
          'Continuar para pagamento' +
        '</button>' +
        '<button onclick="window.location.reload()" style="background:#6c757d;margin-top:10px;">' +
          'Escolher outra parcela' +
        '</button>' +
      '</div>';

  } catch (e) {
    console.log("Erro no selecionarParcela:", e);
    alert("Erro ao salvar parcelamento");
  }
}

async function continuarPagamento() {
  // Trava contra clique repetido: a criação do checkout leva cerca de 1 segundo,
  // e um segundo clique nesse intervalo criava outro checkout para a mesma cobrança.
  if (continuarPagamento.emAndamento) return;
  continuarPagamento.emAndamento = true;

  const botao = document.querySelector('button[onclick="continuarPagamento()"]');
  const textoDoBotao = botao ? botao.innerText : "";
  if (botao) {
    botao.disabled = true;
    botao.innerText = "Abrindo pagamento...";
  }

  // Na falha, na hora. No sucesso a página é redirecionada, e o botão só é
  // liberado depois, para o caso de o cliente voltar do checkout.
  function liberarBotao() {
    continuarPagamento.emAndamento = false;
    if (botao) {
      botao.disabled = false;
      botao.innerText = textoDoBotao;
    }
  }

  console.log("Botão Continuar clicado");

  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        token_publico: "${token}"
      })
    });

    console.log("Status webhook:", response.status);

    const texto = await response.text();
    console.log("Resposta bruta webhook:", texto);

    let data = {};
    try {
      data = JSON.parse(texto);
    } catch (e) {
      console.log("Resposta do webhook não é JSON");
    }

    if (!response.ok) {
      liberarBotao();
      alert(data.erro || data.message || "Erro ao criar checkout no C6. Status: " + response.status);
      return;
    }

const checkoutUrl = data.checkout_url || data.url;

if (checkoutUrl) {
  // Se o cliente voltar do checkout pelo navegador, o botão não pode ficar travado.
  setTimeout(liberarBotao, 8000);
  window.location.href = checkoutUrl;
  return;
}

liberarBotao();
alert(data.mensagem || "Checkout criado, mas a URL não foi retornada.");

  } catch (e) {
    console.log("Erro ao chamar webhook n8n:", e);
    liberarBotao();
    alert("Erro ao chamar o n8n. Veja o Console do navegador.");
  }
}

async function verificarStatus() {
  try {
    const urlJson = window.location.origin + window.location.pathname + window.location.search + "&json=1";
    const response = await fetch(urlJson);
    const data = await response.json();

    if (data.status === "PAID") {
      atualizarParaPago(data.paid_at);
    }
  } catch (e) {
    console.log("Erro ao verificar status", e);
  }
}

function atualizarParaPago(paidAt) {
  document.getElementById("badge").innerText = "Pagamento confirmado";
  document.getElementById("badge").style.background = "#94F6B0";
  document.getElementById("badge").style.color = "#198754";

  document.body.style.background = "linear-gradient(135deg,#0f5132,#198754)";

  document.getElementById("areaPagamento").innerHTML =
    '<div class="qr-box" style="background:#e6f4ea;">' +
      '<div class="status-pago">Pagamento confirmado</div>' +
      '<div class="data-pago">' +
        (paidAt ? new Date(paidAt).toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo"
        }) : "") +
      '</div>' +
    '</div>';

  clearInterval(interval);
}

let interval = null;

if ("${pagamento.status}" !== "PAID") {
  interval = setInterval(verificarStatus, 5000);
}

function confirmarParcelamentoSelecionado() {
  const select = document.getElementById("selectParcelamento");

  if (!select || !select.value) {
    alert("Selecione uma opção de parcelamento.");
    return;
  }

  const [parcelas, taxa] = select.value.split("|");

  selecionarParcela(Number(parcelas), Number(taxa));
}

</script>

</body>
</html>

`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html",
      ...corsHeaders,
    },
  });
});
