// netlify/functions/merge-png.js
const sharp = require("sharp");
const { fetch } = require("undici");

exports.handler = async (event) => {
  // CORS
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Use POST" }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    // Expected body:
    // {
    //   "width": 600, "height": 400,
    //   "background": "#00000000",
    //   "images": [
    //     { "src": "https://...", "x": 0, "y": 0, "w": 600, "h": 400 },
    //     { "src": "https://...", "x": 50, "y": 50, "w": 200, "h": 200 }
    //   ]
    // }

    const W = body.width ?? 600;
    const H = body.height ?? 400;
    const bg = body.background ?? "#00000000";
    const items = Array.isArray(body.images) ? body.images : [];
    if (!items.length) throw new Error("images[] required");

    // Build layers
    const layers = [];
    for (const item of items) {
      const { src, x = 0, y = 0, w, h } = item || {};
      if (!src) continue;

      const buf = await sourceToBuffer(src);
      let img = sharp(buf).png();
      const meta = await img.metadata();
      const targetW = w ?? meta.width;
      const targetH = h ?? meta.height;

      const resized = await img
        .resize({ width: targetW, height: targetH, fit: "cover" })
        .toBuffer();

      layers.push({ input: resized, left: Math.round(x), top: Math.round(y) });
    }

    // Compose
    const base = sharp({ create: { width: W, height: H, channels: 4, background: bg } }).png();
    const out = await base.composite(layers).png().toBuffer();

    // Return data URL (easy to save in Bubble via Base64→File)
    const dataUrl = "data:image/png;base64," + out.toString("base64");

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ width: W, height: H, dataUrl }),
    };
  } catch (err) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
};

async function sourceToBuffer(src) {
  if (typeof src === "string" && src.startsWith("data:image/")) {
    const base64 = src.split(",")[1];
    return Buffer.from(base64, "base64");
  }
  const r = await fetch(src);
  if (!r.ok) throw new Error(`Fetch failed ${r.status} for ${src}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}
