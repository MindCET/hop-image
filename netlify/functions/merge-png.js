// v1 Netlify Function (CommonJS) — returns PNG binary
const sharp = require("sharp");
const { fetch } = require("undici");

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Use POST" }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const W = body.width ?? 600;
    const H = body.height ?? 400;
    const bg = body.background ?? "#00000000";
    const items = Array.isArray(body.images) ? body.images : [];
    if (!items.length) throw new Error("images[] required");

    const layers = [];
    for (const it of items) {
      const { src, x = 0, y = 0, w, h } = it || {};
      if (!src) continue;
      const buf = await sourceToBuffer(src);
      const img = sharp(buf).png();
      const meta = await img.metadata();
      const targetW = w ?? meta.width;
      const targetH = h ?? meta.height;
      const resized = await img.resize({ width: targetW, height: targetH, fit: "cover" }).toBuffer();
      layers.push({ input: resized, left: Math.round(x), top: Math.round(y) });
    }

    const base = sharp({ create: { width: W, height: H, channels: 4, background: bg } }).png();
    const out = await base.composite(layers).png().toBuffer();

    // IMPORTANT: for Netlify v1 binary responses
    return {
      statusCode: 200,
      headers: {
        ...cors,
        "Content-Type": "image/png",
        // Bubble uses this as the filename when “Use as: File”
        "Content-Disposition": `inline; filename="merged-${Date.now()}.png"`
      },
      body: out.toString("base64"),
      isBase64Encoded: true
    };
  } catch (e) {
    return {
      statusCode: 400,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: e.message || String(e) })
    };
  }
};

async function sourceToBuffer(src) {
  if (typeof src === "string" && src.startsWith("data:image/")) {
    return Buffer.from(src.split(",")[1], "base64");
  }
  const r = await fetch(src);
  if (!r.ok) throw new Error(`Fetch ${r.status} for ${src}`);
  return Buffer.from(await r.arrayBuffer());
}
