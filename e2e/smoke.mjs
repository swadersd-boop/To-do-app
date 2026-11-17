// Walks the whole daily loop in a real browser and fails loudly if a step breaks.
//
//   npm run build && npx vite preview --port 4173 &
//   node e2e/smoke.mjs
//
// Screenshots land in e2e/shots.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';

// `require` also finds a globally installed Playwright, which `import` does not.
const { chromium } = createRequire(import.meta.url)('playwright');

const APP = process.env.KALM_URL ?? 'http://localhost:4173/';
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => {
  // Let open and close animations finish so no screenshot is half faded.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  await page.screenshot({ path: `${SHOTS}${name}.png` });
};

const errors = [];
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  timezoneId: 'Europe/Amsterdam',
  locale: 'en-GB',
  deviceScaleFactor: Number(process.env.SCALE ?? 1),
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

// A Monday morning, so the timeline has a day ahead of it.
await page.clock.install({ time: new Date('2026-11-16T09:10:00+01:00') });
await page.goto(APP);

const today = page.locator('.col.is-today');
const cardIn = (col, text) => col.locator('.card-wrap', { hasText: text });

async function drag(from, to, offset = { x: 0, y: 0 }) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + 14);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + 26, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2 + offset.x, b.y + offset.y, { steps: 14 });
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(120);
}

// 1. First run shows example tasks.
await today.waitFor();
assert.equal(await today.locator('.card-wrap').count(), 4, 'four starter tasks today');
await shot(page, '01-first-run');

// 2. Quick add understands durations and channels.
await page.keyboard.press('n');
await page.keyboard.type('Write the launch brief 1h30 #deep');
await page.keyboard.press('Enter');
const brief = cardIn(today, 'Write the launch brief');
await brief.waitFor();
assert.match(await brief.innerText(), /1h 30m/, 'estimate parsed');
assert.match(await brief.innerText(), /deep-work/, 'channel matched by prefix');

await page.keyboard.type('Reply to supplier emails 30m #admin @14:00');
await page.keyboard.press('Enter');
await page.keyboard.type('Book flights 20m #personal tomorrow');
await page.keyboard.press('Enter');
const tomorrow = page.locator('.col').nth(1);
await cardIn(tomorrow, 'Book flights').waitFor();
await page.keyboard.press('Escape');

// 3. Drag a card to another day.
await drag(cardIn(today, 'Drag me to another day'), tomorrow.locator('.col-list'), { x: 0, y: 60 });
await cardIn(tomorrow, 'Drag me to another day').waitFor();
assert.equal(await cardIn(today, 'Drag me to another day').count(), 0, 'card left today');

// 4. Reorder inside a day.
await drag(brief, cardIn(today, 'Press "Plan today"'), { x: 0, y: 4 });
assert.match(await today.locator('.card-wrap').first().innerText(), /Write the launch brief/, 'brief moved to the top');

// 5. Drag a card onto the timeline to timebox it.
const grid = page.locator('[data-timeline-grid]');
await page.locator('.timeline-scroll').evaluate((el) => (el.scrollTop = 0));
await drag(cardIn(today, 'Drag this card onto the timeline'), grid, { x: 20, y: 120 });
const block = page.locator('.block', { hasText: 'Drag this card onto the timeline' });
await block.waitFor();
assert.match(await block.getAttribute('aria-label'), /\d\d:\d\d to \d\d:\d\d/, 'block has a time range');
await page.locator('.block', { hasText: 'Reply to supplier emails' }).waitFor();

// 6. Tick something off.
await cardIn(today, 'Press "Plan today"').getByRole('checkbox').click();
assert.equal(await today.locator('.card.is-done').count(), 1, 'one task done');
await shot(page, '02-board');

