import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const baseUrl = (process.env.QA_BASE_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const artifacts = path.resolve('artifacts', 'electrisim');
await mkdir(artifacts, { recursive: true });

const mockSessionId = 'electrisim-qa-session-001';
const mockAgentViewUrl = `https://platform.hcompany.ai/agents/sessions/${mockSessionId}`;
let sessionStarts = 0;
let sessionReads = 0;
let sessionStops = 0;
let sessionStopped = false;
let calculationRuns = 0;
let screenshotFetches = 0;
const unexpectedCloudStarts = [];
const directScreenshotRequests = [];
const screenshotSource = `https://agp.hcompany.ai/api/v1/trajectories/${mockSessionId}/resources/production-screenshot-bucket/${mockSessionId}/frame-001.png`;
const screenshotPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const runningSession = () => ({
  id: mockSessionId,
  session_id: mockSessionId,
  status: 'running',
  state: 'running',
  agent_view_url: mockAgentViewUrl,
});

const completedSession = () => ({
  ...runningSession(),
  status: 'completed',
  state: 'completed',
  result: {
    success: true,
    message: 'Public Electrisim drawing completed without login, saving, or simulation.',
    checkpoints: [
      'Opened the public Electrisim editor',
      'Created a new untitled schematic diagram without opening an existing project',
      'Confirmed the schematic editor with symbol palette and grid-paper canvas and never entered Map Editor',
      'Located Generator ~, first Transformer, External Grid, Motor M, and Bus in the component palette',
      'Placed Generator, Transformer, two External Grids, and Motor left-to-right across the upper third',
      'Connected Generator, Transformer, both External Grids, and Motor with snapped Bus conductors',
      'Visually confirmed the centered Generator, Transformer, two External Grids, and Motor above the canvas midpoint',
      'Stopped without saving or simulation',
    ],
  },
});

const calculationPayload = {
  schema_version: '1.0',
  generated_at: '2026-07-11T12:00:00Z',
  project: 'CV-104 Conveyor Electrical Distribution',
  study_case: 'Case A — Normal Utility / Main-Tie Open',
  engines: {
    short_circuit: 'pandapower / IEC 60909',
    arc_flash: 'LiaungYip/arcflash / IEEE 1584-2018',
  },
  disclaimer: 'Validation output only. All results require review by a qualified electrical engineer.',
  results: [
    {
      equipment_id: 'SWGR-01',
      source_incident_energy_cal_cm2: 6.3,
      source_boundary_in: 55,
      protective_device_clearing_time_s: 0.087,
      pandapower_bolted_fault_ka: 23.481,
      arcflash_validation: {
        arcing_current_ka: 18.211,
        incident_energy_cal_cm2: 4.721,
        arc_flash_boundary_in: 49.2,
      },
      verification_status: 'calculation_available_for_comparison',
    },
    {
      equipment_id: 'MCC-01',
      source_incident_energy_cal_cm2: 3.6,
      source_boundary_in: 38,
      protective_device_clearing_time_s: null,
      pandapower_bolted_fault_ka: 19.155,
      arcflash_validation: {
        arcing_current_ka: 15.113,
        incident_energy_cal_cm2: null,
        arc_flash_boundary_in: null,
      },
      verification_status: 'engineer_review_required',
    },
    {
      equipment_id: 'CV-104',
      source_incident_energy_cal_cm2: 1.2,
      source_boundary_in: 18,
      protective_device_clearing_time_s: 0.05,
      pandapower_bolted_fault_ka: 14.219,
      arcflash_validation: {
        arcing_current_ka: 11.281,
        incident_energy_cal_cm2: 1.031,
        arc_flash_boundary_in: 16.7,
      },
      verification_status: 'calculation_available_for_comparison',
    },
  ],
};

const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

await context.route('https://agp.hcompany.ai/**', async (route) => {
  directScreenshotRequests.push(route.request().url());
  await route.fulfill({ status: 403, body: 'Browser frames must be fetched through the authenticated API proxy.' });
});

await context.route('**/api/hcomputer/sessions', async (route) => {
  if (route.request().method() === 'POST') {
    unexpectedCloudStarts.push(route.request().url());
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'QA_LIVE_H_BLOCKED', message: 'Live H calls are blocked by Electrisim QA.' }),
    });
    return;
  }
  await route.continue();
});

