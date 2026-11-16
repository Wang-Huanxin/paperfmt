const cache = new Map();

function hasChinese(s) { return /[\u4e00-\u9fff]/.test(s || ''); }

function chunk(text, size = 420) {
  const parts = [];
  let cur = '';
  const pieces = text.split(/(?<=[。！？；;.!?])\s*/);
  for (const p of pieces) {
    if ((cur + p).length > size && cur) { parts.push(cur); cur = p; }
    else cur += p;
  }
  if (cur) parts.push(cur);
  return parts;
}

async function translateOnce(text) {
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=zh-CN|en';
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error('translate http ' + res.status);
  const json = await res.json();
  if (json.responseStatus !== 200) throw new Error('translate status ' + json.responseStatus);
  const t = json.responseData && json.responseData.translatedText;
  if (!t) throw new Error('empty translation');
  return t;
}

async function translateText(text) {
  if (!text || !hasChinese(text)) return text;
  if (cache.has(text)) return cache.get(text);
  const parts = chunk(text);
  const out = [];
  for (const p of parts) {
    try {
      out.push(await translateOnce(p));
    } catch (e) {
      cache.set(text, text);
      return text;
    }
  }
  const result = out.join(' ');
  cache.set(text, result);
  return result;
}

module.exports = { translateText };
