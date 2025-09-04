// netlify/functions/merge-png.js
// v1 Netlify Function (CommonJS) — ALWAYS side-by-side, returns PNG binary
const sharp = require("sharp");
const { fetch } = require("undici");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...cors(), "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Use POST" }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    // expected payload:
    // {
    //   "images": [{ "src": "https://..." }, { "src": "https://..." }, ...],
    //   "height": 400,           // optional: target height for ALL items
    //   "gap": 0,                // optional px gap between items (default 0)
    //   "padding": 0,            // optional px padding around the strip (default 0)
    //   "background": "#0000"    // optional CSS color/hex (default transparent)
    // }

    const items = Array.isArray(body.images) ? body.images : [];
    if (!items.length) throw new Error("images[] required");

    const gap = Number.isFinite(body.gap) ? Math.max(0, body.gap) : 0;
    const padding = Number.isFinite(body.padding) ? Math.max(0, body.padding) : 0;
    const background = body.background ?? "#00000000";

    // fetch all sources and read metadata
    const srcBuffers = await Promise.all(items.map(i => sourceToBuffer(i.src)));
    const metas = await Promise.all(srcBuffers.map(b => sharp(b).metadata()));

    // choose the common height
    const targetH = Number.isFinite(body.height) && body.height > 0
      ? Math.floor(body.height)
      : Math.max(...metas.map(m => m.height || 0));

    if (!targetH || !isFinite(targetH)) throw new Error("Could not determine common height");

    // resize each to the common height (aspect preserved), collect widths
    const resized = await Promise.all(srcBuffers.map(async (buf) => {
      const r = await sharp(buf).resize({ height: targetH }).png().toBuffer();
      const meta = await sharp(r).metadata();
      return { buf: r, w: meta.width || 0, h: meta.height || targetH };
    }));

    // compute canvas width = sum(widths) + gaps + padding*2; height = targetH + padding*2
    const totalWidth = resized.reduce((sum, r) => sum + (r.w || 0), 0) + gap * Math.max(0, resized.length - 1) + padding * 2;
    const totalHeight = targetH + padding * 2;

    // build layers (side-by-side)
    const layers = [];
    let x = padding;
    for (const r of resized) {
      layers.push({ input: r.buf, left: Math.round(x), top: Math.round(padding) });
      x += (r.w || 0) + gap;
    }

    // compose
    const base = sharp({
      create: { width: Math.max(1, totalWidth), height: Math.max(1, totalHeight), channels: 4, background }
    }).png();

    const out = await base.composite(layers).png().toBuffer();

    // return binary PNG (Bubble API Connector: Use as File)
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
    return {
      statusCode: 400,
      headers: { ...cors(), "Content-Type": "application/json" },
      body: JSON.stringify({ error: e.message || String(e) })
    };
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
  if (src.startsWith("data:image/")) {
    return Buffer.from(src.split(",")[1], "base64");
  }
  const r = await fetch(src);
  if (!r.ok) throw new Error(`Fetch ${r.status} for ${src}`);
  return Buffer.from(await r.arrayBuffer());
}
