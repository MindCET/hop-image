// ALWAYS returns a PNG file; dynamic image count; optional wrapping via perRow
const sharp = require("sharp");
const { fetch } = require("undici");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify({ error: "Use POST" }) };

  try {
    const body = JSON.parse(event.body || "{}");
    const items = Array.isArray(body.images) ? body.images : [];
    if (!items.length) throw new Error("images[] required");

    const perRow = Number.isFinite(body.perRow) && body.perRow > 0 ? Math.floor(body.perRow) : 0; // 0 = single row
    const gap = Number.isFinite(body.gap) ? Math.max(0, body.gap) : 0;
    const padding = Number.isFinite(body.padding) ? Math.max(0, body.padding) : 0;
    const background = body.background ?? "#00000000";

    // fetch & read metadata
    const srcBuffers = await Promise.all(items.map(i => sourceToBuffer(i?.src)));
    const metas = await Promise.all(srcBuffers.map(b => sharp(b).metadata()));

    // choose uniform target height
    const targetH = Number.isFinite(body.height) && body.height > 0
      ? Math.floor(body.height)
      : Math.max(...metas.map(m => m.height || 0));
    if (!targetH) throw new Error("Could not determine common height");

    // resize all to targetH (preserve aspect)
    const resized = await Promise.all(srcBuffers.map(async (buf) => {
      const r = await sharp(buf).resize({ height: targetH }).png().toBuffer();
      const meta = await sharp(r).metadata();
      return { buf: r, w: meta.width || 0, h: meta.height || targetH };
    }));

    // build rows (either one long row, or wrap by perRow)
    const rows = [];
    if (!perRow) {
      rows.push(resized);
    } else {
      for (let i = 0; i < resized.length; i += perRow) rows.push(resized.slice(i, i + perRow));
    }

    // compute canvas size
    const rowWidths = rows.map(row => row.reduce((s, it) => s + it.w, 0) + gap * Math.max(0, row.length - 1));
    const maxRowW = rowWidths.length ? Math.max(...rowWidths) : 0;
    const totalW = padding * 2 + maxRowW;
    const totalH = padding * 2 + rows.length * targetH + gap * Math.max(0, rows.length - 1);

    // place layers
    const layers = [];
    let y = padding;
    for (let r = 0; r < rows.length; r++) {
      let x = padding;
      for (const it of rows[r]) {
        layers.push({ input: it.buf, left: Math.round(x), top: Math.round(y) });
        x += it.w + gap;
      }
      y += targetH + gap;
    }

    // compose & return binary PNG
    const base = sharp({
      create: { width: Math.max(1, totalW), height: Math.max(1, totalH), channels: 4, background }
    }).png();

    const out = await base.composite(layers).png().toBuffer();

    return {
      statusCode: 200,
      headers: {
        ...cors(),
        "Content-Type": "image/png",
        "Content-Disposition": `inline; filename="merged-${Date.now()}.png"`
      },
      body: out.toString("base64"),
      isBase64Encoded: true
    };
  } catch (e) {
    return { statusCode: 400, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify({ error: e.message || String(e) }) };
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

async function sourceToBuffer(src) {
  if (!src || typeof src !== "string") throw new Error("image src required");
  if (src.startsWith("data:image/")) return Buffer.from(src.split(",")[1], "base64");
  const r = await fetch(src);
  if (!r.ok) throw new Error(`Fetch ${r.status} for ${src}`);
  return Buffer.from(await r.arrayBuffer());
}
