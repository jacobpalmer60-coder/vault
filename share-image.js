/* ============================================================
   SHARE IMAGES (user, 2026-11-05)
   A clean picture of a trade's verdict or a week's recap, to post in a league chat. Drawn on a
   canvas rather than captured from the page, so it reads the same from any phone.
   VaultShare.draw({ kicker, title, columns, verdicts, foot }) -> a Promise of a canvas
   VaultShare.send(canvas, fileName, button) shares it, or saves it where sharing isn't offered.
   ============================================================ */
const VaultShare = {
  W: 1200,
  COLORS: { bg: '#0c0d10', panel: '#14161a', line: 'rgba(255,255,255,0.09)', text: '#ececef', soft: '#a8a8b1', gold: '#e3b04b' },
  // The text that fits the width, with an ellipsis if it had to be cut.
  fit(ctx, text, width) {
    let s = String(text);
    if (ctx.measureText(s).width <= width) return s;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > width) s = s.slice(0, -1);
    return `${s}…`;
  },
  async draw({ kicker, title, columns = [], verdicts = [], foot = '' }) {
    // As tall as what's on it, so a one-for-one isn't mostly empty boxes.
    const { W, COLORS: c } = VaultShare, canvas = document.createElement('canvas');
    const rows = Math.min(5, Math.max(1, ...columns.map(col => col.items.length))), panelH = 84 + rows * 44, H = (title ? 184 : 150) + panelH + (verdicts.length ? 116 : 16) + 62;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d'), display = '"Barlow Condensed", Inter, sans-serif', body = 'Inter, system-ui, sans-serif';
    await Promise.all([document.fonts?.load(`600 40px "Barlow Condensed"`), document.fonts?.load('500 24px Inter')]).catch(() => {});
    ctx.fillStyle = c.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = c.gold; ctx.fillRect(0, 0, W, 6);
    const logo = await new Promise(done => { const im = new Image(); im.onload = () => done(im); im.onerror = () => done(null); im.src = 'brand/vault-dial-128.png'; });
    if (logo) ctx.drawImage(logo, 56, 40, 52, 52);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = c.text; ctx.font = `600 34px ${display}`; ctx.fillText('The Vault', 122, 78);
    ctx.fillStyle = c.soft; ctx.font = `500 22px ${body}`; ctx.textAlign = 'right'; ctx.fillText(VaultShare.fit(ctx, kicker || '', 760), W - 56, 74); ctx.textAlign = 'left';
    let y = 150;
    if (title) { ctx.fillStyle = c.text; ctx.font = `600 52px ${display}`; ctx.fillText(VaultShare.fit(ctx, title, W - 112), 56, y); y += 34; }
    // One panel a column.
    const gap = 24, n = Math.max(1, columns.length), colW = (W - 112 - gap * (n - 1)) / n;
    columns.forEach((col, i) => {
      const x = 56 + i * (colW + gap);
      ctx.fillStyle = c.panel; ctx.strokeStyle = c.line; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x, y, colW, panelH, 16); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c.soft; ctx.font = `500 22px ${body}`; ctx.fillText(VaultShare.fit(ctx, col.head, colW - 48), x + 24, y + 42);
      ctx.fillStyle = c.text; ctx.font = `600 ${col.items.length > 4 ? 26 : 30}px ${body}`;
      const shown = col.items.slice(0, 5), step = 44;
      shown.forEach((item, k) => ctx.fillText(VaultShare.fit(ctx, k === 4 && col.items.length > 5 ? `and ${col.items.length - 4} more` : item, colW - 48), x + 24, y + 84 + k * step));
    });
    y += panelH + 16;
    verdicts.forEach((v, i) => {
      const x = 56 + i * ((W - 112 + gap) / verdicts.length);
      ctx.fillStyle = c.soft; ctx.font = `500 20px ${body}`; ctx.fillText(VaultShare.fit(ctx, `For ${v.who}`, colW - 24), x + 24, y + 28);
      ctx.fillStyle = v.color || c.text; ctx.font = `600 44px ${display}`; ctx.fillText(v.label, x + 24, y + 74);
    });
    ctx.fillStyle = c.soft; ctx.font = `500 20px ${body}`; ctx.fillText(VaultShare.fit(ctx, foot, W - 112), 56, H - 34);
    return canvas;
  },
  async send(canvas, fileName, btn) {
    const blob = await new Promise(done => canvas.toBlob(done, 'image/png'));
    const file = new File([blob], fileName, { type: 'image/png' });
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'The Vault' }); return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: fileName });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    if (btn) { const was = btn.textContent; btn.textContent = 'Saved'; setTimeout(() => { btn.textContent = was; }, 1600); }
  }
};
