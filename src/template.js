const SIZE_MAP = {
  '初号': 42, '小初': 36, '一号': 26, '小一': 24, '二号': 22, '小二': 18,
  '三号': 16, '小三': 15, '四号': 14, '小四': 12, '五号': 10.5, '小五': 9,
  '六号': 7.5, '小六': 6.5,
};

const FONT_NAMES = [
  '仿宋_GB2312', '仿宋GB2312', '华文仿宋', '华文中宋', '微软雅黑', '新宋体', '方正小标宋',
  'Times New Roman', 'Courier New', 'Calibri', 'Cambria', 'Consolas', 'Arial', 'Georgia',
  '仿宋', '宋体', '黑体', '楷体', '等线', '隶书', '幼圆', '华文楷体', '华文宋体', '思源宋体',
];

const ROLE_DEFAULT = {
  title: { font: '黑体', sizePt: 15, bold: true, align: 'center', firstLineChars: 0, lineSpacing: 1.5, spaceBefore: 0, spaceAfter: 0 },
  heading: { font: '黑体', sizePt: 12, bold: true, align: 'left', firstLineChars: 0, lineSpacing: 1.5, spaceBefore: 0, spaceAfter: 0 },
  body: { font: '宋体', sizePt: 12, bold: false, align: 'left', firstLineChars: 2, lineSpacing: 1.5, spaceBefore: 0, spaceAfter: 0 },
  code: { font: '宋体', sizePt: 12, bold: false, align: 'left', firstLineChars: 0, lineSpacing: 1.0, spaceBefore: 0, spaceAfter: 0 },
};

const ROLE_LABEL = { title: '文件首部/报告标题', heading: '标题', body: '正文', code: '源程序代码' };

function normalize(text) {
  if (!text) return '';
  return text
    .replace(/\r/g, '')
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：；，。、（）]/g, c => ({ '：': ':', '；': ';', '，': ',', '。': '.', '、': ',', '（': '(', '）': ')' }[c]))
    .replace(/\u3000/g, ' ');
}

function parseSpec(spec) {
  const out = {};
  if (!spec) return out;
  const s = normalize(spec);

  for (const f of FONT_NAMES) {
    const re = new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (re.test(s)) { out.font = f.replace(/GB2312$/i, ''); break; }
  }

  const sizeNames = Object.keys(SIZE_MAP).sort((a, b) => b.length - a.length || (b.startsWith('小') ? 1 : 0) - (a.startsWith('小') ? 1 : 0));
  const sizeRe = new RegExp('(' + sizeNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')号?');
  const sizeHit = sizeRe.exec(s);
  if (sizeHit) out.sizePt = SIZE_MAP[sizeHit[1]];
  if (!out.sizePt) {
    const m = /(\d+(?:\.\d+)?)\s*(?:pt|磅|points?)/i.exec(s);
    if (m) out.sizePt = Number(m[1]);
  }

  if (/不加粗|非加粗/.test(s)) out.bold = false;
  else if (/加粗|粗体|bold/i.test(s)) out.bold = true;

  if (/居中|center/i.test(s)) out.align = 'center';
  else if (/右对齐|right/i.test(s)) out.align = 'right';
  else if (/两端对齐|justify|both/i.test(s)) out.align = 'both';
  else if (/左对齐|left/i.test(s)) out.align = 'left';

  if (/无缩进|不缩进|顶格/.test(s)) out.firstLineChars = 0;
  else {
    const m = /首行缩进\s*(\d+(?:\.\d+)?)\s*(?:字符|个字|字|chars?)/.exec(s);
    if (m) out.firstLineChars = Number(m[1]);
    else {
      const m2 = /首行缩进\s*(\d+(?:\.\d+)?)\s*(?:cm|厘米)/.exec(s);
      if (m2) out.firstLineCm = Number(m2[1]);
    }
  }

  const multi = /(\d+(?:\.\d+)?)\s*(?:倍)?行距/.exec(s);
  if (multi) out.lineSpacing = Number(multi[1]);
  else if (/单倍行距|单倍/.test(s)) out.lineSpacing = 1.0;
  else if (/双倍行距/.test(s)) out.lineSpacing = 2.0;
  else {
    const fixed = /固定值\s*(\d+(?:\.\d+)?)\s*(?:磅|pt)/.exec(s);
    if (fixed) out.lineSpacingPt = Number(fixed[1]);
  }

  const before = /段前\s*(\d+(?:\.\d+)?)\s*(?:磅|pt|行)/.exec(s);
  if (before) out.spaceBefore = Number(before[1]);
  const after = /段后\s*(\d+(?:\.\d+)?)\s*(?:磅|pt|行)/.exec(s);
  if (after) out.spaceAfter = Number(after[1]);

  const align = /对齐/.test(s) ? null : null;
  return out;
}

