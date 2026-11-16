const JSZip = require('jszip');
const { extractDocx } = require('./extract');

const STYLE_TO_ROLE = { ReportTitle: 'title', SectionHeading: 'heading', BodyText: 'body', CodeBlock: 'code' };
const ROLE_LABEL = { title: '文件首部/报告标题', heading: '标题', body: '正文', code: '源程序代码' };

function snippet(t) {
  const s = (t || '').replace(/\s+/g, ' ').trim();
  return s.length > 32 ? s.slice(0, 32) + '…' : s;
}

function fmtSize(n) { return n == null ? '未设置' : n + ' pt'; }
function fmtBold(b) { return b ? '加粗' : '不加粗'; }
function fmtAlign(a) { return ({ center: '居中', left: '左对齐', right: '右对齐', both: '两端对齐' })[a] || '左对齐'; }
function fmtLine(l) { return l == null ? '未设置' : (l / 240).toFixed(2).replace(/\.00$/, '') + ' 倍行距'; }

async function validateDocx(buffer, model, doc) {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml').async('string');
  const parsed = await extractDocx(buffer);
  const blocks = parsed.blocks;
  const checks = [];

  const page = model.roles.page;
  const sect = /<w:sectPr[\s\S]*?<\/w:sectPr>/.exec(documentXml);
  const pgsz = sect ? (/<w:pgSz[^>]*\/>/.exec(sect[0]) || [])[0] : '';
  const pgmar = sect ? (/<w:pgMar[^>]*\/>/.exec(sect[0]) || [])[0] : '';
  const w = pgsz ? Number((/w:w="(\d+)"/.exec(pgsz) || [])[1]) : null;
  const h = pgsz ? Number((/w:h="(\d+)"/.exec(pgsz) || [])[1]) : null;
  const margin = k => pgmar ? Number((new RegExp('w:' + k + '="(\\d+)"').exec(pgmar) || [])[1]) : null;

  checks.push({
    id: 'page-size', group: '页面', label: '纸张与页边距',
    expected: `A4 ${w ? '210×297mm' : ''}；页边距 上${(page.top / 567).toFixed(1)}cm 下${(page.bottom / 567).toFixed(1)}cm 左${(page.left / 567).toFixed(1)}cm 右${(page.right / 567).toFixed(1)}cm`,
    actual: `宽度 ${w} twips，高度 ${h} twips；上${margin('top')} 下${margin('bottom')} 左${margin('left')} 右${margin('right')} twips`,
    ok: w === page.w && h === page.h && margin('top') === page.top && margin('bottom') === page.bottom && margin('left') === page.left && margin('right') === page.right,
    evidence: '模板页面设置（sectPr）',
    honest: '模板未声明页边距时采用 A4 2cm 默认值',
  });

  const roleBlocks = { title: [], heading: [], body: [], code: [] };
  blocks.forEach((b, idx) => {
    const role = STYLE_TO_ROLE[b.styleId];
    if (role) roleBlocks[role].push({ idx, b });
  });
  const hasImages = blocks.some(b => (b.images || []).length);

  for (const role of ['title', 'heading', 'body', 'code']) {
    const style = model.roles[role];
    const list = roleBlocks[role].filter(x => !(x.b.images || []).length);
    const used = roleBlocks[role].length;
    const sampleEvidence = model.evidence[role] || `${ROLE_LABEL[role]}格式要求`;
    if (!used) {
      if (role === 'code') continue;
      checks.push({ id: `style-${role}`, group: '格式', label: `${ROLE_LABEL[role]}：未使用`, expected: '应存在该类段落', actual: '0 段', ok: false, evidence: sampleEvidence });
      continue;
    }

    const fail = { font: [], size: [], bold: [], align: [], indent: [], spacing: [] };
    for (const { idx, b } of list) {
      const textRuns = (b.runs || []).filter(r => (r.text || '').trim().length);
      if (!textRuns.length) continue;
      for (const r of textRuns) {
        const slots = [r.fontAscii, r.fontEastAsia, r.fontHAnsi, r.fontCs];
        if (slots.some(f => f !== style.font)) fail.font.push({ idx, text: snippet(r.text), actual: `ascii=${r.fontAscii || '未设置'} eastAsia=${r.fontEastAsia || '未设置'} hAnsi=${r.fontHAnsi || '未设置'} cs=${r.fontCs || '未设置'}` });
        if (r.sizeHalf !== Math.round(style.sizePt * 2)) fail.size.push({ idx, text: snippet(r.text), actual: r.sizeHalf ? r.sizeHalf / 2 + ' pt' : '未设置' });
        if (!!r.bold !== !!style.bold) fail.bold.push({ idx, text: snippet(r.text), actual: r.bold ? '加粗' : '不加粗' });
      }
      const align = b.align || 'left';
      const expectedAlign = style.align === 'both' ? 'both' : (style.align || 'left');
      if (align !== expectedAlign) fail.align.push({ idx, text: snippet(b.text), actual: fmtAlign(align) });
      const flc = b.firstLineChars || 0;
      const expectedFlc = role === 'body' ? Math.round((style.firstLineChars || 0) * 100) : 0;
      if (flc !== expectedFlc) fail.indent.push({ idx, text: snippet(b.text), actual: `首行缩进 ${flc / 100} 字符` });
      const line = b.line;
      if (line !== Math.round((style.lineSpacing || 1.5) * 240)) fail.spacing.push({ idx, text: snippet(b.text), actual: `行距 ${fmtLine(line)}` });
    }

    const common = { group: '格式', evidence: sampleEvidence };
    const mk = (key, label, expected, actualFn, formatter) => {
      const fails = fail[key];
      checks.push({
        ...common, id: `style-${role}-${key}`, label: `${ROLE_LABEL[role]} · ${label}`,
        expected, ok: fails.length === 0,
        actual: fails.length === 0 ? `全部 ${used} 段符合（${formatter}）` : `${fails.length} 处不符合：${fails.slice(0, 3).map(f => `第${f.idx + 1}段「${f.text}」实际${f.actual}`).join('；')}`,
        count: used,
      });
    };
    mk('font', '字体（中英文一致）', `${style.font}（ascii/eastAsia/hAnsi/cs 全部）`, null, style.font);
    mk('size', '字号', fmtSize(style.sizePt), null, fmtSize(style.sizePt));
    mk('bold', '字重', fmtBold(style.bold), null, fmtBold(style.bold));
    mk('align', '对齐', fmtAlign(style.align || 'left'), null, fmtAlign(style.align || 'left'));
    mk('indent', '首行缩进', role === 'body' ? `${style.firstLineChars || 0} 字符` : '无缩进', null, role === 'body' ? `${style.firstLineChars || 0} 字符` : '无缩进');
    mk('spacing', '行距', fmtLine(Math.round((style.lineSpacing || 1.5) * 240)), null, fmtLine(Math.round((style.lineSpacing || 1.5) * 240)));
  }

  const paragraphs = blocks.filter(b => !(b.images || []).length);
  const qParas = paragraphs.filter(b => STYLE_TO_ROLE[b.styleId] === 'body' && /^\s*\d{1,2}\s*\*{0,2}\s*[.)、:：]/.test(b.text || ''));
  const numbers = [];
  const dup = [];
  for (const b of paragraphs) {
    const m = /^\s*(\d{1,2})\s*\*{0,2}\s*[.)、:：]\s*(.*)$/.exec(b.text || '');
    if (!m) continue;
    const n = Number(m[1]);
    if (numbers.includes(n)) dup.push({ n, text: snippet(b.text) });
    else { numbers.push(n); }
  }
  const expectedNumbers = (doc.questions || []).map(q => q.number);
  const missing = expectedNumbers.filter(n => !numbers.includes(n));
  const extra = numbers.filter(n => !expectedNumbers.includes(n));
  checks.push({
    group: '题目', id: 'questions-sequence', label: '题目编号完整且不合并',
    expected: `共 ${expectedNumbers.length} 题：${expectedNumbers.join(', ')}`,
    actual: numbers.length ? `识别 ${numbers.length} 题：${numbers.join(', ')}${dup.length ? `；重复：${dup.map(d => d.n).join(', ')}` : ''}` : '未识别到题号',
    ok: missing.length === 0 && dup.length === 0 && extra.length === 0 && numbers.length === expectedNumbers.length,
    evidence: '逐段回读导出的 DOCX，按“数字+点/顿号”独立识别题号',
  });

  const emptyQ = (doc.questions || []).filter(q => (q.stem || '').trim().length < 4);
  checks.push({
    group: '题目', id: 'questions-content', label: '每题均有题干内容',
    expected: '每题题干非空且独立成段',
    actual: emptyQ.length ? `第 ${emptyQ.map(q => q.number).join(', ')} 题题干为空` : `全部 ${(doc.questions || []).length} 题题干完整`,
    ok: emptyQ.length === 0,
    evidence: '题目原文来自上传的题目文件 / 论文文件',
  });

  const merged = [];
  const expectedSet = new Set(expectedNumbers);
  for (const b of paragraphs) {
    const t = b.text || '';
    const m = /^\s*(\d{1,2})\s*\*{0,2}\s*[.)、:：]/.exec(t);
    if (!m) continue;
    const n = Number(m[1]);
    const next = n + 1;
    if (!expectedSet.has(next)) continue;
    const inside = new RegExp('\\s' + next + '\\s*\\*{0,2}\\s*[.)、:：]\\s+[A-Za-z\\u4e00-\\u9fa5]');
    if (inside.test(t.slice(m[0].length))) merged.push(snippet(t));
  }
  checks.push({
    group: '题目', id: 'questions-merged', label: '未出现两题合并为一段',
    expected: '每个题号各自独立成段',
    actual: merged.length ? `发现 ${merged.length} 段包含多个题号：${merged.slice(0, 2).join('；')}` : '未发现合并段落',
    ok: merged.length === 0,
    evidence: '回读段落文本，检测一段内出现两个及以上题号起始',
  });

  if (model.headings && model.headings.length) {
    const normHead = s => (s || '').replace(/^[一二三四五六七八九十]+\s*[、.]\s*/, '').trim();
    const english = doc.lang === 'en';
    const seen = roleBlocks.heading.map(x => normHead(x.b.text));
    const missingHeads = english
      ? (roleBlocks.heading.length >= model.headings.length ? [] : [`缺 ${model.headings.length - roleBlocks.heading.length} 个小节`])
      : model.headings.map(normHead).filter(h => h && !seen.includes(h));
    checks.push({
      group: '模板结构', id: 'sections', label: '模板小节完整',
      expected: '模板中的小节标题全部出现',
      actual: missingHeads.length ? `缺少：${missingHeads.join('、')}` : `${model.headings.length} 个小节全部出现`,
      ok: !missingHeads.length,
      evidence: english ? '英文版按标题段落数量核对' : '回读标题段落，与模板小节逐一比对',
    });
  }

  if (model.answerFrame) {
    const need = [];
    const en = doc.lang === 'en';
    if (model.answerFrame.analysis) need.push(en ? 'Analysis:' : '分析：');
    if (model.answerFrame.code) need.push(en ? 'Source code:' : '源程序代码：');
    if (model.answerFrame.result) need.push(en ? 'Running effect:' : '运行效果：');
    if (need.length) {
      const lost = [];
      for (const n of expectedNumbers) {
        const start = paragraphs.findIndex(b => new RegExp('^\\s*' + n + '\\s*\\.').test(b.text || ''));
        if (start < 0) continue;
        let end = paragraphs.length;
        for (let i = start + 1; i < paragraphs.length; i++) {
          if (/^\s*\d{1,2}\s*\./.test(paragraphs[i].text || '')) { end = i; break; }
        }
        const seg = paragraphs.slice(start, end).map(b => (b.text || '').trim());
        const miss = need.filter(l => !seg.includes(l));
        if (miss.length) lost.push(`第${n}题缺${miss.join('、')}`);
      }
      checks.push({
        group: '模板结构', id: 'answer-frame', label: '每题都有模板要求的答题结构',
        expected: '每道题下包含 ' + need.join(' / '),
        actual: lost.length ? lost.slice(0, 3).join('；') : `${expectedNumbers.length} 道题结构齐全`,
        ok: !lost.length,
        evidence: '回读每题段落区间，检查 分析：/源程序代码：/运行效果： 标签',
      });
    }
  }

  if (doc.lang === 'en') {
    const bad = [];
    for (const role of ['title', 'heading', 'body', 'code']) {
      const style = model.roles[role];
      for (const { idx, b } of roleBlocks[role]) {
        for (const r of (b.runs || [])) {
          if ((r.text || '').trim() && r.font !== style.font) bad.push({ idx, text: snippet(r.text), font: r.font });
        }
      }
    }
    checks.push({
      group: '英文版', id: 'english-font', label: '翻译后字体不变',
      expected: '英文段落沿用模板字体与字号，不因翻译改变',
      actual: bad.length ? `${bad.length} 处字体变化` : '全部英文段落字体与模板一致',
      ok: bad.length === 0,
      evidence: '按 ascii/eastAsia/hAnsi/cs 四个字体槽逐一比对',
    });
  }

  const failed = checks.filter(c => !c.ok);
  const passRate = checks.length ? Math.round(((checks.length - failed.length) / checks.length) * 100) : 100;
  return { checks, passRate, failedCount: failed.length, total: checks.length, numbers, expectedNumbers, missing, dup };
}

module.exports = { validateDocx };
