const JSZip = require('jszip');
const pdfParse = require('pdf-parse');
const WordExtractor = require('word-extractor');

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

function stripTags(xml) {
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<\/w:p>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) out += decodeXml(m[1]);
    else if (m[0].startsWith('<w:tab')) out += '\t';
    else if (m[0].startsWith('<w:br')) out += '\n';
  }
  return out;
}

function attr(tag, name) {
  if (!tag) return null;
  const m = new RegExp(name + '="([^"]*)"').exec(tag);
  return m ? decodeXml(m[1]) : null;
}

function parseRuns(pXml) {
  const runs = [];
  const re = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
  let m;
  while ((m = re.exec(pXml))) {
    const inner = m[1];
    const rPr = (/<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(inner) || [])[1] || '';
    const text = stripTags(inner);
    const rFontsTag = (/<w:rFonts[^>]*\/>/.exec(rPr) || [])[0];
    runs.push({
      text,
      font: attr(rFontsTag, 'w:eastAsia') || attr(rFontsTag, 'w:ascii'),
      fontAscii: attr(rFontsTag, 'w:ascii'),
      fontEastAsia: attr(rFontsTag, 'w:eastAsia'),
      fontHAnsi: attr(rFontsTag, 'w:hAnsi'),
      fontCs: attr(rFontsTag, 'w:cs'),
      sizeHalf: Number(attr((/<w:sz[^>]*\/>/.exec(rPr) || [])[0], 'w:val')) || null,
      bold: /<w:b\s*\/>|<w:b\s+w:val="(?:1|true|on)"/.test(rPr),
      raw: rPr,
    });
  }
  return runs;
}

function parseParagraphs(documentXml) {
  const blocks = [];
  const re = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
  let m;
  while ((m = re.exec(documentXml))) {
    const pXml = m[1];
    const pPr = (/<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(pXml) || [])[1] || '';
    const text = stripTags(pXml).replace(/\u0000/g, '');
    const runs = parseRuns(pXml);
    const drawingIds = [];
    const dRe = /r:embed="([^"]+)"/g;
    let d;
    while ((d = dRe.exec(pXml))) drawingIds.push(d[1]);
    blocks.push({
      text,
      raw: pXml,
      pPr,
      styleId: attr((/<w:pStyle[^>]*\/>/.exec(pPr) || [])[0], 'w:val'),
      align: attr((/<w:jc[^>]*\/>/.exec(pPr) || [])[0], 'w:val'),
      firstLineChars: Number(attr((/<w:ind[^>]*\/>/.exec(pPr) || [])[0], 'w:firstLineChars')),
      firstLineTwips: Number(attr((/<w:ind[^>]*\/>/.exec(pPr) || [])[0], 'w:firstLine')),
      line: Number(attr((/<w:spacing[^>]*\/>/.exec(pPr) || [])[0], 'w:line')),
      lineRule: attr((/<w:spacing[^>]*\/>/.exec(pPr) || [])[0], 'w:lineRule'),
      runs,
      images: drawingIds,
      kind: 'para',
    });
  }
  return blocks;
}

function imageSize(buf) {
  try {
    if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xc3) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
  } catch (e) { /* ignore */ }
  return { width: 800, height: 600 };
}

async function extractDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml').async('string');
  const blocks = parseParagraphs(documentXml);
  let media = {};
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (relsFile) {
    const relsXml = await relsFile.async('string');
    const re = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g;
    let m;
    while ((m = re.exec(relsXml))) {
      const target = m[2];
      if (/media\//i.test(target)) {
        media[m[1]] = target.replace(/^\/?word\//, '').replace(/^\.\.\//, '');
      }
    }
  }
  for (const b of blocks) {
    b.images = [];
    b.images = [];
    const ids = [];
    const rr = /r:embed="([^"]+)"/g;
    let mm;
    while ((mm = rr.exec(b.raw))) ids.push(mm[1]);
    for (const id of ids) {
      const rel = media[id];
      if (!rel) continue;
      const file = zip.file('word/' + rel) || zip.file(rel);
      if (!file) continue;
      const data = await file.async('nodebuffer');
      const dim = imageSize(data);
      b.images.push({ buffer: data, width: dim.width, height: dim.height, ext: (rel.split('.').pop() || 'png').toLowerCase() });
    }
  }
  let page = null;
  const sect = /<w:sectPr[\s\S]*?<\/w:sectPr>/.exec(documentXml);
  if (sect) {
    page = {};
    const pgsz = (/<w:pgSz[^>]*\/>/.exec(sect[0]) || [])[0];
    const pgmar = (/<w:pgMar[^>]*\/>/.exec(sect[0]) || [])[0];
    if (pgsz) { page.w = Number(attr(pgsz, 'w:w')); page.h = Number(attr(pgsz, 'w:h')); }
    if (pgmar) {
      page.marginTop = Number(attr(pgmar, 'w:top'));
      page.marginRight = Number(attr(pgmar, 'w:right'));
      page.marginBottom = Number(attr(pgmar, 'w:bottom'));
      page.marginLeft = Number(attr(pgmar, 'w:left'));
    }
  }
  return { type: 'docx', blocks, page, text: blocks.map(b => b.text).join('\n') };
}

async function extractPdf(buffer) {
  const data = await pdfParse(buffer);
  const lines = data.text.replace(/\r/g, '').split('\n');
  const blocks = lines.map(line => ({ text: line, kind: 'para', runs: [], images: [] }));
  return { type: 'pdf', blocks, text: data.text };
}

async function extractDoc(buffer) {
  const extractor = new WordExtractor();
  const doc = await extractor.extract(buffer);
  const text = doc.getBody();
  const blocks = text.replace(/\r/g, '').split('\n').map(line => ({ text: line, kind: 'para', runs: [], images: [] }));
  return { type: 'doc', blocks, text };
}

async function extractTextBuffer(buffer, filename) {
  const name = (filename || '').toLowerCase();
  if (name.endsWith('.docx')) return extractDocx(buffer);
  if (name.endsWith('.pdf')) return extractPdf(buffer);
  if (name.endsWith('.doc')) return extractDoc(buffer);
  const text = Buffer.from(buffer).toString('utf8');
  return { type: 'text', text, blocks: text.replace(/\r/g, '').split('\n').map(l => ({ text: l, kind: 'para', runs: [], images: [] })) };
}

module.exports = { extractTextBuffer, extractDocx, extractPdf, extractDoc, decodeXml };
