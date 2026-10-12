# Experiments

How should a caller phrase work for Jev, and which loop changes make it cheaper without making it wrong? These
experiments ran six tasks (eight from round 3), three phrasings each, through the `ego-jev` CLI on 2026-10-12, on one MacBook with
ego lite 0.5.1.13. Every run gets a fresh TaskSpace and is graded by a check that reads the final page state, not
by what ego-jev reports.

```bash
op run --env-file keys.env -- node experiments/run.mjs --tag NAME [--tasks a,b] [--modes procedure,outcome,require] [--repeat N] [-- extra ego-jev flags]
node experiments/summarize.mjs NAME [NAME ...]
```

`tasks.mjs` holds the goals, values, requirements and checks. `results/*.jsonl` holds every run with its round log.
[RESULTS.md](RESULTS.md) lists all 228 runs (the rejected shortlist runs are in `results/rejected/`).

## Tasks

| Task | Site | What has to happen | Check |
|---|---|---|---|
| danawa | Danawa (Korean price comparison, 900 to 1,150 interactive elements) | search, tick two filters, sort by lowest price | both filter boxes checked, `sort=priceASC` in the URL |
| saucedemo | SauceDemo | log in, add two items, check out, finish | on `/checkout-complete.html` |
| httpbin | httpbin.org pizza form | 3 text fields, a radio, 2 checkboxes, time, comments, submit | the echoed JSON has exactly these values |
| wikipedia | English Wikipedia | search a topic, open the article | page title |
| login | the-internet.herokuapp.com | log in | on `/secure` |
| todomvc | Playwright TodoMVC demo | add three todos, complete one, show Active | stored todos and `#/active` |
| gmarket | G마켓 (single-page app, about 1,000 elements) | search, brand and free-delivery filters, sort by lowest price | `f=d:f`, the brand chip and `s=1` in the URL |
| yes24 | YES24 (about 700 elements) | search, restrict to Korean books, sort by newest | `domain=BOOK` and `order=RECENT` in the URL |

## Phrasings

