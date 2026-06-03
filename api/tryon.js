const FASHN_BASE = "https://api.fashn.ai/v1";

export default async function handler(req, res) {
  // ---- CORS (allow your storefront to call this) ----
  const origin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")  return res.status(405).json({ error: "POST only" });

  const key = process.env.FASHN_API_KEY;
  if (!key) return res.status(500).json({ error: "FASHN_API_KEY is not set on the server" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { model_image, garment_image, category } = body;
    if (!model_image || !garment_image) {
      return res.status(400).json({ error: "model_image and garment_image are required" });
    }

    // 1) Start the try-on job
    const start = await fetch(`${FASHN_BASE}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model_name: "tryon-v1.6",
        inputs: {
          model_image,                       // customer photo (data URL or https URL)
          garment_image,                     // product photo URL
          category: category || "auto",      // auto | tops | bottoms | one-pieces
          mode: "performance",               // fast interactive mode (~5-8s)
          moderation_level: "conservative"   // stricter modesty — appropriate for a kids' store
        }
      })
    });
    const startData = await start.json();
    if (!start.ok || !startData.id) {
      return res.status(502).json({ error: startData.error || "try-on engine rejected the request" });
    }

    // 2) Poll until the job finishes (timeout ~60s)
    const id = startData.id;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1500));
      const poll = await fetch(`${FASHN_BASE}/status/${id}`, {
        headers: { "Authorization": `Bearer ${key}` }
      });
      const data = await poll.json();
      if (data.status === "completed") {
        const url = Array.isArray(data.output) ? data.output[0] : data.output;
        return res.status(200).json({ resultImageUrl: url });
      }
      if (data.status === "failed") {
        return res.status(502).json({ error: data.error || "try-on generation failed" });
      }
      // otherwise: starting / in_queue / processing -> keep waiting
    }
    return res.status(504).json({ error: "try-on timed out" });

  } catch (err) {
    return res.status(500).json({ error: String(err && err.message || err) });
  }
}
