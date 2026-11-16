const JSZip = require('jszip');

const STYLE_ID = { title: 'ReportTitle', heading: 'SectionHeading', body: 'BodyText', code: 'CodeBlock' };

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function halfPt(pt) { return Math.round(pt * 2); }
function lineVal(mult) { return Math.round(mult * 240); }

function rPr(role, style) {
  const b = style.bold ? '<w:b/><w:bCs/>' : '';
  const s = halfPt(style.sizePt);
  return `<w:rPr><w:rFonts w:ascii="${esc(style.font)}" w:eastAsia="${esc(style.font)}" w:hAnsi="${esc(style.font)}" w:cs="${esc(style.font)}"/>${b}<w:sz w:val="${s}"/><w:szCs w:val="${s}"/></w:rPr>`;
}

function pPr(role, style) {
  let xml = `<w:pPr><w:pStyle w:val="${STYLE_ID[role]}"/>`;
  if (style.align === 'center') xml += '<w:jc w:val="center"/>';
  else if (style.align === 'right') xml += '<w:jc w:val="right"/>';
  else if (style.align === 'both') xml += '<w:jc w:val="both"/>';
  else xml += '<w:jc w:val="left"/>';
  const lv = style.lineExactPt ? style.lineExactPt : lineVal(style.lineSpacing || 1.5);
  if (style.lineExactPt) xml += `<w:spacing w:line="${lineVal(style.lineSpacing || 1.5)}" w:lineRule="auto"/>`;
  else xml += `<w:spacing w:line="${lv}" w:lineRule="auto"/>`;
  if (role === 'body' && style.firstLineChars > 0) {
    xml += `<w:ind w:firstLineChars="${Math.round(style.firstLineChars * 100)}" w:firstLine="${Math.round(style.firstLineChars * style.sizePt * 20)}"/>`;
  } else {
    xml += '<w:ind w:firstLineChars="0" w:firstLine="0"/>';
  }
  xml += '</w:pPr>';
  return xml;
}

function paragraph(role, text, style) {
  const parts = String(text).split('\n');
  let runs = '';
  parts.forEach((line, i) => {
    if (i > 0) runs += `<w:r>${rPr(role, style)}<w:br/></w:r>`;
    runs += `<w:r>${rPr(role, style)}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`;
  });
  return `<w:p>${pPr(role, style)}${runs}</w:p>`;
}

function imageParagraph(relId, media, style) {
  const cx = media.cx, cy = media.cy;
  return `<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:jc w:val="center"/><w:spacing w:line="360" w:lineRule="auto"/><w:ind w:firstLineChars="0" w:firstLine="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${esc(style.font)}" w:eastAsia="${esc(style.font)}" w:hAnsi="${esc(style.font)}" w:cs="${esc(style.font)}"/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${media.id}" name="Picture ${media.id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${media.id}" name="Picture ${media.id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function styleXml(model) {
  const roles = model.roles;
  const def = roles.body;
  const mk = (id, name, role) => {
    const s = roles[role];
    const b = s.bold ? '<w:b/><w:bCs/>' : '';
    return `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:line="${lineVal(s.lineSpacing || 1.5)}" w:lineRule="auto"/><w:ind w:firstLineChars="${role === 'body' ? Math.round((s.firstLineChars || 0) * 100) : 0}" w:firstLine="${role === 'body' ? Math.round((s.firstLineChars || 0) * s.sizePt * 20) : 0}"/><w:jc w:val="${s.align === 'both' ? 'both' : s.align || 'left'}"/></w:pPr><w:rPr><w:rFonts w:ascii="${esc(s.font)}" w:eastAsia="${esc(s.font)}" w:hAnsi="${esc(s.font)}" w:cs="${esc(s.font)}"/>${b}<w:sz w:val="${halfPt(s.sizePt)}"/><w:szCs w:val="${halfPt(s.sizePt)}"/></w:rPr></w:style>`;
  };
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${esc(def.font)}" w:eastAsia="${esc(def.font)}" w:hAnsi="${esc(def.font)}" w:cs="${esc(def.font)}"/><w:sz w:val="${halfPt(def.sizePt)}"/><w:szCs w:val="${halfPt(def.sizePt)}"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="${lineVal(def.lineSpacing || 1.5)}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:line="${lineVal(def.lineSpacing || 1.5)}" w:lineRule="auto"/><w:ind w:firstLineChars="${Math.round((def.firstLineChars || 0) * 100)}" w:firstLine="${Math.round((def.firstLineChars || 0) * def.sizePt * 20)}"/><w:jc w:val="${def.align === 'both' ? 'both' : def.align || 'left'}"/></w:pPr><w:rPr><w:rFonts w:ascii="${esc(def.font)}" w:eastAsia="${esc(def.font)}" w:hAnsi="${esc(def.font)}" w:cs="${esc(def.font)}"/><w:sz w:val="${halfPt(def.sizePt)}"/><w:szCs w:val="${halfPt(def.sizePt)}"/></w:rPr></w:style>
${mk('ReportTitle', 'Report Title', 'title')}
${mk('SectionHeading', 'Section Heading', 'heading')}
${mk('BodyText', 'Body Text', 'body')}
${mk('CodeBlock', 'Code Block', 'code')}
</w:styles>`;
}

