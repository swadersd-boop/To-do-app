// Two weeks of history in a real browser: restore a backup, then check the
// record of past days, the weekly review, objectives per week, and a few days
// of carrying over.
//
//   npm run build && npx vite preview --port 4173 &
//   node e2e/history.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';

const { chromium } = createRequire(import.meta.url)('playwright');
const APP = process.env.KALM_URL ?? 'http://localhost:4173/';
const FIXTURE = fileURLToPath(new URL('./fixtures/two-weeks.json', import.meta.url));

const errors = [];
const browser = await chromium.launch();
const open = async (when, storageState) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Europe/Amsterdam', locale: 'en-GB', storageState });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.clock.install({ time: new Date(when) });
  await page.goto(APP);
  await page.locator('.col.is-today').waitFor();
  return { ctx, page };
};
const titles = async (locator) => (await locator.allInnerTexts()).map((t) => t.split('\n')[0]);

// 1. Restoring brings the data up to today at once.
let { ctx, page } = await open('2026-11-16T08:40:00+01:00');
await page.getByRole('button', { name: 'Settings', exact: true }).click();
await page.locator('input[type=file]').setInputFiles(FIXTURE);
await page.locator('.toast', { hasText: 'Backup restored' }).waitFor();
await page.keyboard.press('Escape');
await page.locator('.backdrop').waitFor({ state: 'detached' });
const today = page.locator('.col.is-today');
assert.deepEqual((await titles(today.locator('.card-wrap'))).sort(), ['Design onboarding flow', 'Draft pricing memo', 'Standup'], "Friday's leftovers and one standup");

// 2. Friday is an honest record: what got done, and what moved on.
await page.getByRole('button', { name: 'Previous week' }).click();
const friday = page.locator('.col[data-date="2026-11-13"]');
assert.match(await friday.locator('.col-load-text').innerText(), /4 done · .* tracked · 2 moved on/);
assert.deepEqual(await titles(friday.locator('.card-moved .card-title')), ['Design onboarding flow', 'Draft pricing memo']);
assert.equal(await friday.locator('.add-line').count(), 0, 'no adding tasks to a past day');

// 3. Objectives follow the week on the board.
const objectives = page.locator('.sidebar .side-section').first();
assert.match(await objectives.innerText(), /^Last week/);
assert.match(await objectives.innerText(), /Three deep-work mornings/);
await page.getByRole('button', { name: 'Today', exact: true }).click();
assert.match(await objectives.innerText(), /^This week[\s\S]*Ship the pricing memo/);

// 4. The first plan of the week starts with last week.
await page.getByRole('button', { name: 'Plan today', exact: true }).click();
const plan = page.getByRole('dialog');
assert.match(await plan.locator('.stepper').innerText(), /Week/);
assert.match(await plan.locator('.lede').first().innerText(), /finished 28 tasks/);
await plan.getByRole('button', { name: 'Carry to this week' }).click();
assert.match(await plan.locator('.objectives').last().innerText(), /Three deep-work mornings/);
await page.keyboard.press('Escape');

// 5. Insights reads by calendar week.
await page.getByRole('button', { name: 'Insights', exact: true }).click();
const weeks = (await page.locator('.table').nth(1).innerText()).split('\n');
assert.ok(weeks.some((row) => /^9 Nov\t28\t/.test(row)), `week of 9 Nov: ${weeks.join(' | ')}`);
await page.keyboard.press('Escape');

// 6. Three days later the two leftovers have moved on three times, so they go to the backlog by themselves,
//    and the plan says so with a way to bring them back.
let state = await ctx.storageState();
await ctx.close();
for (const day of ['17', '18', '19']) {
  ({ ctx, page } = await open(`2026-11-${day}T08:30:00+01:00`, state));
  state = await ctx.storageState();
  await ctx.close();
}
({ ctx, page } = await open('2026-11-19T08:35:00+01:00', state));
const thursday = await titles(page.locator('.col.is-today .card-wrap'));
assert.deepEqual(thursday, ['Standup'], 'only the standup is on Thursday');
assert.equal(await page.locator('.sidebar .col-list .card-wrap').count(), 3, 'the two leftovers joined the backlog item');
await page.getByRole('button', { name: 'Plan today', exact: true }).click();
const dlg = page.getByRole('dialog');
await dlg.getByRole('button', { name: 'Next' }).click();
assert.match(await dlg.locator('.wont-fit').first().innerText(), /went to the backlog overnight/);
await dlg.getByRole('button', { name: 'Bring back to today' }).first().click();
assert.equal((await titles(page.locator('.col.is-today .card-wrap'))).length, 2, 'one brought back to today');

// 7. A day nobody planned says so, and still names what moved on from it.
await page.keyboard.press('Escape');
const wednesday = page.locator('.col[data-date="2026-11-18"]');
await page.getByRole('button', { name: 'Earlier' }).click();
assert.equal(await wednesday.locator('.col-load-text').innerText(), 'Not planned · 2 moved on');
assert.equal(await wednesday.locator('.card-moved').count(), 2);

await browser.close();
assert.deepEqual(errors, [], 'no page errors');
console.log('History test passed.');
