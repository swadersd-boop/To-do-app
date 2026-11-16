# Kalm

A calm daily planner. You plan the day in the morning, give each task a time, work through them one at a time, and close the day in the evening.

Kalm runs entirely in your browser. There is no account and no server, and your tasks never leave your device.

## What it does

- **Day columns.** Each day is a column of tasks. Drag tasks between days, reorder them, or park them in the backlog.
- **A workload check.** Every task has an estimate. Each day shows its total against the hours you say fit in a day, and warns when you are over.
- **Timeboxing.** Drag a task onto the timeline to give it a start time. Drag the block to move it, pull its bottom edge to change the length, or press "Fill my day" to schedule everything in order. Running late? Press it again and the tasks whose time has passed move to the next free gaps.
- **Fixed commitments.** A meeting or appointment gets a fixed time. "Fill my day" plans around it and never moves it, it does not count against your work hours, and it does not roll over if you miss it.
- **A planning ritual.** Four steps each morning: deal with leftovers, choose today's tasks, check that they fit, commit. It ends with a plan you can copy as text or share as a link.
- **Focus mode.** One task on screen with a timer that records the time you really spent.
- **A shutdown ritual.** Review what got done, decide what happens to the rest, write a few lines of reflection, copy the recap.
- **Honest estimates.** Kalm compares your estimates with your tracked time. After a few finished tasks it tells you how far off you run, per channel, and the planning ritual uses that to forecast what a day will really cost.
- **Weekly objectives, channels, steps and notes** on every task.
- **Repeating tasks.** Daily, weekdays or weekly. Upcoming days show a preview, and each occurrence becomes real when you finish the one before it, so missed ones never pile up.
- **Rollover.** Unfinished tasks move to today on their own, and show how many times they have been carried. The day they left keeps a note of how many were carried, so past days stay an honest record.
- **Works offline** and installs as an app from the browser menu.

## Quick add

Type a task on one line and press Enter:

```
Write proposal 45m #work @14:30 tomorrow
```

| You type | What happens |
| --- | --- |
| `45m`, `1h`, `1h30`, `1.5h` | Sets the estimate |
| `45 min`, `2 hours` | Same, written out |
| `#work` | Files the task under a channel, creating it if it is new |
| `@14:30`, `@2pm`, `@12:30-13:30` | Gives the task a fixed time, like a meeting |
| `today`, `tomorrow`, `fri`, `on Friday`, `later` as the last word | Picks the day, or the backlog for `later` |

Normal sentences are left alone: "Review PR #482" and "Prep slides for Friday" keep their full titles.

## Keyboard

| Key | Action |
| --- | --- |
| `N` | Add a task to today |
| `P` | Plan today |
| `S` | Shut down the day |
| `F` | Focus on the first unfinished task |
| `T` | Jump back to today |
| `←` `→` | Move the board a day |
| `B` / `L` | Show or hide the backlog / the timeline |
| `?` | Show all shortcuts |
| `Enter` / `X` / `Delete` on a task | Open it / mark it done / remove it |
| `Space` on a task | Pick it up, move it with the arrow keys, drop it with `Space` |

## Run it on your computer

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

Then open the address it prints, usually http://localhost:5173.

## Put it online for free

The repository includes a workflow that publishes the app to GitHub Pages on every push to `main`.

1. On GitHub, open the repository's **Settings**, then **Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main`, or run the "Deploy to GitHub Pages" workflow by hand from the **Actions** tab.

The app is then live at `https://<your-username>.github.io/<repository-name>/`. Send that address to friends. Each person gets their own private planner, because the data lives in their own browser.

## Your data

Everything is saved in the browser's local storage, on the device you use.

- Clearing the browser's site data deletes your tasks. **Settings → Download backup** saves everything to a file.
- To move to another browser or device, download a backup there and use **Restore from backup** here.
- There is no sync between devices.

A share link is different: it packs one day's plan into the link itself, after the `#`. Browsers do not send that part to any server. Anyone who has the link can read that plan, and nothing else.

## Development

```bash
npm test
```

runs the unit tests for the date logic, the quick-add parser, scheduling, fixed commitments, repeats, rollover, the timer, estimates and share links.

```bash
npm run build
```

type-checks and builds the app into `dist/`.

The end-to-end test walks the whole daily loop in a real browser and saves screenshots to `e2e/shots/`. It needs Playwright (`npm install --no-save playwright` and `npx playwright install chromium`) and a running preview server:

```bash
npx vite preview --port 4173
```

```bash
npm run e2e
```

### Where things live

| Path | What is in it |
| --- | --- |
| `src/types.ts` | The data model |
| `src/store.ts` | Saved state and every action that changes it |
| `src/ui.ts` | View state that is not saved (open dialogs, selected day) |
| `src/lib/` | Pure logic: dates, parsing, scheduling, estimates, share links |
| `src/components/` | The screens |
| `src/styles.css` | All styling, with light and dark colours as CSS variables at the top |
| `public/sw.js` | The offline cache |

Built with React, TypeScript, Vite, Zustand and dnd kit. Headings are set in Fraunces, bundled with the app so it works offline.

## Credits

Kalm is an independent project. It is inspired by daily-planning tools like Sunsama and is not affiliated with or endorsed by any of them.

The repository carries the [Gauntlet Loop](https://github.com/robonuggets/gauntlet-loop) agent skill in `.claude/skills/` (skill by Jay E at RoboNuggets, technique by Matt Shumer, CC BY 4.0).

## License

MIT. See [LICENSE](LICENSE).
