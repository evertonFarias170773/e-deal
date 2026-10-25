import { deflateRawSync } from "node:zlib";

/**
 * Gerador de ZIP mínimo (formato "deflate", sem criptografia, sem ZIP64), só com o que o Node
 * já traz — o projeto não tem biblioteca de zip e este relatório não justifica instalar uma.
 * Serve para arquivos pequenos (XML de nota): até 65.535 arquivos de até 4 GB cada.
 *
 * Nomes em UTF-8 (bit 11 do cabeçalho), data e hora do DOS gravadas como o momento da geração.
 */

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(dados: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i++) c = TABELA_CRC[(c ^ dados[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dataHoraDos(momento: Date) {
  const hora = (momento.getHours() << 11) | (momento.getMinutes() << 5) | (momento.getSeconds() >> 1);
  const data = ((momento.getFullYear() - 1980) << 9) | ((momento.getMonth() + 1) << 5) | momento.getDate();
  return { hora: hora & 0xffff, data: data & 0xffff };
}

export function montarZip(
  arquivos: { nome: string; conteudo: Uint8Array }[],
  momento: Date = new Date()
): Buffer {
  const { hora, data } = dataHoraDos(momento);
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let deslocamento = 0;

  for (const arquivo of arquivos) {
    const nome = Buffer.from(arquivo.nome, "utf8");
    const bruto = Buffer.from(arquivo.conteudo);
    const comprimido = deflateRawSync(bruto);
    const crc = crc32(bruto);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(0x0800, 6); // nome em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(data, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(bruto.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    partes.push(local, nome, comprimido);

    const entrada = Buffer.alloc(46);
    entrada.writeUInt32LE(0x02014b50, 0);
    entrada.writeUInt16LE(20, 4); // versão que criou
    entrada.writeUInt16LE(20, 6); // versão necessária
    entrada.writeUInt16LE(0x0800, 8);
    entrada.writeUInt16LE(8, 10);
    entrada.writeUInt16LE(hora, 12);
    entrada.writeUInt16LE(data, 14);
    entrada.writeUInt32LE(crc, 16);
    entrada.writeUInt32LE(comprimido.length, 20);
    entrada.writeUInt32LE(bruto.length, 24);
    entrada.writeUInt16LE(nome.length, 28);
    entrada.writeUInt16LE(0, 30); // extra
    entrada.writeUInt16LE(0, 32); // comentário
    entrada.writeUInt16LE(0, 34); // disco
    entrada.writeUInt16LE(0, 36); // atributos internos
    entrada.writeUInt32LE(0, 38); // atributos externos
    entrada.writeUInt32LE(deslocamento, 42);
    central.push(entrada, nome);

    deslocamento += local.length + nome.length + comprimido.length;
  }

  const diretorio = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(0, 4);
  fim.writeUInt16LE(0, 6);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  fim.writeUInt16LE(0, 20);

  return Buffer.concat([...partes, diretorio, fim]);
}
