/* PixMint — image format converter, fully client-side */
'use strict';

/* ---------- pure helpers (Node-testable) ---------- */
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function mimeFor(fmt) {
  const m = MIME[String(fmt).toLowerCase()];
  if (!m) throw new Error('Unsupported output format: ' + fmt);
  return m;
}

function extFor(fmt) { return String(fmt).toLowerCase() === 'jpeg' ? 'jpg' : String(fmt).toLowerCase(); }

function outName(name, fmt) {
  const base = String(name).replace(/\.[^.]+$/, '');
  return base + '.' + extFor(fmt);
}

function clampQuality(q) {
  q = Number(q);
  if (isNaN(q)) return 0.92;
  return Math.min(1, Math.max(0.1, q));
}

function isHeic(name, type) {
  return /heic|heif/i.test(type || '') || /\.(heic|heif)$/i.test(name || '');
}

function isSupportedInput(name, type) {
  if (isHeic(name, type)) return true;
  if (/^image\//.test(type || '')) return true;
  return /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(name || '');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mimeFor, extFor, outName, clampQuality, isHeic, isSupportedInput };
}

/* ---------- browser app ---------- */
if (typeof document !== 'undefined') {
  const $ = id => document.getElementById(id);
  const drop = $('drop'), fileInput = $('file'), list = $('filelist'), go = $('go'), msg = $('msg');
  const outSel = $('outfmt'), qInput = $('quality'), qVal = $('qval');
  let files = []; // {name, bytes, type}

  // ?to=jpg 直达（SEO 落地页跳转用）
  const initTo = new URLSearchParams(location.search).get('to');
  if (initTo && MIME[initTo]) outSel.value = initTo === 'jpeg' ? 'jpg' : initTo;

  qInput.oninput = () => { qVal.textContent = Math.round(qInput.value * 100) + '%'; };
  outSel.onchange = () => { $('q-wrap').style.display = outSel.value === 'png' ? 'none' : 'block'; };

  drop.onclick = () => fileInput.click();
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); };
  fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ''; };

  async function addFiles(fl) {
    for (const f of fl) {
      if (!isSupportedInput(f.name, f.type)) continue;
      files.push({ name: f.name, bytes: await f.arrayBuffer(), type: f.type });
    }
    refresh();
  }

  function refresh() {
    list.innerHTML = '';
    files.forEach((f, i) => {
      const div = document.createElement('div');
      div.className = 'fileitem';
      div.innerHTML = `<span>🖼️</span><span class="name">${f.name}</span><span class="st" id="st${i}"></span><span class="rm" data-i="${i}">✕</span>`;
      list.appendChild(div);
    });
    list.querySelectorAll('.rm').forEach(el => el.onclick = () => { files.splice(+el.dataset.i, 1); refresh(); });
    go.disabled = files.length === 0;
  }

  function say(text, cls) { msg.textContent = text; msg.className = cls || ''; }
  const setSt = (i, t) => { const el = $('st' + i); if (el) el.textContent = t; };

  async function convertOne(f, outFmt, quality) {
    const mime = mimeFor(outFmt);
    if (isHeic(f.name, f.type)) {
      // heic2any: HEIC/HEIF → jpeg/png/webp (wasm, on-device)
      const blob = await heic2any({ blob: new Blob([f.bytes], { type: f.type || 'image/heic' }), toType: mime, quality });
      return await (Array.isArray(blob) ? blob[0] : blob).arrayBuffer();
    }
    // other formats: decode natively, re-encode via canvas
    const bmp = await createImageBitmap(new Blob([f.bytes], { type: f.type }));
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    const ctx = cv.getContext('2d');
    if (mime === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('Encode failed')), mime, quality));
    return await blob.arrayBuffer();
  }

  go.onclick = async () => {
    go.disabled = true;
    const outFmt = outSel.value, quality = clampQuality(qInput.value);
    let done = 0, failed = 0;
    say('Converting…', '');
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setSt(i, '⏳');
      try {
        const bytes = await convertOne(f, outFmt, quality);
        const url = URL.createObjectURL(new Blob([bytes], { type: mimeFor(outFmt) }));
        const a = document.createElement('a');
        a.href = url; a.download = outName(f.name, outFmt); a.click();
        URL.revokeObjectURL(url);
        setSt(i, '✅'); done++;
      } catch (e) {
        setSt(i, '❌'); failed++;
        console.error(f.name, e);
      }
    }
    say(failed === 0 ? `✅ Done — ${done} file(s) converted` : `⚠️ ${done} converted, ${failed} failed`, failed === 0 ? 'ok' : 'err');
    go.disabled = files.length === 0;
  };

  // init
  $('q-wrap').style.display = outSel.value === 'png' ? 'none' : 'block';
}
