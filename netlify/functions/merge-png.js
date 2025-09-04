// netlify/functions/merge-png.js
import sharp from "sharp";
import { fetch } from "undici";

export default async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Use POST" }));
      return;
    }

    const body = await getJson(req);
    // Expected payload:
    // {
    //   "width": 600, "height": 400,
    //   "background": "#00000000",   // optional (CSS color or hex); default transparent
    //   "images": [
    //     { "src": "https://...", "x": 0, "y": 0, "w": 600, "h": 400 },   // background
    //     { "src": "https://...", "x": 50, "y": 50, "w": 200, "h": 200 }  // overlay(s)
    //   ]
    // }

    const W = body.width ?? 600;
    const H = body.height ?? 400;
    const bg = body.background ?? "#00000000";
    const items = Array.isArray(body.images) ? body.images : [];
    if (!items.length) throw new Error("images[] required");

    // Prepare composite layers
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

    // Create base and composite
    const base = sharp({
      create: { width: W, height: H, channels: 4, background: bg }
    }).png();

    const out = await base.composite(layers).png().toBuffer();

    // Return base64 data URL (best for Bubble → Base64→File)
    const dataUrl =
      "data:image/png;base64," + out.toString("base64");

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ width: W, height: H, dataUrl }));
  } catch (err) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: err.message || String(err) }));
  }
};

async function getJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(raw); } catch { throw new Error("Invalid JSON"); }
}

async function sourceToBuffer(src) {
  // Accept data URLs or regular URLs
  if (typeof src === "string" && src.startsWith("data:image/")) {
    const base64 = src.split(",")[1];
    return Buffer.from(base64, "base64");
  }
  const r = await fetch(src);
  if (!r.ok) throw new Error(`Fetch failed ${r.status} for ${src}`);
  return Buffer.from(await r.arrayBuffer());
}
