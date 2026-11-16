const Q_START = [
  /^(\d{1,2})\s*\*{0,2}\s*[.)、:：]\s*(.*)$/,
  /^(?:Question|Q)\s*(\d{1,2})\s*[.:：)]?\s*(.*)$/i,
  /^第\s*(\d{1,2})\s*题\s*[.:：]?\s*(.*)$/,
];

function questionNumber(line) {
  const t = line.replace(/^\uFEFF/, '');
  const indent = (t.match(/^[ \t]*/) || [''])[0].length;
  const body = t.slice(indent);
  for (const re of Q_START) {
    const m = re.exec(body);
    if (m) {
      const num = Number(m[1]);
      if (num >= 1 && num <= 99) return { num, indent, rest: m[2] || '' };
    }
  }
  return null;
}

function isCodeLine(line) {
  const t = line.trim();
  if (!t) return false;
  if (/^#include|^#define|^using\s+namespace|^class\s|^void\s|^int\s+main|^for\s*\(|^while\s*\(|^if\s*\(|^else|^return\s|^cout\s*<<|^cin\s*>>|^fstream|^myfile|^myfile\.|^picture\[|^pixel_class|^public:|^private:|^};/.test(t)) return true;
  if (/^[{}();]+$/.test(t)) return true;
  if (/^\/\/|^\/\*|\*\/$/.test(t)) return true;
  if (/^(?:int|float|double|char|bool|string|long|short|unsigned|signed|const|static|public|private|protected)\s?[:\s]/.test(t)) return true;
  if (/;\s*(?:\/\/.*)?$/.test(t)) return true;
  if (/^[A-Za-z_][A-Za-z0-9_<>:*&\s\[\]]*\([^)]*\)\s*[;{]/.test(t)) return true;
  if (/;$/.test(t) && /[=<>()]/.test(t) && line.startsWith('  ')) return true;
  return false;
}

function splitQuestions(lines, opts = {}) {
  const repair = [];
  const accepted = [];
  let expected = 1;
  let lastNum = 0;
  for (const line of lines) {
    const cand = questionNumber(line.text);
    if (!cand) continue;
    const num = cand.num;
    if (num === expected) {
      accepted.push({ num, startIndex: line.index, indent: cand.indent, firstText: line.text.trim() });
      expected = num + 1;
      lastNum = num;
    } else if (num === expected - 1 && cand.indent < 2) {
      const fixed = expected;
      accepted.push({ num: fixed, startIndex: line.index, indent: cand.indent, firstText: line.text.trim() });
      repair.push({ type: 'duplicate-number', from: num, to: fixed, message: `源文件题号“${num}”重复出现，已按顺序修正为第 ${fixed} 题，避免与上一题合并` });
      expected = fixed + 1;
      lastNum = fixed;
    } else if (num > expected) {
      accepted.push({ num, startIndex: line.index, indent: cand.indent, firstText: line.text.trim() });
      repair.push({ type: 'gap', from: expected, to: num - 1, message: `源文件缺少第 ${expected}-${num - 1} 题，已按原文题号保留空位` });
      expected = num + 1;
      lastNum = num;
    } else {
      // 小于当前预期且非上一题重复：判为题目内部的小问/子编号，不切分
    }
  }
  const questions = [];
  const gaps = repair.filter(r => r.type === 'gap').flatMap(r => Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i));
  for (let i = 0; i < accepted.length; i++) {
    const cur = accepted[i];
    const next = accepted[i + 1] ? accepted[i + 1].startIndex : lines.length;
    const bodyLines = lines.slice(cur.startIndex, next);
    questions.push({
      number: cur.num,
      indent: cur.indent,
      raw: bodyLines.map(l => l.text),
      firstText: cur.firstText,
      lines: bodyLines,
    });
  }
  return { questions, repair, gaps };
}

function normalizeLines(blocks) {
  const lines = [];
  for (const b of blocks) {
    if (typeof b === 'string') {
      lines.push({ text: b, images: [], index: lines.length });
      continue;
    }
    const text = (b.text || '').replace(/\r/g, '');
    if (text.includes('\n')) {
      const parts = text.split('\n');
      for (const p of parts) {
        lines.push({ text: p, images: b.images || [], index: lines.length });
      }
    } else {
      lines.push({ text, images: b.images || [], index: lines.length });
    }
  }
  return lines;
}

function parseSource(blocks) {
  const lines = normalizeLines(blocks);
  const res = splitQuestions(lines);
  return { lines, questions: res.questions, repair: res.repair, gaps: res.gaps };
}

function cleanQuestionText(q) {
  return q.raw
    .join('\n')
    .replace(/^\uFEFF/, '')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function questionStem(q) {
  const lines = q.raw.slice();
  const first = lines.shift() || '';
  const m = questionNumber(first);
  let stem = (m ? (m.rest || '') : first).trim();
  const more = [];
  for (const l of lines) {
    const t = l.trim();
    if (!t) {
      if (more.length) break;
      continue;
    }
    if (isCodeLine(l)) break;
    if (/^(答|答案|解答|分析|解)[:：]/.test(t)) break;
    more.push(t);
    if (stem.length + more.join(' ').length > 2000) break;
  }
  if (more.length) stem += ' ' + more.join(' ');
  return stem.replace(/\s{2,}/g, ' ').trim();
}

function answerLines(q) {
  const lines = q.raw.slice(1);
  while (lines.length && !lines[0].trim()) lines.shift();
  return lines;
}

function detectSections(text) {
  const out = { problem: null, contentStart: null };
  const lines = text.split('\n');
  for (const l of lines) {
    const t = l.replace(/\s+/g, ' ').trim();
    if (/^[一二三四五六七八九十]+[、.．]\s*(遇到的问题|问题与讨论|分析与讨论|实验总结|结论)/.test(t)) out.problem = t;
  }
  return out;
}

module.exports = { parseSource, questionNumber, isCodeLine, cleanQuestionText, questionStem, answerLines, detectSections, normalizeLines };