async function buildDocx(doc, model) {
  const roles = model.roles;
  const page = roles.page;
  const zip = new JSZip();
  const rels = [];
  const mediaFiles = [];
  let paragraphXml = '';
  let imgIndex = 0;
  const contentWidthTwips = page.w - page.left - page.right;
  for (const blk of doc.blocks) {
    if (blk.type === 'image') {
      const m = blk.image;
      imgIndex += 1;
      const relId = 'rIdImg' + imgIndex;
      const maxEmu = Math.round((contentWidthTwips / 1440) * 914400);
      let cx = Math.round((m.width / 96) * 914400);
      let cy = Math.round((m.height / 96) * 914400);
      if (cx > maxEmu) { const k = maxEmu / cx; cx = maxEmu; cy = Math.round(cy * k); }
      const ext = m.ext === 'jpg' ? 'jpeg' : m.ext;
      const path = 'word/media/image' + imgIndex + '.' + (ext === 'jpeg' ? 'jpeg' : ext);
      mediaFiles.push({ path, buffer: m.buffer, ext });
      rels.push({ id: relId, target: 'media/image' + imgIndex + '.' + (ext === 'jpeg' ? 'jpeg' : ext), type: 'image' });
      paragraphXml += imageParagraph(relId, { cx, cy, id: imgIndex }, roles.body);
      continue;
    }
    const role = blk.role;
    const style = roles[role] || roles.body;
    paragraphXml += paragraph(role, blk.text, style);
  }
  const sect = `<w:sectPr><w:pgSz w:w="${page.w}" w:h="${page.h}"/><w:pgMar w:top="${page.top}" w:right="${page.right}" w:bottom="${page.bottom}" w:left="${page.left}" w:header="851" w:footer="992" w:gutter="510"/><w:cols w:space="720"/><w:docGrid w:type="lines" w:linePitch="312"/></w:sectPr>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:w16se="http://schemas.microsoft.com/office/word/2015/wordml/symex" mc:Ignorable="w14 w15 w16se"><w:body>${paragraphXml}${sect}</w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

  let docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rIdFonts" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>`;
  for (const r of rels) {
    docRels += `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${r.type}" Target="${r.target}"/>`;
  }
  docRels += '</Relationships>';

  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="420"/><w:characterSpacingControl w:val="compressPunctuation"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

  const usedFonts = [...new Set(Object.values(roles).filter(r => r && r.font).map(r => r.font))];
  const fontTable = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${usedFonts.map((f, i) => `<w:font w:name="${esc(f)}"><w:charset w:val="86"/><w:family w:val="auto"/><w:pitch w:val="variable"/></w:font>`).join('')}</w:fonts>`;

  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc((model.caption || '实验报告'))}</dc:title><dc:creator>Paper Format Studio</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created></cp:coreProperties>`;

  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Paper Format Studio</Application></Properties>`;

  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rootRels);
  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', docRels);
  zip.file('word/styles.xml', styleXml(model));
  zip.file('word/settings.xml', settings);
  zip.file('word/fontTable.xml', fontTable);
  zip.file('docProps/core.xml', core);
  zip.file('docProps/app.xml', app);
  for (const m of mediaFiles) zip.file(m.path, m.buffer);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { buildDocx, STYLE_ID };