// 7. The planning ritual.
await page.getByRole('button', { name: 'Plan today', exact: true }).click();
const ritual = page.getByRole('dialog');
await ritual.getByText('Start with what is left over').waitFor();
await shot(page, '03-plan-leftovers');
await ritual.getByRole('button', { name: 'Next' }).click();
await ritual.getByLabel('Add a task to today').fill('Stretch 10m');
await page.keyboard.press('Enter');
await ritual.getByRole('button', { name: /Add Things without a day/ }).click();
await shot(page, '04-plan-choose');
await ritual.getByRole('button', { name: 'Next' }).click();
await ritual.getByText('Does it fit in one day?').waitFor();
await shot(page, '05-plan-fit');
await ritual.getByRole('button', { name: 'Next' }).click();
await ritual.getByPlaceholder('One sentence').fill('Get the launch brief to a first full draft');
assert.match(await ritual.locator('.summary').innerText(), /Focus: Get the launch brief/, 'summary carries the intention');
await shot(page, '06-plan-commit');
await ritual.getByRole('button', { name: 'Copy a share link' }).click();
await page.waitForTimeout(200);
const link = await page.evaluate(() => navigator.clipboard.readText());
assert.match(link, /#plan=/, 'share link copied');
await ritual.getByRole('button', { name: 'Start my day' }).click();
await page.locator('.intention').waitFor();
await page.getByRole('button', { name: 'Planned', exact: true }).waitFor();
assert.ok((await page.locator('.block').count()) >= 4, 'tasks were placed on the timeline');
await page.waitForTimeout(300);
await shot(page, '07-planned-day');

// 8. Task details.
await cardIn(today, 'Write the launch brief').click();
const drawer = page.getByRole('dialog');
await drawer.getByLabel('Add a step').fill('Outline the three sections');
await page.keyboard.press('Enter');
await drawer.getByLabel('Add a step').fill('Draft the opening');
await page.keyboard.press('Enter');
await drawer.getByLabel('Notes').fill('Audience: retail partners. Keep it to one page.');
await shot(page, '08-task-detail');

// 9. Focus mode tracks time.
await drawer.getByRole('button', { name: 'Focus on this' }).click();
await page.locator('.focus-clock').waitFor();
await page.clock.fastForward('25:00');
await page.waitForTimeout(300);
assert.match(await page.locator('.focus-clock').innerText(), /^25:0\d$/, 'timer counted 25 minutes');
await shot(page, '09-focus');
await page.getByRole('button', { name: 'Done', exact: true }).click();
// Done stops the clock. The next task waits until you press Start.
await page.getByRole('button', { name: 'Start', exact: true }).waitFor();
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('kalm:v1')).state.timer), null, 'no timer runs after Done');
await page.clock.fastForward('05:00');
await page.getByRole('button', { name: 'Leave focus mode' }).click();
assert.match(await cardIn(today, 'Write the launch brief').innerText(), /25m \//, 'tracked time shows on the card');
assert.equal(await page.locator('.running').count(), 0, 'no timer bar when nothing is running');

// 10. The shutdown ritual.
await page.keyboard.press('s');
const shutdown = page.getByRole('dialog');
await shutdown.getByText('What happened today').waitFor();
await shot(page, '10-shutdown-review');
await shutdown.getByRole('button', { name: 'Next' }).click();
await shutdown.getByPlaceholder('A few honest lines').fill('The brief took less than planned once I outlined first.');
await shot(page, '11-shutdown-reflect');
await shutdown.getByRole('button', { name: 'Next' }).click();
assert.match(await shutdown.locator('.summary').innerText(), /Write the launch brief: \d+m \(planned 1h 30m\)/, 'recap lists tracked time');
await shutdown.getByRole('button', { name: 'Done for today' }).click();
await page.getByRole('button', { name: 'Closed', exact: true }).waitFor();

// 11. Everything survives a reload.
await page.reload();
await today.waitFor();
await cardIn(today, 'Write the launch brief').waitFor();
assert.ok(await page.locator('.intention').isVisible(), 'intention persisted');

// 12. Deleting can be undone.
await cardIn(today, 'Stretch').click();
await page.getByRole('button', { name: 'Delete', exact: true }).click();
assert.equal(await cardIn(today, 'Stretch').count(), 0, 'task deleted');
await page.getByRole('button', { name: 'Undo' }).click();
await cardIn(today, 'Stretch').waitFor();

// 12b. A repeating task creates its next occurrence when finished, and takes it back when un-finished.
await cardIn(today, 'Stretch').click();
await page.getByRole('dialog').getByLabel('Repeats').selectOption('daily');
await page.keyboard.press('Escape');
await cardIn(today, 'Stretch').getByRole('checkbox').click();
await cardIn(tomorrow, 'Stretch').waitFor();
await cardIn(today, 'Stretch').getByRole('checkbox').click();
await page.waitForTimeout(100);
assert.equal(await cardIn(tomorrow, 'Stretch').count(), 0, 'un-finishing removes the next occurrence');
await cardIn(today, 'Stretch').getByRole('checkbox').click();
await cardIn(tomorrow, 'Stretch').waitFor();

// 12c. Ordinary sentences survive quick add, and the first keystroke after N is not lost.
await page.keyboard.press('n');
await page.keyboard.type('Review PR #482 for Friday 20 min');
await page.keyboard.press('Enter');
const pr = cardIn(today, 'Review PR #482 for Friday');
await pr.waitFor();
assert.match(await pr.innerText(), /20m/, 'a duration with a space is read');
await page.keyboard.press('Escape');

// 12d. A fixed commitment holds its time when the rest of the day is replanned.
const meeting = page.locator('.block.is-fixed', { hasText: 'Reply to supplier emails' });
const meetingTime = await meeting.getAttribute('aria-label');
await page.getByRole('button', { name: /Fill my day|Replan from now/ }).click();
await page.locator('.block', { hasText: 'Review PR #482' }).waitFor();
assert.equal(await meeting.getAttribute('aria-label'), meetingTime, 'the fixed block did not move');
await page.getByRole('button', { name: 'Undo' }).click();
assert.equal(await page.locator('.block', { hasText: 'Review PR #482' }).count(), 0, 'scheduling can be undone');

// 12e. Keyboard: X on a focused card marks it done, Space on its checkbox does too, Escape always closes the drawer.
await pr.focus();
await page.keyboard.press('x');
assert.ok(await pr.locator('.card.is-done').count(), 'X marks the focused card done');
const hover = cardIn(today, 'Hover a card and press play');
await hover.getByRole('checkbox').focus();
await page.keyboard.press('Space');
assert.ok(await hover.locator('.card.is-done').count(), 'Space on the checkbox completes the task');
await hover.getByRole('checkbox').click();
await hover.click();
await page.getByLabel('Task title').click();
await page.keyboard.press('Enter');
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
assert.equal(await page.locator('.drawer').count(), 0, 'Escape closes the drawer after Enter in the title');

// 12f. A timer left running asks before it counts hours nobody worked.
await hover.hover();
await hover.getByRole('button', { name: 'Start focus' }).click();
await page.locator('.focus-clock').waitFor();
await page.getByRole('button', { name: 'Leave focus mode' }).click();
// A running timer stays visible after leaving focus mode, and can be stopped from anywhere.
await page.locator('.running', { hasText: 'Hover a card and press play' }).waitFor();
await page.getByRole('button', { name: 'Open', exact: true }).click();
await page.locator('.focus-clock').waitFor();
await page.clock.fastForward('03:00:00');
await page.getByRole('button', { name: 'Leave focus mode' }).click();
const nag = page.locator('.running.is-asking');
await nag.waitFor();
await shot(page, '11b-timer-nag');
await nag.getByRole('button', { name: /No, stop at/ }).click();
assert.match(await hover.innerText(), /55m \//, 'only the time up to the question was counted');

// 12g. The example tasks go away in one click.
await page.getByRole('button', { name: 'Remove the examples' }).click();
assert.equal(await cardIn(today, 'Hover a card').count(), 0, 'examples removed');
await cardIn(today, 'Write the launch brief').waitFor();

// 13. Other panels open without errors.
for (const [name, file] of [
  ['Insights', '12-insights'],
  ['Shortcuts and help', '13-help'],
  ['Settings', '14-settings'],
]) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await shot(page, file);
  await page.keyboard.press('Escape');
}

// 14. Dark theme.
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(150);
await shot(page, '15-dark');
await page.emulateMedia({ colorScheme: 'light' });

// 15. A shared link opens as a read-only plan.
const guest = await context.newPage();
guest.on('pageerror', (e) => errors.push(String(e)));
await guest.goto(link);
await guest.getByText('Get the launch brief to a first full draft').waitFor();
assert.ok((await guest.locator('.shared-list li').count()) >= 4, 'shared plan lists the tasks');
await shot(guest, '16-shared-plan');
await guest.close();

// 16. Phone layout.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'Europe/Amsterdam' });
const mobile = await phone.newPage();
mobile.on('pageerror', (e) => errors.push(String(e)));
await mobile.clock.install({ time: new Date('2026-11-16T09:10:00+01:00') });
await mobile.goto(APP);
await mobile.locator('.col.is-today').waitFor();
await shot(mobile, '17-phone');
for (const name of ['Timeline', 'Settings', 'Backlog and objectives', 'Plan today', 'Shut down', 'Focus']) {
  const box = await mobile.getByRole('button', { name, exact: true }).boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390, `"${name}" button is fully on screen on a phone`);
}
await mobile.getByRole('button', { name: 'Timeline', exact: true }).click();
await mobile.locator('.timeline').waitFor();
await shot(mobile, '18-phone-timeline');
await mobile.getByRole('button', { name: 'Timeline', exact: true }).click();
await mobile.getByRole('button', { name: 'Plan today', exact: true }).click();
await mobile.getByRole('dialog').waitFor();
await shot(mobile, '19-phone-plan');
await mobile.keyboard.press('Escape');
const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px on a phone`);

await browser.close();
assert.deepEqual(errors, [], 'no console errors');
console.log('Smoke test passed.');
