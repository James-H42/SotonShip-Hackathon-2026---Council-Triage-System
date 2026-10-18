import crypto from "node:crypto";
import { getOfficer } from "../auth";
import { config } from "../config";

/**
 * External AI services authenticate with the `x-integration-key` header.
 * Signed-in officers may also call these endpoints (for the integrations page).
 * With no key configured, access is only allowed outside production.
 */
export async function integrationAuth(request: Request): Promise<Response | null> {
  const key = request.headers.get("x-integration-key");
  if (config.integrationApiKey && key) {
    const a = Buffer.from(key);
    const b = Buffer.from(config.integrationApiKey);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return null;
    return Response.json({ error: "Invalid integration key" }, { status: 401 });
  }
  if (await getOfficer()) return null;
  if (!config.integrationApiKey && process.env.NODE_ENV !== "production") return null;
  return Response.json({ error: "Missing x-integration-key header" }, { status: 401 });
}
