import { createHash } from "node:crypto";

function sha256(value) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}
function clean(value, max = 2000) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // IMPORTANT: call this endpoint from your trusted signup backend, not directly
  // from an untrusted APK client. Never embed this secret in the APK.
  const expectedSecret = process.env.APP_SIGNUP_WEBHOOK_SECRET;
  const suppliedSecret = req.headers["x-signup-webhook-secret"];
  if (!expectedSecret || suppliedSecret !== expectedSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;
  const graphVersion = process.env.META_GRAPH_API_VERSION || "v23.0";
  if (!redisUrl || !redisToken || !pixelId || !accessToken) {
    return res.status(500).json({ error: "Server configuration incomplete" });
  }

  try {
    const body = req.body || {};
    const attributionId = clean(body.attributionId, 100);
    const signupId = clean(body.signupId, 200);
    if (!attributionId || !signupId) {
      return res.status(400).json({ error: "attributionId and signupId are required" });
    }

    const redisBase = redisUrl.replace(/\/$/, "");
    const auth = { Authorization: `Bearer ${redisToken}` };
    const getUrl = `${redisBase}/get/${encodeURIComponent(`android_attr:${attributionId}`)}`;
    const lookup = await fetch(getUrl, { headers: auth });
    if (!lookup.ok) throw new Error("Redis lookup failed");
    const lookupJson = await lookup.json();
    if (!lookupJson.result) return res.status(404).json({ error: "Attribution not found or expired" });

    const attr = typeof lookupJson.result === "string" ? JSON.parse(lookupJson.result) : lookupJson.result;
    // Prevent repeated delivery for the same verified signup ID.
    const dedupeKey = `android_signup_sent:${signupId}`;
    const dedupeUrl = `${redisBase}/set/${encodeURIComponent(dedupeKey)}/1/NX/EX/2592000`;
    const dedupe = await fetch(dedupeUrl, { method: "POST", headers: auth });
    if (!dedupe.ok) throw new Error("Redis deduplication failed");
    const dedupeResult = (await dedupe.json()).result;
    if (dedupeResult !== "OK") return res.status(200).json({ ok: true, duplicate: true });

    const eventId = `signup_${signupId}`;
    const userData = {};
    // Optional matching data should be collected with proper notice/consent.
    // Do not send raw phone/email. This endpoint hashes email if supplied.
    const email = clean(body.email, 320);
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) userData.em = [sha256(email)];

    if (attr.fbp) userData.fbp = attr.fbp;
    if (attr.fbc) userData.fbc = attr.fbc;

    const event = {
      event_name: "CompleteRegistration",
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: "app",
      user_data: userData,
      custom_data: { content_name: "Android app signup" }
    };
    if (process.env.META_TEST_EVENT_CODE) event.test_event_code = process.env.META_TEST_EVENT_CODE;

    const metaResponse = await fetch(
      `https://graph.facebook.com/${graphVersion}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: [event] })
      }
    );
    const result = await metaResponse.json();

    if (!metaResponse.ok || !(Number(result.events_received) > 0)) {
      // Release dedupe key so a legitimate retry can occur.
      await fetch(`${redisBase}/del/${encodeURIComponent(dedupeKey)}`, { method: "POST", headers: auth });
      console.error("Meta CAPI rejected signup event", { status: metaResponse.status, result });
      return res.status(502).json({ error: "Meta did not confirm event receipt" });
    }

    // Mark the attribution as converted for reporting. Keep the original record until expiry.
    attr.status = "signup_sent";
    attr.signupEventId = eventId;
    await fetch(
      `${redisBase}/set/${encodeURIComponent(`android_attr:${attributionId}`)}/${encodeURIComponent(JSON.stringify(attr))}/EX/604800`,
      { method: "POST", headers: auth }
    );

    console.log("Meta signup event received", {
      event_name: event.event_name,
      event_id: eventId,
      events_received: result.events_received,
      attributionId
    });
    return res.status(200).json({ ok: true, eventId, events_received: result.events_received });
  } catch (error) {
    console.error("app-signup failed", error.message);
    return res.status(502).json({ error: "Signup event processing failed" });
  }
}