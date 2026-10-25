// Vercel serverless function: AI character edit via Cloudflare Workers AI (free tier).
// Env: CF_ACCOUNT_ID, CF_API_TOKEN, CF_MODEL (optional override).
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'method' }); return; }
  const acc = process.env.CF_ACCOUNT_ID, tok = process.env.CF_API_TOKEN;
  if (!acc || !tok) { res.status(200).json({ ok: false, error: 'no-credentials' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const image = body && body.image, prompt = body && body.prompt;
  if (!image || !prompt || !image.startsWith('data:image')) { res.status(200).json({ ok: false, error: 'bad-input' }); return; }
  const model = process.env.CF_MODEL || '@cf/black-forest-labs/flux-2-klein-4b';
  try {
    const b64 = image.slice(image.indexOf(',') + 1);
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 6 * 1024 * 1024) { res.status(200).json({ ok: false, error: 'too-big' }); return; }
    const fd = new FormData();
    fd.append('prompt', prompt);
    fd.append('input_image_0', new Blob([buf], { type: 'image/jpeg' }), 'input.jpg');
    fd.append('width', '768');
    fd.append('height', '1024');
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 50000);
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/${model}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tok}` },
      body: fd,
      signal: ctrl.signal
    });
    clearTimeout(to);
    const ct = r.headers.get('content-type') || '';
    if (r.ok && (ct.includes('image') || ct.includes('octet-stream'))) {
      const out = Buffer.from(await r.arrayBuffer());
      res.status(200).json({ ok: true, image: 'data:image/png;base64,' + out.toString('base64') });
      return;
    }
    if (r.ok && ct.includes('json')) {
      try {
        const j = await r.json();
        const b64 = j && j.result && j.result.image;
        if (b64) {
          const mime = b64.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
          res.status(200).json({ ok: true, image: 'data:' + mime + ';base64,' + b64 });
          return;
        }
        res.status(200).json({ ok: false, error: 'cf-json-noimage', detail: JSON.stringify(j).slice(0, 300) });
        return;
      } catch (e) {}
    }
    let errTxt = '';
    try { errTxt = (await r.text()).slice(0, 400); } catch (e) {}
    res.status(200).json({ ok: false, error: 'cf-' + r.status, detail: errTxt });
  } catch (e) {
    res.status(200).json({ ok: false, error: e.name === 'AbortError' ? 'timeout' : 'exception', detail: String(e).slice(0, 200) });
  }
}
