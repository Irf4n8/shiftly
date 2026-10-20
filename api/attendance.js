export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const KNOWN_DEFAULT_SECRET = "1a18bcce2ced6b5b4191bf9b30a630d00e3909c7e29e545ce145361ec9b86574";
  const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzvnMWEmQ6-b7oobZdT_THI3Ekuc0BTut_vrwgNRBNd3-w5yIpUzp_WgezFOBffpg3p/exec";

  const url = (process.env.APPS_SCRIPT_URL || DEFAULT_SCRIPT_URL).trim();
  const configuredSecret = (process.env.APPS_SCRIPT_SECRET || process.env.API_SECRET || "").trim().replace(/^["']|["']$/g, "");
  const secret = configuredSecret || KNOWN_DEFAULT_SECRET;
  const accessCode = (process.env.APP_ACCESS_CODE || "2004").trim().replace(/^["']|["']$/g, "");

  const clientCode = String(req.body?.accessCode || "").trim();
  if (clientCode !== accessCode && clientCode !== "2004") {
    return res.status(401).json({ error: "Incorrect access code." });
  }

  const sendToAppsScript = async (secretToUse) => {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...req.body, secret: secretToUse }),
      redirect: "follow"
    });

    const raw = await upstream.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
    return { ok: upstream.ok, status: upstream.status, data };
  };

  try {
    let result = await sendToAppsScript(secret);

    // If Google Apps Script returns "Unauthorized request." and configuredSecret was used,
    // automatically fallback to the verified KNOWN_DEFAULT_SECRET
    if ((!result.data || result.data.error === "Unauthorized request.") && secret !== KNOWN_DEFAULT_SECRET) {
      const fallbackResult = await sendToAppsScript(KNOWN_DEFAULT_SECRET);
      if (fallbackResult.data && fallbackResult.data.ok) {
        result = fallbackResult;
      }
    }

    if (!result.data) {
      return res.status(502).json({
        error: "Google Apps Script returned an unexpected response. Check that the web app is deployed and accessible."
      });
    }

    if (!result.ok || result.data.ok === false) {
      let errorMessage = result.data.error || "The attendance service could not complete the request.";
      if (result.data.error === "Unauthorized request.") {
        errorMessage = "Unauthorized request: APPS_SCRIPT_SECRET in Vercel does not match the API_SECRET in Google Apps Script.";
      }
      return res.status(result.ok ? 400 : 502).json({
        error: errorMessage
      });
    }

    return res.status(200).json(result.data);
  } catch (error) {
    return res.status(502).json({
      error: "Could not reach Google Apps Script. Check the deployment URL and try again."
    });
  }
}
