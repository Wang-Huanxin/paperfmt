const { questionStem, isCodeLine } = require('./structure');

const LABELS = {
  '实验内容': 'Experiment Content',
  '实验目的': 'Experiment Objectives',
  '实验环境': 'Experiment Environment',
  '实验步骤': 'Experiment Procedure',
  '遇到的问题': 'Problems Encountered',
  '问题与讨论': 'Questions and Discussion',
  '分析与讨论': 'Analysis and Discussion',
  '实验总结': 'Summary',
  '结论': 'Conclusion',
  '参考文献': 'References',
  '源程序代码：': 'Source Code:',
  '源程序代码': 'Source Code',
  '运行效果：': 'Running Result:',
  '运行效果': 'Running Result',
  '分析：': 'Analysis:',
  '分析': 'Analysis',
  '答：': 'Answer:',
  '解：': 'Solution:',
  '题干': 'Question',
  '答': 'Answer',
};

const ROMAN = { '一': 'I', '二': 'II', '三': 'III', '四': 'IV', '五': 'V', '六': 'VI', '七': 'VII', '八': 'VIII', '九': 'IX', '十': 'X' };

function translateLabels(text) {
  let out = text;
  let prefix = '';
  const num = /^([一二三四五六七八九十]+)\s*[、.]\s*/.exec(out);
  if (num) {
    prefix = (ROMAN[num[1]] || num[1]) + '. ';
    out = out.slice(num[0].length);
  }
  for (const [zh, en] of Object.entries(LABELS)) {
    if (out === zh) return prefix + en;
    if (out.startsWith(zh)) out = prefix + en + out.slice(zh.length);
  }
  return prefix + out;
}

function frameLabel(zh, lang) {
  if (lang !== 'en') return zh;
  return ({ '分析：': 'Analysis:', '源程序代码：': 'Source code:', '运行效果：': 'Running effect:' })[zh] || zh;
}

function headingNumber(text) {
  const m = /^([一二三四五六七八九十]+)\s*[、.]\s*/.exec(text || '');
  return m ? m[1] : null;
}

function stripHeadingNumber(text) {
  return (text || '').replace(/^[一二三四五六七八九十]+\s*[、.]\s*/, '').trim();
}

function paperSection(paperText, headingText) {
  const lines = (paperText || '').split('\n');
  const target = stripHeadingNumber(headingText);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (stripHeadingNumber(lines[i]) === target) { start = i; break; }
  }
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t && /^[一二三四五六七八九十]+\s*[、.]\s*/.test(t)) break;
    out.push(lines[i]);
  }
  return out;
}

function studentLine(meta) {
  const c = (meta.className || '').trim();
  const id = (meta.studentId || '').trim();
  const n = (meta.studentName || '').trim();
  if (!c && !id && !n) return '班级：            姓名：            学号：';
  return `班级：${c || '            '}    姓名：${n || '            '}    学号：${id || '            '}`;
}

function detectWorkshop(text) {
  const m = /(?:workshop|week)\s*(\d{1,2})/i.exec(text || '');
  return m ? m[1] : '';
}

function groupLines(lines, startPrefix) {
  const kinds = lines.map(l => (l.trim() && isCodeLine(l) ? 'code' : (l.trim() ? 'prose' : 'blank')));
  for (let i = 1; i < lines.length - 1; i++) {
    if (kinds[i] === 'prose' && kinds[i - 1] === 'code' && kinds[i + 1] === 'code') kinds[i] = 'code';
  }
  const groups = [];
  let prose = [];
  let code = [];
  let first = true;
  const flushProse = () => {
    if (!prose.length) return;
    const text = (startPrefix ? startPrefix + ' ' : '') + prose.join(' ');
    groups.push({ role: 'body', text: text.replace(/\s{2,}/g, ' ') });
    startPrefix = '';
    prose = [];
  };
  const flushCode = () => {
    if (!code.length) return;
    groups.push({ role: 'code', text: code.join('\n') });
    code = [];
  };
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\r/g, '').replace(/\t/g, '    ');
    if (!line.trim()) {
      flushProse(); flushCode();
      return;
    }
    if (kinds[idx] === 'code') {
      flushProse();
      code.push(line.replace(/[ \t]+$/g, ''));
    } else {
      flushCode();
      prose.push(line.trim());
    }
  });
  flushProse(); flushCode();
  return groups;
}