function roleFromKeyword(kw) {
  if (/首部|大标题|主标题|论文题目|报告题目/.test(kw)) return 'title';
  if (/标题/.test(kw)) return 'heading';
  if (/正文|题干|内容/.test(kw)) return 'body';
  if (/代码|源程序/.test(kw)) return 'code';
  return null;
}

function roleSpecsFromText(text) {
  const norm = normalize(text || '');
  const map = {};
  const evidence = {};
  const re = /(文件首部|报告首部|首部|大标题|主标题|标题|正文|题干|源程序代码|源程序|代码)/g;
  const matches = [];
  let m;
  while ((m = re.exec(norm))) matches.push({ kw: m[1], index: m.index, end: re.lastIndex });
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const role = roleFromKeyword(cur.kw);
    if (!role) continue;
    const next = matches[i + 1] ? matches[i + 1].index : norm.length;
    let segment = norm.slice(cur.end, next);
    if (segment.length > 160) segment = segment.slice(0, 160);
    const spec = parseSpec(segment);
    if (!Object.keys(spec).length) continue;
    map[role] = Object.assign(map[role] || {}, spec);
    if (!evidence[role]) {
      const raw = (text || '').replace(/\r/g, '');
      const lineHit = raw.split('\n').find(l => normalize(l).includes(cur.kw) && (parseSpec(normalize(l)).font || parseSpec(normalize(l)).sizePt || /缩进|行距/.test(normalize(l))));
      evidence[role] = (lineHit || (cur.kw + segment)).trim().replace(/^[【\[\(]+|[】\]\)]+$/g, '');
    }
  }
  return { map, evidence };
}

function parseMargins(text) {
  const s = normalize(text || '');
  const out = {};
  const m = /页边距([^。\n]{0,40})/.exec(s);
  if (m) {
    const seg = m[1];
    const nums = [...seg.matchAll(/(\d+(?:\.\d+)?)\s*(cm|厘米|mm|毫米|inch|英寸|磅|pt)/g)];
    if (nums.length >= 1) {
      const conv = n => {
        const unit = n[2].toLowerCase();
        if (unit === 'cm' || unit === '厘米') return Math.round(Number(n[1]) * 567);
        if (unit === 'mm' || unit === '毫米') return Math.round(Number(n[1]) * 56.7);
        if (unit === 'inch' || unit === '英寸') return Math.round(Number(n[1]) * 1440);
        return Math.round(Number(n[1]) * 20);
      };
      if (/上下左右|四边|四周/.test(seg) && nums.length >= 1) {
        const v = conv(nums[0]);
        out.top = out.bottom = out.left = out.right = v;
      } else {
        const keys = ['top', 'bottom', 'left', 'right'];
        nums.slice(0, 4).forEach((n, i) => { out[keys[i]] = conv(n); });
      }
    }
  }
  return out;
}