await context.route('**/api/electrisim/**', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const { pathname } = url;
  const method = request.method();
  if (method === 'POST' || method === 'DELETE') {
    assert.equal(
      request.headers()['x-arcflash-demo'],
      'electrisim-public-v1',
      `${method} ${pathname} must carry the same-origin demo header.`,
    );
  }
  const fulfill = (status, body) => route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

  if (pathname === '/api/electrisim/sessions' && method === 'POST') {
    sessionStarts += 1;
    sessionStopped = false;
    await fulfill(201, runningSession());
    return;
  }
  if (pathname === `/api/electrisim/sessions/${mockSessionId}` && method === 'GET') {
    sessionReads += 1;
    await fulfill(200, sessionStopped
      ? { ...runningSession(), status: 'interrupted', state: 'interrupted' }
      : sessionStarts > 1 ? completedSession() : runningSession());
    return;
  }
  if (pathname === `/api/electrisim/sessions/${mockSessionId}/changes` && method === 'GET') {
    const fromIndex = Number(url.searchParams.get('from_index') ?? '0');
    await fulfill(200, fromIndex === 0 ? {
      new_events: [
        {
          type: 'AgentEvent',
          timestamp: '2026-07-11T12:00:01Z',
          data: {
            kind: 'observation_event',
            type: 'web',
            text: 'Opened the public Electrisim editor. The Device dialog offers Create New Diagram.',
            metadata: { url: 'https://app.electrisim.com/' },
          },
        },
        {
          type: 'AgentEvent',
          timestamp: '2026-07-11T12:00:02Z',
          data: {
            kind: 'policy_event',
            content: 'Click Create New Diagram once to open a new untitled schematic; never choose Open Existing Diagram.',
            tool_reqs: [{ id: 'tool-1', tool_name: 'click', args: { target: 'Create New Diagram' } }],
          },
        },
        {
          type: 'AgentEvent',
          timestamp: '2026-07-11T12:00:03Z',
          data: {
            kind: 'observation_event',
            type: 'web',
            text: 'Created a new untitled schematic diagram. Confirmed the schematic editor with symbol palette and grid-paper canvas and never entered Map Editor. The palette shows Generator ~, the first Transformer, External Grid, Motor M under Rotating Equipment, and the horizontal Bus conductor.',
            metadata: { url: 'https://app.electrisim.com/' },
          },
        },
        {
          type: 'AgentEvent',
          timestamp: '2026-07-11T12:00:04Z',
          data: {
            kind: 'policy_event',
            content: 'Use atomic drag_web to place Generator, the first Transformer, two External Grids, and Motor left-to-right across the upper third of the grid.',
            tool_reqs: [{ id: 'tool-2', tool_name: 'drag_web', args: { target: 'All five exact components to an upper-third centered row' } }],
          },
        },
        {
          type: 'AgentEvent',
          timestamp: '2026-07-11T12:00:05Z',
          data: {
            kind: 'policy_event',
            content: 'Use atomic drag_web to snap horizontal Bus conductors across Generator, Transformer, both External Grids, and Motor.',
            tool_reqs: [{ id: 'tool-3', tool_name: 'drag_web', args: { target: 'Bus endpoints snapped between all five components' } }],
          },
        },
        {
          type: 'AgentEvent',
          timestamp: '2026-07-11T12:00:06Z',
          data: {
            kind: 'observation_event',
            type: 'web',
            text: 'Generator, the first Transformer, two External Grids, and Motor are visibly connected by Bus conductors in a centered row in the upper third above the canvas midpoint. The diagram remains unsaved and no simulation ran.',
            image: { source: screenshotSource, type: 'url', media_type: 'image/png' },
            metadata: { url: 'https://app.electrisim.com/' },
          },
        },
      ],
      next_index: 6,
      status: 'running',
    } : {
      new_events: [],
      next_index: fromIndex,
      status: sessionStarts > 1 ? 'completed' : 'running',
      answer: sessionStarts > 1
        ? 'Created a new untitled schematic, placed Generator, the first Transformer, two External Grids, and Motor in the upper third, connected them with Bus conductors, and stopped without saving or running a simulation.'
        : undefined,
    });
    return;
  }
  if (pathname === `/api/electrisim/sessions/${mockSessionId}/screenshots` && method === 'POST') {
    const payload = request.postDataJSON();
    assert.equal(payload.source, screenshotSource, 'The browser frame proxy must receive H\'s exact resource URL.');
    screenshotFetches += 1;
    await route.fulfill({ status: 200, contentType: 'image/png', body: screenshotPng });
    return;
  }
  if (pathname === `/api/electrisim/sessions/${mockSessionId}` && method === 'DELETE') {
    sessionStops += 1;
    sessionStopped = true;
    await fulfill(200, { ...runningSession(), status: 'interrupted', state: 'interrupted' });
    return;
  }
  if (pathname === '/api/electrisim/calculations/cv104' && method === 'POST') {
    calculationRuns += 1;
    await fulfill(200, calculationPayload);
    return;
  }

  await fulfill(500, {
    code: 'QA_UNEXPECTED_ELECTRISIM_REQUEST',
    message: `Unexpected ${method} ${pathname}`,
  });
});

const home = await context.newPage();
const study = await context.newPage();
const lab = await context.newPage();

