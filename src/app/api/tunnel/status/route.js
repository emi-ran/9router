import { NextResponse } from "next/server";
import { getTunnelStatus, getDownloadStatus } from "@/lib/tunnel";

const STATUS_CACHE_TTL_MS = 3000; // coalesce rapid polls; underlying probes already cache 10s

// Survive hot reload; one cache per process. Only tunnel probes are cached —
// download progress stays live so the enable/download UI updates smoothly.
const statusCache = (global.__tunnelStatusCache ??= { value: null, fetchedAt: 0 });

export async function GET() {
  try {
    let probes = statusCache.value;
    if (!probes || Date.now() - statusCache.fetchedAt >= STATUS_CACHE_TTL_MS) {
      probes = { tunnel: await getTunnelStatus() };
      statusCache.value = probes;
      statusCache.fetchedAt = Date.now();
    }
    const download = getDownloadStatus();
    return NextResponse.json({ tunnel: probes.tunnel, download });
  } catch (error) {
    console.error("Tunnel status error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
