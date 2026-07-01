const fs = require('fs');

const content = fs.readFileSync('./src/lib/mocks/pagamentos.mock.ts', 'utf8');

const regex = /{[\s\S]*?vencimento:\s*(["'])(.+?)\1[\s\S]*?valor:\s*([\d.]+)(?:[\s\S]*?valor_atualizado:\s*([\d.]+))?[\s\S]*?}/g;

const items = [];
let match;
while ((match = regex.exec(content)) !== null) {
  const vencimento = match[2];
  const valor = parseFloat(match[3]);
  const valor_atualizado = match[4] ? parseFloat(match[4]) : undefined;
  
  items.push({ vencimento, valor, valor_atualizado });
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00-03:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function getFirstDayOfMonth(dateStr, addMonths) {
  const d = new Date(dateStr + 'T00:00:00-03:00');
  d.setMonth(d.getMonth() + addMonths);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}
function getLastDayOfMonth(dateStr, addMonths) {
  const d = new Date(dateStr + 'T00:00:00-03:00');
  d.setMonth(d.getMonth() + addMonths + 1);
  d.setDate(0);
  return d.toISOString().slice(0, 10);
}

const today = '2026-07-01';
const ranges = [
  { label: 'Semana atual', start: today, end: addDays(today, 6) },
  { label: 'Quinzena', start: today, end: addDays(today, 13) },
  { label: 'Próximos 30 dias', start: getFirstDayOfMonth(today, 1), end: getLastDayOfMonth(today, 1) },
  { label: 'Próximos 90 dias', start: getFirstDayOfMonth(today, 1), end: getLastDayOfMonth(today, 3) },
];

ranges.forEach(r => {
  const total = items
    .filter(item => {
      const d = item.vencimento.slice(0, 10);
      return d >= r.start && d <= r.end;
    })
    .reduce((sum, item) => sum + (item.valor_atualizado ?? item.valor), 0);
  console.log(r.label + ': ' + new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(total));
});