- **procedure**: the goal spells out the steps ("type the query, tick IH and 3-person in the filters, sort by
  lowest price").
- **outcome**: the goal says only what the user wants ("I want the cheapest 3-person IH pressure cookers").
- **require**: the outcome goal plus `--require` page states, for example "the IH filter is selected".

## Configurations

| Tag | Code | Runs |
|---|---|---|
| base | first version, `--no-batch-fill --no-merge-require` | 36 |
| opt | first version, batch fill and merged scoring on | 36 |
| base2 | after the round-1 fixes, `--no-batch-fill --no-merge-require` | 36 |
| opt2 | after the round-1 fixes, defaults | 36 |
| opt3 | opt2 plus no merged scoring on two-stage pages (released as 0.2.0), `require` only | 12 |
| settle1 | 0.3.0 changes on the three large pages (danawa, gmarket, yes24), `require` only | 6 |
| opt4 | network-aware settle and custom checkbox clicks, all eight tasks, `require` only | 16 |
| opt5 | opt4 plus acting on a confident target when the focused requirement scores under 0.2 | 20 |
| opt6 | opt5 plus requirements reached only in order, Enter in the field just typed into (released as 0.3.0) | 30 |

## Results

### 1. Phrasing decides correctness

Released code (opt2 for procedure and outcome, opt3 for require), 12 runs per row:

| Phrasing | Correct | Claimed `done` but wrong | Correct but not `done` | Mean time | Mean Jev calls |
|---|---|---|---|---|---|
| procedure | 12/12 | 0 | 6 | 8.9 s | 9.5 |
| outcome | 8/12 | 0 | 4 | 7.4 s | 7.8 |
| require | **12/12** | 0 | 6 | 10.4 s | 11.0 |

- **Outcome-only goals fail on multi-part tasks.** All four failures are SauceDemo (logs in, adds the items, stops
  before checkout) and Danawa (searches and sorts, skips the filters). Jev picks one action at a time from what is
  on the screen and has no plan, so a goal that does not name the parts loses them.
- **Requirements fix that without knowing the site.** Same outcome sentence, plus states you can see on the page.
  The cost is one extra request per round on pages that need two stages; on smaller pages the scores ride along with
  the action request.
- **Procedures also work** but the caller has to know the site's steps.
- "Correct but not `done`" is mostly `likely_done` on flows whose earlier states disappear (the cart empties after
  the order, the Active filter hides the completed todo). See [Statuses](../README.md#statuses).

### 2. Loop changes: what made it cheaper

Same code, optimisations off (base2) and on (opt2), 36 runs each:

| Task | Jev calls off -> on | Time off -> on |
|---|---|---|
| httpbin (form) | 14.3 -> **9.3** | 10.7 s -> **7.9 s** |
| login | 5.7 -> 4.7 | 5.2 s -> 4.8 s |
| todomvc | 11.7 -> 10.3 | 7.2 s -> 7.3 s |
| saucedemo | 12.5 -> 11.7 | 10.6 s -> 11.6 s |
| danawa | 13.0 -> 15.3 | 14.0 s -> 15.2 s |
| wikipedia | 8.0 -> 8.7 | 5.8 s -> 6.1 s |

- **Batch fill** (fill every matching empty field in one round) is the clear win on forms: the httpbin form went
  from 5 rounds of typing to 1.
- **Merged requirement scoring** cut calls on small pages but added them on Danawa: on two-stage pages the scores
  cannot ride along, so the speculative action request was wasted. opt3 skips the speculation there; `require` runs
  then averaged 11.0 calls and 66k tokens against 14.4 calls and 68k tokens with merging off.

### 3. Round-1 failures and what fixed them

Round 1 (base and opt, 72 runs) got 48 right. Reading the round logs gave these fixes; round 2 (base2 and opt2)
got 60 of 72.

| Failure seen | Cause | Fix |
|---|---|---|
| Danawa: the search button click blocked three times | a promotional modal ("금융다나와 안내") covered the page; the error Jev saw said only "another element covers the target" | the click error now names the blocker (`dialog "금융다나와 안내" covers the target; close or dismiss it first`); blocked clicks also try Escape once |
| Danawa: Jev clicked "IH압력밥솥" and nothing was filtered | the button was a glossary term in a product's spec list (`aria-haspopup=dialog`, `cursor: help`) | elements now carry `opens: "help text"` or the popup type |
| TodoMVC: third todo never added | Enter was pressed on a checkbox, because any `input` passed as an Enter target | Enter goes to fields and buttons only, otherwise to the field typed last |
| Danawa and SauceDemo with requirements: "no action" while the next target was clear | the tool answer was `none` (0.44) while the target had 0.77 | with requirements, a `none` below 0.6 with a target at 0.6 or more becomes the best acting tool |
| httpbin outcome: reported `done` with the form filled but not sent | the done check accepted a filled form | the check now requires the result of ordering, sending or submitting |
| login: reported `stuck` although logged in | the done check looked for the typed values, which are gone after login | the check accepts what an action leads to (the page after logging in, a confirmation) |
| login: navigation timed out | the site's `load` event took 30 s | pages are opened at `domcontentloaded`; the DOM settle decides when to act |
| the CLI printed nothing when piped | the ego runtime writes `console.log` to stderr when stdout is not a terminal | the CLI routes its own lines to stdout |

### 4. Round 3: large pages, single-page apps, and a rejected shortlist

Agent runs ([agent/README.md](agent/README.md)) added two real sites, G마켓 and YES24, and turned up two bugs. Fixed
and measured here with `require` phrasing, two runs per task:

| Change | Before | After |
|---|---|---|
| G마켓 custom checkboxes: the transparent input lies over the label edge, so the edge click was reported as covered | `stuck` after six blocked clicks | the input is clicked directly |
| G마켓 is a single-page app: the URL changes at once, the list re-renders after its own request about 1.5 s later | the next round read the old list and picked the wrong control (`settle1` vs `rejected/nosl1`) | settle also waits for same-origin `fetch`/XHR; G마켓 6/6 correct in `settle1` and `opt4` |

**Rejected: a code-made shortlist instead of the two-stage pick.** On pages over 240 elements, ego-jev asks Jev for a
group of 30 elements, then for the element. The idea was to let code keep the elements whose labels share a word with
the goal and ask Jev once. It cut Danawa from 16 to 11 Jev calls, but when the right element was not in the list
(the label "낮은 가격순" with a space, Korean particles on "신상품순으로"), Jev picked the closest wrong one with
confidence 0.9, because its confidence is relative to the options it is shown. After word-matching fixes, 1 of 6
runs was correct (`rejected/sl3`), so the shortlist was removed. The runs are kept in `results/rejected/`.

### 5. Regression after round 3

| Config | Correct | Failures and what fixed them |
|---|---|---|
| opt4 | 14/16 | Danawa and G마켓 ended `stuck`: Jev answered "no action" (0.72, 0.60) while pointing at the missing filter with 0.64 and 0.83 and scoring that requirement 0.06 and 0.04. Fix: with requirements, act on a target of 0.6 or more when the focused requirement scores under 0.2 |
| opt5 | 17/20 | G마켓 twice: "the free-delivery filter is selected" scored 0.71 to 0.84 on the home page, before any search, and stayed reached, so the filter was never set. Fix: a requirement counts as reached only after every earlier one |
| opt6 | 29/30 | TodoMVC once: Enter in the field just typed into had target confidence 0.27 and stopped as `ambiguous`. Fix: that Enter needs no minimum confidence; the 8 reruns afterwards were correct |

No configuration in rounds 3 to 5 reported `done` for a wrong result.

## Caveats

- Two repetitions per cell. Site latency varies; the-internet.herokuapp.com was unreachable for one round-1
  repetition (3 crashes in `opt`).
- Danawa served three filter layouts: native checkboxes, buttons with `role=checkbox` and `data-state`, and buttons
  under "CM 추천 옵션" whose selection shows only in the URL (`attribute=556-2771-OR` for IH압력밥솥,
  `6941-125068-OR` for 3인용). The check reads all three since round 3; one opt2 `require` run in the URL-only
  layout could not be confirmed by the check of that time.
- Times are for the `ego-jev` command alone, without an agent around it.
- Jev tokens are input tokens as reported by the TypeSafe API (`usage.input_tokens`).
