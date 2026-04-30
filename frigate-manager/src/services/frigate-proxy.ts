// ============================================================
// IA Cloud Vision — Frigate Proxy Service
// Routes requests to the correct Frigate instance per tenant
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { getBaseUrl, getInstanceByTenantId } from './instance-registry';

/**
 * Express middleware that proxies all requests under /api/frigate/*
 * to the correct Frigate instance based on the tenant context.
 *
 * Usage in your Express app:
 *   app.use('/api/frigate', tenantResolver, frigateProxyMiddleware);
 *
 * The tenant ID should be set on req.headers['x-tenant-id'] or
 * resolved by the tenantResolver middleware from JWT.
 */
export async function frigateProxyMiddleware(
  req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> {
  const tenantId = req.headers['x-tenant-id'] as string;

  if (!tenantId) {
    res.status(401).json({ error: 'Missing tenant context (x-tenant-id header)' });
    return;
  }

  const baseUrl = getBaseUrl(tenantId);

  if (!baseUrl) {
    const instance = getInstanceByTenantId(tenantId);
    if (!instance) {
      res.status(404).json({ error: `No Frigate instance registered for tenant ${tenantId}` });
    } else {
      res.status(503).json({
        error: `Frigate instance for tenant "${instance.tenantName}" is not available`,
        status: instance.status,
      });
    }
    return;
  }

  // Build the target URL: strip the /api/frigate prefix and forward to Frigate's /api/*
  // Example: /api/frigate/events → http://frigate-host:5000/api/events
  const frigateApiPath = req.originalUrl.replace(/^\/api\/frigate/, '/api');
  const targetUrl = `${baseUrl}${frigateApiPath}`;

  try {
    // Forward the request to the Frigate instance
    const fetchOptions: RequestInit = {
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] ?? 'application/json',
        'Accept': req.headers['accept'] ?? '*/*',
      },
    };

    // Forward body for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
    fetchOptions.signal = controller.signal;

    const frigateResponse = await fetch(targetUrl, fetchOptions);
    clearTimeout(timeout);

    // Get response content type to handle binary (images/video) vs JSON
    const contentType = frigateResponse.headers.get('content-type') ?? '';

    // Set response headers
    res.status(frigateResponse.status);
    if (contentType) res.setHeader('Content-Type', contentType);

    // Forward cache headers from Frigate
    const cacheControl = frigateResponse.headers.get('cache-control');
    if (cacheControl) res.setHeader('Cache-Control', cacheControl);

    if (contentType.includes('application/json')) {
      // JSON response — parse and forward
      const data = await frigateResponse.json();
      res.json(data);
    } else if (
      contentType.includes('image/') ||
      contentType.includes('video/') ||
      contentType.includes('application/octet-stream')
    ) {
      // Binary response (snapshots, clips, recordings) — stream through
      const buffer = Buffer.from(await frigateResponse.arrayBuffer());
      res.send(buffer);
    } else {
      // Text or other — forward as text
      const text = await frigateResponse.text();
      res.send(text);
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      res.status(504).json({ error: 'Frigate instance request timed out' });
    } else {
      console.error(`[FrigateProxy] Error proxying to ${targetUrl}:`, err.message);
      res.status(502).json({
        error: 'Failed to communicate with Frigate instance',
        detail: err.message,
      });
    }
  }
}

/**
 * Dedicated proxy for live video streams (WebSocket upgrade for WebRTC/MSE).
 * This handles the go2rtc WebSocket connections per tenant.
 *
 * Usage:
 *   app.use('/api/frigate/ws', tenantResolver, frigateWebSocketProxy);
 */
export function getFrigateStreamUrl(tenantId: string, cameraName: string): string | null {
  const baseUrl = getBaseUrl(tenantId);
  if (!baseUrl) return null;

  // go2rtc stream URL via Frigate's built-in proxy
  return `${baseUrl}/api/go2rtc/ws?src=${encodeURIComponent(cameraName)}`;
}

/**
 * Get the snapshot URL for a specific camera of a tenant
 */
export function getFrigateSnapshotUrl(tenantId: string, cameraName: string): string | null {
  const baseUrl = getBaseUrl(tenantId);
  if (!baseUrl) return null;
  return `${baseUrl}/api/${cameraName}/latest.jpg`;
}
