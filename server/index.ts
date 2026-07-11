import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });

const app = express();
const port = Number(process.env.PORT ?? 8787);
const region = process.env.HAI_REGION === 'us' ? 'us' : 'eu';
const apiBase = region === 'us' ? 'https://agp.hcompany.ai/api/v2' : 'https://agp.eu.hcompany.ai/api/v2';
const hEnabled = process.env.HCOMPUTER_ENABLED !== 'false';
const apiKey = process.env.HAI_API_KEY;
const publicAppUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/, '');

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

const sendHRequest = async (pathname: string, init?: RequestInit) => {
  if (!apiKey) throw new Error('HAI_API_KEY is not configured.');
  const response = await fetch(`${apiBase}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
  if (!response.ok) {
    const error = new Error(`H Computer request failed with ${response.status}.`);
    Object.assign(error, { status: response.status, body });
    throw error;
  }
  return body;
};

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, service: 'arcflash-copilot', timestamp: new Date().toISOString() });
});

app.get('/api/hcomputer/status', (_request, response) => {
  const configured = Boolean(hEnabled && apiKey && publicAppUrl);
  response.json({
    configured,
    reachable: Boolean(apiKey),
    targetConfigured: Boolean(publicAppUrl),
    region,
    mode: configured ? 'cloud' : 'demo',
    message: configured
      ? 'H Computer cloud execution is ready.'
      : !apiKey
        ? 'Add HAI_API_KEY on the server to enable cloud execution.'
        : !publicAppUrl
          ? 'Add PUBLIC_APP_URL so the cloud browser can reach the study workbench.'
          : 'H Computer execution is disabled by configuration.',
  });
});

app.post('/api/hcomputer/sessions', async (_request: Request, response: Response) => {
  if (!hEnabled || !apiKey || !publicAppUrl) {
    response.status(503).json({
      code: 'HCOMPUTER_NOT_CONFIGURED',
      message: 'Cloud execution requires HAI_API_KEY and a publicly reachable PUBLIC_APP_URL. Use deterministic demo mode on localhost.',
    });
    return;
  }

  try {
    const targetUrl = `${publicAppUrl}/study?operator=h-computer&project=CV-104`;
    const prompt = [
      `Open ${targetUrl}.`,
      'You are collecting evidence for a draft arc-flash report, not performing engineering judgment.',
      'In the OpenGrid Study Workbench: open project CV-104, verify Study Case A, open Arc Flash, and inspect SWGR-01, MCC-01, and CV-104 in that order.',
      'For each equipment result, click Capture evidence. Never invent a missing value.',
      'When MCC-01 shows no breaker clearing time, flag it for engineer review.',
      'Finally click Generate draft and stop when the Engineer review required gate appears.',
    ].join(' ');

    const session = await sendHRequest('/sessions', {
      method: 'POST',
      body: JSON.stringify({
        agent: 'h/web-surfer-flash',
        messages: [{ type: 'user_message', message: prompt }],
      }),
    });
    response.status(201).json(session);
  } catch (error) {
    const known = error as Error & { status?: number; body?: unknown };
    response.status(known.status ?? 502).json({
      code: 'HCOMPUTER_SESSION_FAILED',
      message: known.message,
      detail: known.body,
    });
  }
});

app.get('/api/hcomputer/sessions/:id', async (request: Request, response: Response) => {
  try {
    const sessionId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
    const snapshot = await sendHRequest(`/sessions/${encodeURIComponent(sessionId)}`);
    response.json(snapshot);
  } catch (error) {
    const known = error as Error & { status?: number; body?: unknown };
    response.status(known.status ?? 502).json({ code: 'HCOMPUTER_POLL_FAILED', message: known.message, detail: known.body });
  }
});

app.get('/api/hcomputer/sessions/:id/changes', async (request: Request, response: Response) => {
  try {
    const fromIndex = Number.isFinite(Number(request.query.from_index)) ? Number(request.query.from_index) : 0;
    const sessionId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
    const changes = await sendHRequest(`/sessions/${encodeURIComponent(sessionId)}/changes?from_index=${fromIndex}&wait_for_seconds=1`, {
      headers: { Accept: 'application/json' },
    });
    response.json(changes ?? { new_events: [], status: 'running' });
  } catch (error) {
    const known = error as Error & { status?: number; body?: unknown };
    response.status(known.status ?? 502).json({ code: 'HCOMPUTER_CHANGES_FAILED', message: known.message, detail: known.body });
  }
});

if (process.env.NODE_ENV === 'production') {
  const currentFile = fileURLToPath(import.meta.url);
  const distPath = path.resolve(path.dirname(currentFile), '../dist');
  app.use(express.static(distPath));
  app.use((_request, response) => response.sendFile(path.join(distPath, 'index.html')));
}

app.listen(port, () => {
  console.log(`ArcFlash Copilot API listening on http://localhost:${port}`);
});