try {
  await home.goto(baseUrl, { waitUntil: 'networkidle' });
  await home.getByPlaceholder('Prepare the arc-flash report for CV-104…').waitFor();
  await home.getByRole('button', { name: 'Prepare task plan' }).waitFor();
  assert.equal(new URL(home.url()).pathname, '/', 'The existing home route must remain at /.');

  await study.goto(`${baseUrl}/study?operator=qa`, { waitUntil: 'networkidle' });
  await study.getByRole('button', { name: /CV-104 Conveyor Electrical Distribution/ }).click();
  await study.getByRole('button', { name: 'Verify Study Case A' }).click();
  await study.getByRole('button', { name: /Arc Flash/ }).waitFor();
  assert.equal(new URL(study.url()).pathname, '/study', 'The existing computer-use target must remain at /study.');

  await lab.goto(`${baseUrl}/labs/electrisim`, { waitUntil: 'networkidle' });
  await lab.getByTestId('electrisim-lab').waitFor();
  await lab.getByRole('heading', { name: 'Electrisim public drawing lab' }).waitFor();
  await lab.getByRole('heading', { name: 'No-login drawing request' }).waitFor();
  await lab.getByRole('heading', { name: 'Independent open-source calculation' }).waitFor();
  assert.equal(sessionStarts, 0, 'Opening the lab must not start a paid H session automatically.');
  assert.equal(calculationRuns, 0, 'Opening the lab must not start a calculation automatically.');

  await lab.getByRole('button', { name: 'Start public drawing demo' }).click();
  await lab.getByText(mockSessionId, { exact: false }).waitFor();
  await lab.getByTestId('electrisim-session-state').waitFor();
  const agentView = lab.getByRole('link', { name: 'Open H Agent View' });
  await agentView.waitFor();
  assert.equal(await agentView.getAttribute('href'), mockAgentViewUrl, 'Agent View must use the URL returned by H.');
  assert.equal(sessionStarts, 1, 'The first lab run should create one isolated Electrisim session.');
  await lab.getByText('Browser observation', { exact: true }).first().waitFor();
  await lab.getByText('Browser action', { exact: true }).first().waitFor();
  await lab.getByText(/Device dialog is closed/i).waitFor();
  await lab.getByText(/drag_web.*Generator.*Transformer.*External Grid.*Motor.*upper third/i).waitFor();
  await lab.getByText(/drag_web.*Bus.*Generator.*Transformer.*External Grid.*Motor/i).waitFor();
  await lab.getByAltText('Latest observation returned by the H hosted browser').waitFor();
  assert.equal(screenshotFetches, 1, 'Observation screenshots must be fetched once through the authenticated API proxy.');
  assert.deepEqual(directScreenshotRequests, [], 'The browser must not fetch credentialed H resources directly.');

  await lab.getByRole('button', { name: 'Stop session' }).click();
  await lab.getByTestId('electrisim-session-state').getByText(/interrupted|stopped/i).waitFor();
  assert.equal(sessionStops, 1, 'Stop must cancel the active Electrisim session.');

  await lab.getByRole('button', { name: 'Reset lab' }).click();
  await lab.getByRole('button', { name: 'Start public drawing demo' }).click();
  await lab.getByTestId('electrisim-session-state').getByText(/completed/i).waitFor({ timeout: 15_000 });
  await lab.getByText(/placed Generator.*Transformer.*External Grid.*Motor.*upper third.*Bus.*stopped without saving/i).waitFor({ timeout: 5_000 });
  assert.equal(sessionStarts, 2, 'Reset should allow a second independent session.');
  assert.ok(sessionReads > 0, 'The lab must poll its dedicated session endpoint.');
  const checkpoints = lab.getByTestId('electrisim-checkpoints');
  await checkpoints.waitFor();
  assert.equal(await checkpoints.getByText('OBSERVED', { exact: true }).count(), 8, 'Every drawing checkpoint must have matching H evidence.');

  await lab.getByRole('button', { name: 'Run independent CV-104 validation' }).click();
  const calculation = lab.getByTestId('electrisim-calculation');
  await calculation.getByText('pandapower', { exact: false }).first().waitFor();
  await calculation.getByText('arcflash', { exact: false }).first().waitFor();
  await calculation.getByText('MCC-01', { exact: false }).first().waitFor();
  assert.equal(calculationRuns, 1, 'The open-source calculation should run only after explicit user action.');

  await lab.screenshot({ path: path.join(artifacts, 'desktop-lab.png'), fullPage: true });
  await lab.setViewportSize({ width: 390, height: 844 });
  const mobileOverflow = await lab.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(mobileOverflow <= 1, `The Electrisim lab should not overflow horizontally (overflow: ${mobileOverflow}px).`);
  await lab.screenshot({ path: path.join(artifacts, 'mobile-lab.png'), fullPage: true });

  assert.deepEqual(unexpectedCloudStarts, [], 'Electrisim QA must never call the existing H session endpoint.');
  console.log(
    `Electrisim drawing QA passed: / and /study unchanged; ${sessionStarts} mocked sessions, `
      + `${sessionStops} safe stop, ${calculationRuns} open-source calculation, and mobile layout verified.`,
  );
} finally {
  await browser.close();
}
