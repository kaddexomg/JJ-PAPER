import fs from 'node:fs';

const comp01 = 'M:/MIX11/comp01';
const files = [
  'MXENCPX1.NTX', 'MXENCPX2.NTX', 'MXENCPX3.NTX',
  'MXRECPX1.NTX', 'MXRECPX2.NTX', 'MXRECPX3.NTX',
  'MXENCZX1.NTX', 'MXENCZX2.NTX', 'MXENCZX3.NTX',
  'MXRECZX1.NTX', 'MXRECZX2.NTX',
  'MXENPEX1.NTX', 'MXENPEX2.NTX', 'MXENPEX3.NTX',
  'MXREPEX1.NTX', 'MXREPEX2.NTX'
];

for (const f of files) {
  const p = `${comp01}/${f}`;
  if (fs.existsSync(p)) {
    const buf = fs.readFileSync(p);
    const sig = buf.readUInt16LE(0);
    const ver = buf.readUInt16LE(2);
    const rootPage = buf.readUInt32LE(4);
    const itemSize = buf.readUInt16LE(12);
    const keyLen = buf.readUInt16LE(14);
    const keyDec = buf.readUInt16LE(16);
    const maxItem = buf.readUInt16LE(18);
    const minItem = buf.readUInt16LE(20);
    // Key expression is at offset 22 (null-terminated string, up to 256 bytes)
    let keyExpr = '';
    for (let i = 22; i < 256; i++) {
      if (buf[i] === 0) break;
      keyExpr += String.fromCharCode(buf[i]);
    }
    console.log(`${f}: sig=0x${sig.toString(16)}, keyLen=${keyLen}, maxItem=${maxItem}, keyExpr='${keyExpr}'`);
  }
}
