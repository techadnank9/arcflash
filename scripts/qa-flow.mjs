import assert from 'node:assert/strict';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const baseUrl = process.env.QA_BASE_URL ?? 'http://localhost:8787';
const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const artifacts = path.resolve('artifacts');
await mkdir(path.join(artifacts, 'downloads'), { recursive: true });

const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(artifacts, '01-home.png'), fullPage: true });
  await page.getByPlaceholder('Prepare the arc-flash report for CV-104…').fill('Generate the draft arc-flash report for CV-104 using Study Case A.');
  await page.getByRole('button', { name: 'Prepare task plan' }).click();
  await page.getByText('READY TO EXECUTE').waitFor();
  await page.screenshot({ path: path.join(artifacts, '02-plan.png'), fullPage: true });

  await page.getByRole('button', { name: 'Start secure run' }).click();
  await page.getByText('Starting isolated workspace').waitFor();
  await page.getByText('LIVE APPLICATION').waitFor({ timeout: 8_000 });
  await page.waitForTimeout(5_300);
  await page.screenshot({ path: path.join(artifacts, '03-live-capture.png'), fullPage: true });

  await page.getByRole('heading', { name: 'Engineer action required' }).waitFor({ timeout: 18_000 });
  await page.getByText('MCC-01 clearing time not available').waitFor();
  await page.screenshot({ path: path.join(artifacts, '04-review.png'), fullPage: true });

  const exportButton = page.getByRole('button', { name: /Export review PDF/ });
  assert.equal(await exportButton.isDisabled(), true, 'Draft export must be disabled before approval.');

  await page.getByRole('button', { name: 'Review and approve draft' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Approve draft for export' }).click();
  await page.getByText('Draft cleared for export').waitFor();
  assert.equal(await exportButton.isDisabled(), false, 'Draft export should unlock after explicit approval.');

  const downloadPromise = page.waitForEvent('download');
  await exportButton.click();
  const download = await downloadPromise;
  const downloadPath = path.join(artifacts, 'downloads', download.suggestedFilename());
  await download.saveAs(downloadPath);
  const pdfStat = await stat(downloadPath);
  const pdfHead = (await readFile(downloadPath)).subarray(0, 4).toString();
  assert.equal(pdfHead, '%PDF', 'Export must be a PDF.');
  assert.ok(pdfStat.size > 15_000, 'Exported PDF must contain the complete report package.');
  await page.getByText('Draft package prepared').waitFor();
  await page.screenshot({ path: path.join(artifacts, '05-approved.png'), fullPage: true });

  const mccDisposition = page.locator('.evidence-review-summary > div').filter({ hasText: 'MCC-01' });
  await mccDisposition.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel(/Breaker clearing time/).fill('0.142');
  await page.getByLabel(/Engineering note/).fill('Verified against breaker trip curve TCC-12.');
  await page.getByRole('button', { name: 'Save engineer correction' }).click();
  await page.getByRole('heading', { name: 'Engineer action required' }).waitFor();
  await page.getByText('MCC-01 clearing time supplied').waitFor();
  assert.equal(await exportButton.isDisabled(), true, 'Editing evidence after approval must revoke approval and lock export.');

  const target = await context.newPage();
  await target.goto(`${baseUrl}/study?operator=h-computer`, { waitUntil: 'networkidle' });
  await target.getByRole('button', { name: /CV-104 Conveyor Electrical Distribution/ }).click();
  await target.getByRole('button', { name: 'Verify Study Case A' }).click();
  await target.getByRole('button', { name: /Arc Flash/ }).click();

  for (const id of ['SWGR-01', 'MCC-01', 'CV-104']) {
    await target.getByRole('button', { name: new RegExp(id) }).first().click();
    if (id === 'MCC-01') await target.getByRole('button', { name: 'Flag missing value for engineer review' }).click();
    await target.getByRole('button', { name: 'Capture evidence' }).click();
  }
  await target.getByRole('button', { name: 'Generate report draft' }).click();
  await target.getByText('Draft report generated.').waitFor();
  await target.getByText('Engineer review required.').waitFor();
  await target.screenshot({ path: path.join(artifacts, '06-hcomputer-target.png'), fullPage: true });

  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(baseUrl, { waitUntil: 'networkidle' });
  await mobile.getByRole('button', { name: 'Start voice input' }).waitFor();
  const mobileOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(mobileOverflow <= 1, `Mobile home should not overflow horizontally (overflow: ${mobileOverflow}px).`);
  await mobile.screenshot({ path: path.join(artifacts, '07-mobile-home.png'), fullPage: true });

  console.log(`QA passed: approval gate, PDF (${pdfStat.size} bytes), approval revocation, H Computer target flow, and mobile smoke test.`);
} finally {
  await browser.close();
}
