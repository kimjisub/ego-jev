# Agent comparison: an agent with ego-jev against the same agent alone

Does an LLM agent finish browser tasks faster when it may hand parts of them to ego-jev, without getting anything
wrong? These runs answer that for Claude Opus 5.5 in Claude Code, on 2026-10-12, on one MacBook with ego lite
0.5.1.13.

## Setup

- Every run is a fresh subagent with the same task text. It has never seen the site in this session.
- **ego**: the agent reads the ego-browser skill (`SKILL.md`, 19.5 KB) and drives ego with its own
  `ego-browser nodejs` scripts. ego-jev is not allowed.
- **mixed**: the same agent and skill, plus [docs/AGENT_GUIDE.md](../../docs/AGENT_GUIDE.md) (1.8 KB) and the
  `ego-jev` command. It decides itself when to use ego-jev. From v6 on, the guide is prepended to the skill so both
  modes read one document.
- Both modes of a task run at the same time in separate TaskSpaces, so they share network and machine load.
  Rounds r1 to r3 ran the modes one after the other instead, because SauceDemo and TodoMVC keep state per site.
- Time is the subagent's wall-clock time, from the task to its one-line answer, including its own thinking.
- Each run is graded by `tasks.mjs`: a check in the page the agent left behind (URL parameters, checked filters,
  the echoed form), and for reading tasks the reported answer.
- Jev requests go through `ego-jev proxy`, so neither mode pays for the secret manager.
- The v6 runs used the 0.3.0 loop without its last three fixes (requirements reached in order, acting on a confident
  target when the focused requirement scores under 0.2, Enter after typing). Those came from the regression runs
  that followed ([experiments](../README.md#5-regression-after-round-3)) and only change runs that would have ended
  `stuck` or `ambiguous`.

## Tasks

| Task | Site | What the agent has to do |
|---|---|---|
| danawa | Danawa, about 1,000 interactive elements, three filter layouts served at random | search, tick two filters, sort, report the top three |
| gmarket | G마켓, single-page app, custom checkboxes | search, brand and free-delivery filters, sort, report the top three |
| yes24 | YES24 | search, restrict to Korean books, sort by newest, report three titles |
| law | 국가법령정보센터, text in an iframe | open a statute, report the definition in Article 2 |
| httpbin | httpbin.org form | fill seven fields, submit |
| wikipedia | English Wikipedia | report the area of Jeju Island |
| login, saucedemo, todomvc | well-known demo apps | log in; buy two items; add, complete and filter todos (r1 to r3 only) |

## Results with the final guide (v6)

Two paired runs per task, all 24 correct.

| Task | mixed: mean time | ego: mean time | mixed: tool calls | ego: tool calls | ego-jev used |
|---|---|---|---|---|---|
| danawa | **25.2 s** | 75.2 s | 5.0 | 15.5 | yes, from the first call |
| gmarket | **31.0 s** | 38.9 s | 3.0 | 7.5 | yes |
| yes24 | 23.8 s | 22.3 s | 3.5 | 4.0 | yes |
| httpbin | 12.5 s | 13.1 s | 2.0 | 2.0 | no |
| wikipedia | 10.8 s | 10.0 s | 4.0 | 4.0 | no |
| law | 19.9 s | 14.6 s | 3.5 | 2.5 | no |
| **all** | **20.5 s** | 29.0 s | 3.5 | 5.9 | |

- **Where ego-jev was used, it won by a lot or tied.** Danawa: three times faster, because agents alone spend 10 to 19
  tool calls fighting hidden checkbox inputs and three filter layouts. G마켓: 8 s faster. YES24: within 1.5 s; the
  ego-jev part took 7 s and the rest is the agent's own reading and writing.
- **Where it was not used, the two modes did the same work.** Differences there are run-to-run variance: on the
  statute task, one mixed run spent three scripts finding text inside an iframe, the next took 17.2 s against
  16.9 s.
- The mixed agent used 40 % fewer tool calls overall.

## How the guide got there

Each version was measured against fresh ego-only runs. Tags are the files in `results/`.

| Version | Rule for the agent | All tasks: mixed / ego mean | What went wrong |
|---|---|---|---|
| v1 (`r1`) | use ego-jev when you would have to look at the page first | 27.0 / 23.1 s | used ego-jev on demo sites the model already knows (SauceDemo checkout +10 s); guessed a YES24 URL that returned an error; ego-jev stuck on G마켓 checkboxes |
| v2 (`r2`) | drive yourself on sites you know; ego-jev for filters and multi-screen flows on unknown sites | 18.9 / 23.0 s | G마켓 and YES24 still lost: ego-jev bugs (below) |
| v3 (`r3`, `v1`) | always start yourself, hand a step over when it fails | 24.7 / 22.7 s | agents rarely hand over; they keep debugging. In `v1` the mixed agent lost on three of four real sites and spent 66 s on Danawa without calling ego-jev |
| v4 (`w`) | short guide: ego-jev first for filters, sorting, carts and forms on unknown sites | 22.9 / 27.0 s | single-page forms: ego-jev plus a needless check cost 2 to 5 s |
| v5 (`v5`) | v4 without single-page forms; finish on `done` without checking | 24.0 / 27.8 s | mixed agents read two files with one `cat`; the output was cut and they re-read the guide |
| v6 (`v6`) | v5, start on the search results URL when known; guide inside the skill document | **20.5 / 29.0 s** | |

The rule that worked is the narrow one: **hand filters, sorting and multi-screen flows on unfamiliar sites to ego-jev
from the first call; do everything else yourself.** Telling agents to fall back to ego-jev after a failure does not
work, because agents do not recognise their own failure early.

## Bugs the agent runs found in ego-jev

- **G마켓 checkboxes could not be clicked.** The site lays a transparent input over the label's left edge, where
  ego-jev clicks; ego reported the input as covering the target. ego-jev now clicks the input itself when it sits
  there.
- **Single-page apps were read too early.** G마켓 changes the URL at once and re-renders the list about 1.5 s later,
  after more than a second without DOM changes. The settle step now also waits for same-origin `fetch` and XHR
  requests (cross-origin analytics and ads do not count; requests older than 2.5 s do not count).
- **The API key stayed in the ego runtime.** The ego runtime keeps `process.env` for its whole life and shares it
  with every script it runs; ego-jev 0.2.0 put the key there. The key now lives only in the Jev client's module
  scope, or in the `ego-jev proxy` process.

## Caveats

- Two runs per cell for the final guide, one per cell for r1 to r3. Site latency alone moves a run by several
  seconds; read single-task gaps under about 5 s as ties.
- The agent is one model (Claude Opus 5.5). A slower agent loop widens ego-jev's lead, because each of its own turns
  costs more; a faster one narrows it.
- The demo apps (SauceDemo, TodoMVC, the-internet, httpbin) are in the model's training data; it writes their
  selectors without looking. That is why they are not where ego-jev helps.
- Danawa served three filter layouts during these runs. Four runs were first graded wrong because the check did not
  read the URL-only layout; they were regraded from the final URL in their transcripts (see `note` in the rows).

## Files

- `tasks.mjs`: prompts and checks. `grade.mjs`: resets site state and records one graded run.
  `summarize.mjs TAG ...`: the tables above.
- `results/*.jsonl`: one row per run (`task`, `mode`, `rep`, `ok`, `check`, `answer`, `duration_ms`, `tokens`,
  `tool_uses`).