function inferFromBlocks(blocks, model, evidence) {
  if (!blocks || !blocks.length) return;
  const nonEmpty = blocks.filter(b => (b.text || '').trim().length > 0);
  if (!nonEmpty.length) return;
  const byRole = { title: [], heading: [], body: [], code: [] };

  for (const b of nonEmpty) {
    const t = b.text.trim();
    if (!b.runs || !b.runs.length) continue;
    const run = b.runs.find(r => r.text && r.text.trim()) || b.runs[0];
    const font = run.font;
    const size = run.sizeHalf ? run.sizeHalf / 2 : null;
    const bold = !!run.bold;
    const isCenter = b.align === 'center';
    if (isCenter && size && size >= 14) byRole.title.push({ b, font, size, bold });
    else if (bold && /标题|实验内容|遇到的问题/.test(t)) byRole.heading.push({ b, font, size, bold });
    else if (b.line === 240 || /#include|^\s*[{}]|;\s*$/.test(t)) byRole.code.push({ b, font, size, bold });
    else byRole.body.push({ b, font, size, bold });
  }

  const pick = arr => arr.find(x => x.font) || arr[0];
  const fallback = { title: pick(byRole.title), heading: pick(byRole.heading), body: pick(byRole.body), code: pick(byRole.code) };
  for (const role of ['title', 'heading', 'body', 'code']) {
    if (model.roles[role]._explicit) continue;
    const f = fallback[role];
    if (f && f.font) model.roles[role].font = f.font;
    if (f && f.size) model.roles[role].sizePt = f.size;
    if (f && role !== 'body' && role !== 'code') {
      if (f.bold) model.roles[role].bold = true;
    }
  }

  const bodyRuns = byRole.body.length ? byRole.body : [];
  if (bodyRuns.length) {
    const fonts = {};
    bodyRuns.forEach(x => { if (x.font) fonts[x.font] = (fonts[x.font] || 0) + 1; });
    const top = Object.entries(fonts).sort((a, b) => b[1] - a[1])[0];
    if (top && !model.roles.body._explicit) model.roles.body.font = top[0];
  }

  for (const role of ['title', 'heading', 'body', 'code']) {
    if (!evidence[role] && fallback[role] && fallback[role].font) {
      evidence[role] = '模板正文样例：' + (fallback[role].b.text || '').trim().slice(0, 50);
    }
  }
}

function buildModel(template) {
  const text = (template && template.text) || '';
  const blocks = (template && template.blocks) || [];
  const { map, evidence } = roleSpecsFromText(text);
  const roles = {};
  for (const role of ['title', 'heading', 'body', 'code']) {
    const explicit = Object.prototype.hasOwnProperty.call(map, role);
    roles[role] = Object.assign({}, ROLE_DEFAULT[role], explicit ? map[role] : {});
    roles[role]._explicit = explicit;
    if (explicit && !evidence[role]) evidence[role] = ROLE_LABEL[role] + '格式说明';
  }

  if (template && template.page) {
    const pg = template.page;
    roles.page = {
      w: pg.w || 11906,
      h: pg.h || 16838,
      top: pg.marginTop || 1134,
      right: pg.marginRight || 1134,
      bottom: pg.marginBottom || 1134,
      left: pg.marginLeft || 1134,
    };
  } else {
    roles.page = { w: 11906, h: 16838, top: 1134, right: 1134, bottom: 1134, left: 1134 };
  }
  const marginOverride = parseMargins(text);
  Object.assign(roles.page, marginOverride);

  inferFromBlocks(blocks, { roles }, evidence);

  for (const role of ['title', 'heading', 'body', 'code']) {
    const r = roles[role];
    if (r.firstLineCm != null) {
      r.firstLineChars = Math.round((r.firstLineCm * 567) / (r.sizePt * 20) * 20) / 20;
    }
    if (r.lineSpacingPt) {
      r.lineExactPt = r.lineSpacingPt;
      r.lineSpacing = r.lineSpacingPt / (r.sizePt * 1.2);
    }
  }
  roles.code.font = roles.code._explicit && map.code && map.code.font ? roles.code.font : roles.body.font;
  if (!roles.code._explicit || !map.code || !map.code.sizePt) roles.code.sizePt = roles.body.sizePt;

  const caption = extractCaption(blocks, text);
  const headings = extractHeadings(blocks, text);

  return {
    roles,
    evidence,
    caption,
    headings,
    answerFrame: extractAnswerFrame(text),
    rawText: text,
    templateType: (template && template.type) || 'text',
  };
}

function extractCaption(blocks, text) {
  for (const b of blocks) {
    const t = (b.text || '').trim();
    if (!t) continue;
    if (/报告/.test(t) && /【/.test(t)) {
      const inner = t.replace(/^【|】.*$/g, '').trim();
      const cut = inner.split(/文件命名要求|删除/)[0].trim();
      if (cut) return cut;
    }
  }
  const m = /【([^】]{2,40}报告[^】]*)】/.exec(normalize(text));
  if (m) return m[1].split(/文件命名要求|删除/)[0].trim();
  return null;
}

function extractAnswerFrame(text) {
  const t = normalize(text || '');
  if (!t) return null;
  const frame = {
    analysis: /(^|\n)\s*分析\s*:/m.test(t),
    code: /(^|\n)\s*源程序代码\s*:/m.test(t),
    result: /(^|\n)\s*运行效果\s*:/m.test(t),
  };
  return (frame.analysis || frame.code || frame.result) ? frame : null;
}

function extractHeadings(blocks, text) {
  const out = [];
  for (const b of blocks) {
    const t = (b.text || '').trim();
    if (!t || t.length > 24) continue;
    if (/^(?:[一二三四五六七八九十]+[、.]\s*)?(实验内容|实验目的|实验环境|实验步骤|遇到的问题|问题与讨论|分析与讨论|结论|参考文献|实验总结|摘要|引言)$/.test(t)) {
      out.push(t);
    }
  }
  if (!out.length) {
    const lines = normalize(text).split('\n').map(l => l.trim());
    for (const l of lines) {
      if (/^(?:[一二三四五六七八九十]+[、.]\s*)?(实验内容|遇到的问题|实验目的|结论)$/.test(l)) out.push(l);
    }
  }
  return out;
}

module.exports = { buildModel, parseSpec, normalize, SIZE_MAP, ROLE_LABEL };