function linesOfQuestion(q) {
  const lines = q.raw.slice();
  if (lines.length) {
    const m = /^([ \t]*)(\d{1,2})(\s*\*{0,2}\s*[.)、:：])(.*)$/.exec(lines[0]);
    if (m) lines[0] = `${q.number}. ${m[4].trim()}`;
  }
  return lines;
}

async function compose(input) {
  const { paper, questionSource, model, meta, lang, translateFn, mode } = input;
  const paperText = paper ? paper.text : '';
  const blocks = [];
  const questions = [];
  const sourceText = questionSource ? questionSource.text : '';
  const questionMap = new Map();
  for (const q of (questionSource ? questionSource.questions : [])) {
    questionMap.set(q.number, q);
  }
  const paperQs = paper ? paper.questions : [];
  const usePaperQs = paperQs.length > 0;
  const allNumbers = new Set();
  for (const q of paperQs) allNumbers.add(q.number);
  for (const q of (questionSource ? questionSource.questions : [])) allNumbers.add(q.number);
  const ordered = [...allNumbers].sort((a, b) => a - b);
  const present = new Map();
  for (const q of paperQs) present.set(q.number, q);

  const caption = (meta.caption || model.caption || '计算思维与算法实验报告').trim();
  const workshop = (meta.workshop || detectWorkshop(sourceText) || detectWorkshop(paperText) || '').toString().trim();
  blocks.push({ role: 'title', text: lang === 'en' ? translateLabels(caption) : caption });
  blocks.push({ role: 'title', text: studentLine(meta) });
  if (workshop) blocks.push({ role: 'title', text: `Workshop ${workshop}` });

  const tplHeadings = (model.headings || []).map(h => (h || '').trim()).filter(Boolean);
  const mainRaw = tplHeadings.find(h => /实验内容/.test(h)) || '实验内容';
  const hasNumbered = tplHeadings.some(h => headingNumber(h));
  let mainHeading = mainRaw;
  if (!headingNumber(mainHeading) && hasNumbered) mainHeading = '一、' + mainHeading;

  const headingList = [];
  const seenLabels = new Set();
  const candidates = tplHeadings.length ? tplHeadings : [mainHeading];
  for (const h of candidates) {
    const label = stripHeadingNumber(h);
    if (seenLabels.has(label)) continue;
    seenLabels.add(label);
    headingList.push(/实验内容/.test(h) ? mainHeading : h);
  }

  const pushQuestions = () => {
    if (ordered.length) {
      for (const n of ordered) {
        const q = present.get(n);
        const srcQ = questionMap.get(n);
        let stem = '';
        let raw = [];
        let fromSource = false;
        if (q) {
          stem = questionStem(q);
          raw = q.raw.slice();
        } else if (srcQ) {
          stem = questionStem(srcQ);
          raw = srcQ.raw.slice();
          fromSource = true;
        }
        if (raw.length) {
          raw.shift();
          while (raw.length) {
            const t = (raw[0] || '').trim();
            if (!t) { raw.shift(); continue; }
            if (stem.replace(/\s+/g, ' ').includes(t.replace(/\s+/g, ' '))) { raw.shift(); continue; }
            break;
          }
        }
        let stemText = stem;
        while (raw.length) {
          const t = (raw[0] || '').trim();
          if (!t) { raw.shift(); continue; }
          if (/^[a-z(,;:）]/.test(t) && !/[.?!:;。”"]$/.test(stemText)) {
            stemText += ' ' + t;
            raw.shift();
            continue;
          }
          break;
        }
        const display = lang === 'en' ? translateLabels(stemText) : stemText;
        questions.push({ number: n, stem: display, fromSource });
        blocks.push({ role: 'body', text: `${n}. ${display}` });
        const content = raw;
        const groups = content.length ? groupLines(content, '') : [];
        const images = [];
        for (const ln of (q ? q.lines : srcQ.lines || [])) {
          for (const im of (ln.images || [])) images.push(im);
        }
        const frame = model.answerFrame;
        const hasCode = groups.some(g => g.role === 'code') || content.some(l => isCodeLine(l));
        const joined = (stem + ' ' + content.slice(0, 8).join(' ')).replace(/\s+/g, ' ');
        const givenCode = mode === 'questions'
          || (hasCode && /following program|program below|code below|given program|the program given|下面的程序|下列程序|以下程序|as follows|如下|找出.{0,12}错误|identify.{0,12}error|errors in the program/i.test(joined));
        const hasFrameLabel = content.some(l => /^(分析|源程序代码|运行效果)\s*[：:]/.test((l || '').trim()));
        if (!frame || hasFrameLabel) {
          for (const g of groups) blocks.push({ role: g.role, text: g.text });
          for (const im of images) blocks.push({ type: 'image', image: im });
          continue;
        }
        if (givenCode) {
          for (const g of groups) blocks.push({ role: g.role, text: g.text });
          for (const im of images) blocks.push({ type: 'image', image: im });
          if (frame.analysis) blocks.push({ role: 'body', text: frameLabel('分析：', lang) });
          if (frame.code) blocks.push({ role: 'body', text: frameLabel('源程序代码：', lang) });
          if (frame.result) blocks.push({ role: 'body', text: frameLabel('运行效果：', lang) });
          continue;
        }
        let analysisDone = false;
        let codeDone = false;
        for (const g of groups) {
          if (!analysisDone && frame.analysis) {
            blocks.push({ role: 'body', text: frameLabel('分析：', lang) });
            analysisDone = true;
          }
          if (g.role === 'code') {
            if (!codeDone && frame.code) {
              blocks.push({ role: 'body', text: frameLabel('源程序代码：', lang) });
              codeDone = true;
            }
            blocks.push(g);
          } else {
            blocks.push(g);
          }
        }
        if (frame.analysis && !analysisDone) blocks.push({ role: 'body', text: frameLabel('分析：', lang) });
        if (frame.code && !codeDone) blocks.push({ role: 'body', text: frameLabel('源程序代码：', lang) });
        if (frame.result) blocks.push({ role: 'body', text: frameLabel('运行效果：', lang) });
        for (const im of images) blocks.push({ type: 'image', image: im });
      }
    } else if (paper) {
      const groups = groupLines((paper.lines || []).map(l => l.text), '');
      for (const g of groups) blocks.push({ role: g.role, text: g.text });
    }
  };

  let mainEmitted = false;
  for (const h of headingList) {
    blocks.push({ role: 'heading', text: lang === 'en' ? translateLabels(h) : h });
    if (/实验内容/.test(stripHeadingNumber(h))) {
      mainEmitted = true;
      pushQuestions();
      continue;
    }
    const lines = paperSection(paperText, h);
    if (!lines.some(l => (l || '').trim())) continue;
    const groups = groupLines(lines, '');
    for (const g of groups) blocks.push({ role: g.role, text: g.text });
  }
  if (!mainEmitted && ordered.length) {
    blocks.push({ role: 'heading', text: lang === 'en' ? translateLabels(mainHeading) : mainHeading });
    pushQuestions();
  }

  let translated = true;
  if (lang === 'en' && typeof translateFn === 'function') {
    const seen = new Map();
    const targets = blocks.filter(b => b.text && (b.role === 'body' || b.role === 'heading' || b.role === 'title') && !['Analysis:', 'Source code:', 'Running effect:'].includes(b.text));
    const unique = [...new Set(targets.map(b => b.text))];
    const limit = 9000;
    let chars = 0;
    for (const t of unique) {
      if (chars > limit) { translated = false; break; }
      chars += t.length;
      try {
        const res = await translateFn(t);
        if (res) seen.set(t, res);
      } catch (e) {
        translated = false;
      }
    }
    for (const b of targets) {
      if (seen.has(b.text)) b.text = seen.get(b.text);
    }
  }

  return { blocks, questions, caption, workshop, translated, lang: lang || 'zh' };
}

module.exports = { compose, translateLabels };
