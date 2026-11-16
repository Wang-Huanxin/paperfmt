const fs = require('fs');
const path = require('path');
const { extractTextBuffer } = require('../src/extract');
const { buildModel } = require('../src/template');
const { parseSource, questionStem } = require('../src/structure');
const { compose } = require('../src/compose');
const { buildDocx } = require('../src/docxgen');
const { validateDocx } = require('../src/validate');

const base = path.resolve(__dirname, '../../samples');
async function main() {
  const tplName = process.argv[2] || 'template.doc';
  const paperName = process.argv[3] || 'workshop9.pdf';
  const tpl = await extractTextBuffer(fs.readFileSync(path.join(base, tplName)), tplName);
  const paper = await extractTextBuffer(fs.readFileSync(path.join(base, paperName)), paperName);
  const model = buildModel(tpl);
  console.log('MODEL', JSON.stringify(model.roles, null, 1));
  console.log('EVIDENCE', model.evidence);
  const ps = parseSource(paper.blocks);
  console.log('QUESTIONS', ps.questions.map(q => q.number), 'repair', ps.repair);
  console.log('STEM8', ps.questions.filter(q => q.number === 8).map(questionStem));
  const composed = await compose({ paper: { ...paper, ...ps }, questionSource: null, model, meta: { className: '物联网', studentId: '257037', studentName: '王焕鑫', workshop: '9' }, lang: 'zh' });
  console.log('BLOCKS', composed.blocks.length, 'Q', composed.questions.map(q => q.number));
  const buf = await buildDocx({ blocks: composed.blocks, questions: composed.questions, lang: 'zh' }, model);
  fs.writeFileSync(path.join(base, 'out.docx'), buf);
  const val = await validateDocx(buf, model, { blocks: composed.blocks, questions: composed.questions, lang: 'zh' });
  console.log('PASS', val.passRate, 'FAILED', val.failedCount, 'TOTAL', val.total);
  for (const c of val.checks.filter(x => !x.ok)) console.log('FAIL:', c.id, c.label, '|', c.actual);
  for (const c of val.checks) console.log(c.ok ? 'OK ' : 'NG ', c.id, '|', c.expected, '|', c.actual);
}
main().catch(e => { console.error(e); process.exit(1); });
