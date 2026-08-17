// Gestão da assinatura do WEBHOOK oficial dos Correios (serviço wh-rastro).
// Usa as credenciais do .env.local (CORREIOS_<empresa>_WEBHOOK como Bearer).
// NUNCA imprime segredos.
//
// Uso:
//   node scripts/correios-webhook.mjs --empresa 2 --acao listar
//   node scripts/correios-webhook.mjs --empresa 2 --acao assinar --url https://SEU-DOMINIO/api/correios/webhook [--email voce@dominio]
//   node scripts/correios-webhook.mjs --empresa 2 --acao testar --assinatura 123
//   node scripts/correios-webhook.mjs --empresa 2 --acao eventos --assinatura 123
//
// Ordem de ativação: publicar o app (receiver no ar) → assinar → testar.
// Pré-requisito CWS: o código de acesso precisa das APIs 78 (Webhook) e 534 (SRO Rastro).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://api.correios.com.br/webhook";
const SERVICO = "wh-rastro";

// Eventos assinados: gatilhos de status + informativos úteis (último evento).
const TIPO_EVENTOS = [
  // postagem/coleta → EM TRANSITO
  "PO-1", "PO-2", "PO-9", "CO-1", "CO-15", "CO-16", "CMT-0",
  // movimentação informativa (alimenta correios_ultimo_evento)
  "OEC-1", "OEC-3", "RO-1", "DO-1", "CAR-5",
  // entrega ao destinatário → ENTREGUE
  "BDE-1", "BDI-1", "BDR-1", "BDE-67", "BDI-67", "BDR-67",
  "BDE-68", "BDI-68", "BDR-68", "BDE-70", "BDI-70", "BDR-70",
  // problemas/devolução (informativo — status não muda sozinho)
  "BDE-5", "BDI-5", "BDR-5", "BDE-14", "BDI-14", "BDR-14",
  "BDE-22", "BDI-22", "BDR-22", "BDE-2", "BDI-2", "BDR-2"
];

function args() {
  const a = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z]+)$/.exec(argv[i]);
    if (m) { a[m[1]] = argv[i + 1]; i++; }
  }
  return a;
}

function lerEnv() {
  const env = {};
  for (const linha of readFileSync(join(RAIZ, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(linha.trim());
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

async function chamar(metodo, caminho, token, body) {
  const res = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const texto = await res.text();
  let corpo = texto;
  try { corpo = JSON.parse(texto); } catch { /* texto */ }
  return { status: res.status, corpo };
}

const { empresa, acao, url, assinatura, email } = args();
if (!empresa || !acao) {
  console.error("Uso: node scripts/correios-webhook.mjs --empresa <id> --acao listar|assinar|testar|eventos [--url ...] [--assinatura id] [--email ...]");
  process.exit(1);
}

const env = lerEnv();
const token = env[`CORREIOS_${empresa}_WEBHOOK`] || env.CORREIOS_WEBHOOK_TOKEN || "";
const contrato = env[`CORREIOS_${empresa}_CONTRATO`] || "";
const secret = env.CORREIOS_WEBHOOK_SECRET || "";
if (!token) { console.error(`CORREIOS_${empresa}_WEBHOOK ausente no .env.local`); process.exit(1); }

if (acao === "listar") {
  const r = await chamar("GET", `/v1/servicos/${SERVICO}/assinaturas`, token);
  console.log(`HTTP ${r.status}`);
  console.log(JSON.stringify(r.corpo, null, 2));
} else if (acao === "assinar") {
  if (!url) { console.error("--url obrigatória (ex.: https://SEU-DOMINIO/api/correios/webhook)"); process.exit(1); }
  if (!secret) { console.error("CORREIOS_WEBHOOK_SECRET ausente no .env.local"); process.exit(1); }
  const payload = {
    descricao: `Vibe ERP - empresa ${empresa}`,
    email: email || "everton.prd@gmail.com",
    language: "PT",
    enderecos: [
      {
        nome: `vibe-erp-${empresa}`,
        url,
        secret,
        tipoEventos: TIPO_EVENTOS.map((tipo) => ({ tipo }))
      }
    ]
  };
  const r = await chamar("POST", `/v1/servicos/${SERVICO}/assinaturas`, token, payload);
  console.log(`Assinatura → HTTP ${r.status}`);
  console.log(JSON.stringify(r.corpo, null, 2));
  const id = r.corpo?.id;
  if (id && contrato) {
    const rc = await chamar("POST", `/v1/servicos/${SERVICO}/assinaturas/${id}/contratos`, token, { numero: contrato });
    console.log(`Vínculo do contrato ${contrato.replace(/.(?=.{3})/g, "*")} → HTTP ${rc.status}`);
    console.log(JSON.stringify(rc.corpo, null, 2));
  } else if (id) {
    console.log("AVISO: CORREIOS_<empresa>_CONTRATO ausente — vincule o contrato depois (POST .../contratos).");
  }
} else if (acao === "testar") {
  if (!assinatura) { console.error("--assinatura obrigatória"); process.exit(1); }
  const r = await chamar("POST", `/v1/servicos/${SERVICO}/assinaturas/${assinatura}/teste`, token);
  console.log(`Teste → HTTP ${r.status}`);
  console.log(JSON.stringify(r.corpo, null, 2));
} else if (acao === "eventos") {
  if (!assinatura) { console.error("--assinatura obrigatória"); process.exit(1); }
  const r = await chamar("GET", `/v1/servicos/${SERVICO}/assinaturas/${assinatura}/eventos`, token);
  console.log(`Eventos → HTTP ${r.status}`);
  console.log(JSON.stringify(r.corpo, null, 2).slice(0, 4000));
} else {
  console.error(`Ação desconhecida: ${acao}`);
  process.exit(1);
}
