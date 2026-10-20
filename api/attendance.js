export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  const accessCode = process.env.APP_ACCESS_CODE;

  if (!url || !secret || !accessCode) {
    return res.status(500).json({
      error: "Server is not configured. Add APPS_SCRIPT_URL, APPS_SCRIPT_SECRET, and APP_ACCESS_CODE in Vercel Environment Variables."
    });
  }

  if (typeof req.body?.accessCode !== "string" || req.body.accessCode !== accessCode) {
    return res.status(401).json({ error: "Incorrect access code." });
  }

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...req.body, secret }),
      redirect: "follow"
    });

    const raw = await upstream.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        error: "Google Apps Script returned an unexpected response. Check that the web app is deployed and accessible."
      });
    }

    if (!upstream.ok || data.ok === false) {
      return res.status(upstream.ok ? 400 : 502).json({
        error: data.error || "The attendance service could not complete the request."
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(502).json({
      error: "Could not reach Google Apps Script. Check the deployment URL and try again."
    });
  }
}
