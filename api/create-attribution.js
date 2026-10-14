import { randomUUID } from "node:crypto";

function clean(value, max = 500) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    return res.status(500).json({ error: "Redis/KV is not configured" });
  }

  try {
    const body = req.body || {};
    const attributionId = randomUUID();
    const record = {
      attributionId,
      createdAt: new Date().toISOString(),
      fbclid: clean(body.fbclid, 2000),
      fbc: clean(body.fbc, 2000),
      fbp: clean(body.fbp, 2000),
      utm_source: clean(body.utm_source, 200),
      utm_campaign: clean(body.utm_campaign, 500),
      utm_medium: clean(body.utm_medium, 200),
      utm_content: clean(body.utm_content, 500),
      status: "pending"
    };

    const key = `android_attr:${attributionId}`;
    const url = `${redisUrl.replace(/\/$/, "")}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(record))}/EX/604800`;
    const saved = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${redisToken}` }
    });
    if (!saved.ok) throw new Error("Redis write failed");

    return res.status(200).json({ attributionId });
  } catch (error) {
    console.error("create-attribution failed", error.message);
    return res.status(502).json({ error: "Could not save attribution" });
  }
}