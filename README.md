# ego-jev

Let **Jev** click through multi-step browser flows inside **ego lite**, your real browser, while your agent keeps the
goal and the values.

- [ego lite](https://github.com/citrolabs/ego-lite) runs a Chromium browser on your Mac with your logins, split into
  isolated TaskSpaces that agents can share.
- **Jev** (TypeSafe System One) is a judgment model: it answers yes/no, multiple-choice and score questions over a
  state object. **It never generates text.**
- **ego-jev** reads the page, asks Jev "what next, on which element, with which of the given values", and performs
  the action through ego. Strings to type always come from the caller as `key=value`; Jev only decides where they go.

Your LLM agent stays in charge of what to do and why. ego-jev takes the clicking off its hands and keeps page
snapshots out of its context.

## Requirements

- macOS with ego lite installed and onboarded (`ego-browser` on your PATH or in `~/.local/bin`)
- Node.js 20 or later
- A TypeSafe API key in `TYPESAFE_API_KEY`

No other dependencies: no Playwright, no bundled browser.

## Install

```bash
npm install -g ego-jev
# or from source
git clone https://github.com/kimjisub/ego-jev.git && cd ego-jev && npm link
```

## Quick start

```bash
export TYPESAFE_API_KEY=...

ego-jev do "I want to buy the Sauce Labs Backpack and the Sauce Labs Bike Light" \
  username=standard_user password=secret_sauce first=Ada last=Lovelace zip=12345 \
  --url https://www.saucedemo.com/ --max 18 --allow-irreversible \
  --require "Logged in to the store" \
  --require "Sauce Labs Backpack and Sauce Labs Bike Light are both in the cart" \
  --require "The checkout form has the given first name, last name and zip code" \
  --require "The order is complete (a thank-you confirmation is shown)"
```

One line per round goes to stdout, and the last line is the result:

```text
  r0: require=[0.04, 0.03, 0.03, 0.02]
  r0: type(1) -> #0 input:text "Username" (0.99) value=username  done=0.03 ...
     also typed password -> #1 input:password "Password" (0.99)
  ...
EGO_JEV_RESULT {"status":"likely_done","url":".../checkout-complete.html","actions":[...],"requirements":[...],"jev_calls":15,"space":12,"page":"p1"}
```

## Usage

```bash
ego-jev do "<goal>" [key=value ...] [--require "<page state>" ...] [--url U] [--space N] [--page p1] [--max 10] [--allow-irreversible] [--finish] [--name NAME]
ego-jev check "<yes/no question>" [--space N] [--page p1]
ego-jev read "<question>" [--space N] [--page p1]
```

- `do` works toward a goal. `key=value` pairs are the only strings Jev may type or select.
- `check` answers a yes/no question about the current page as a probability.
- `read` returns the page text relevant to a question (Jev ranks blocks, code keeps the best).
- `space` in the result is the ego TaskSpace id. Pass it to `--space` to continue in the same tab, or open it from
  your own `ego-browser nodejs` script with `taskSpace(12)` and take over by hand.
- `--finish` closes the TaskSpace when the command ends. Otherwise close it with `task.finish({ keep: [] })`.
- With a secret manager, wrap the call: `op run --env-file keys.env -- ego-jev do ...`.

## How to phrase a task

Jev picks one action at a time from what is on the screen. It does not plan. How you phrase the task decides whether
it finishes. Measured on six sites, 12 runs per row ([experiments](experiments/README.md)):

| Phrasing | Example | Correct | Mean time |
|---|---|---|---|
| outcome only | "I want the cheapest 3-person IH pressure cookers" | 8/12 | 7.4 s |
| procedure | "search, tick IH and 3-person in the filters, sort by lowest price" | 12/12 | 8.9 s |
| **outcome + `--require`** | the outcome, plus "the IH filter is selected", "the list is sorted by lowest price", ... | **12/12** | 10.4 s |

None of the 36 runs reported `done` for a wrong result.

Rules that came out of the runs:

1. **Give the parts as `--require` page states, in order.** Write what you could see on the page when that part is
   done ("the 3-person capacity filter is selected"), not the click ("click 3-person"). Each round Jev scores every
   requirement and works on the first one not reached yet. You do not need to know the site.
2. **Make the last requirement the end state** ("the order is complete", "the list is sorted by lowest price").
   The run ends when every requirement has been reached and the last one is in effect.
3. **Pass every string as a value.** Search terms, names, codes: Jev cannot write them. Several values for one form
   are typed in the same round.
4. **Outcome-only goals are fine for one-part tasks** (open an article, log in). For anything with filters, a cart
   or several screens, they stop early.
5. **Split long flows at points you want to check yourself**, especially before payments or deletes. Keep `--max`
   near the number of steps you expect.

## Statuses

| status | meaning | what the caller should do |
|---|---|---|
| `done` | the goal (or every requirement) is in effect on the page | move on |
| `likely_done` | probably reached, but not every part is visible now; with `--require`, `requirements` lists the scores | look at `requirements` or the page. After a flow whose earlier states disappear (an emptied cart), this is the expected result |
| `needs_confirmation` | the next click looks hard to undo (order, payment, delete, send) | rerun with `--allow-irreversible` only if that step is intended |
| `needs_login` | the page asks for sign-in and no credentials were given | log in in ego (or hand off to a human), then rerun |
| `blocked` | captcha, access denied, error page | hand off to a human |
| `ambiguous` | Jev could not pick a target with confidence | act on one of the returned `candidates` yourself |
| `stuck` | the same action repeated without progress, or Jev found nothing to do while the goal is not in effect | inspect the page and take over |
| `error` | the page shows an error after the last action | read `page_text` |
| `max_actions` | the action budget ran out | raise `--max` or split the goal |

## How it works

Each round:

1. Wait until the DOM has been quiet for 400 ms (pages open at `domcontentloaded`, so slow third-party resources do
   not block).
2. List the interactive elements of the top document with their label, state (checked, value, expanded, sorted,
   selected) and whether they only open a popup or help text, and tag them with `data-jev-i`.
3. Ask Jev one request with several questions: is the goal done, is the page blocked, is an error shown, is this a
   login wall, would the next step be hard to undo, which tool, which element, which value. With `--require`, the
   requirement scores ride in the same request. Pages with more than 240 elements go through two stages: pick a
   group of 30 consecutive elements, then the element inside it.
4. Turn the answers into one action (`click`, `type`, `press_enter`, `press_key`, `select`, `hover`, `drag`,
   `upload`, `scroll`, `wait`) and run it through the ego Page API. If the action types a value and more values
   have empty fields on the page, one more request maps them to fields and all are typed in that round.
5. Stop on done, on a guard (login, irreversible, error, repetition) or on the action budget.

Before returning `done` without requirements, ego-jev asks a stricter question: judging from the page, is every part
of the goal in effect, either shown (a selected filter, an entered value) or evidenced (a confirmation, the page after
submitting)? A goal that orders or submits is not in effect while the form is merely filled.

Clicks on checkboxes and radios land on the left edge of their label, because labels often hold links in the middle.
A blocked click is retried after scrolling the target to the centre and once more after Escape; if it stays blocked,
Jev is told what covers it (`dialog "..." covers the target; close or dismiss it first`).

The API key reaches the ego runtime through a one-shot FIFO (mode 600). It is not written to disk and is removed
from the runtime's environment.

## When to use it

Against an agent (Claude Code) driving ego itself, wall clock including the agent's own thinking
([benchmarks](benchmarks/README.md), first version, procedure phrasing):

| Task | Agent drives ego | Agent + ego-jev |
|---|---|---|
| Danawa: two filters + sort on a 900-element page, read top 5 | 31.6 s | **22.8 s** |
| SauceDemo: log in, add 2 items, check out, finish | 19.3 s | **16.7 s** |
| httpbin form: 7 fields + submit | **10.2 s** | 15.8 s |
| Wikipedia: search, open article, read one value | **7.7 s** | 15.9 s |

The httpbin form now takes 7.9 s on its own with batch filling (it was 10.7 s without).

- **Use ego-jev** for flows of five or more steps, pages with hundreds of elements or awkward markup, and when you
  want to keep page snapshots out of your agent's context.
- **Drive ego directly** for one or two actions on a page with clean selectors. Every ego-jev call pays 2 to 3 s of
  start-up plus 0.7 to 1.5 s per Jev request.
- **Mix them.** Let ego-jev do the clicking, then read and extract with your own `ego-browser nodejs` script in the
  same TaskSpace.

## Limits

- Only the top document is read; elements inside iframes are not listed.
- Settling watches DOM mutations only, not network requests.
- New tabs are not followed automatically.
- Controls whose selected state is not in the DOM (no `checked`, `aria-pressed`, `aria-selected` or a
  `selected`/`active` class) cannot be scored as requirements reliably.
- The irreversible-step guard is a probability with a 0.6 threshold. On sites with real payments, deletes or
  messages, keep `--max` small and split the goal into steps you can check.
- A requirement counts as reached at a score of 0.5 and stays reached. If a later action undoes an earlier filter,
  the run ends as `likely_done` and lists it; it does not go back to fix it.

## Credits

The decision loop, page script, page model, content pruning and Jev client are derived from
[jev-browser](https://github.com/Ying-Kai-Liao/jev-browser) 0.1.2 by Ying-Kai Liao (MIT). ego-jev replaces its
Playwright and MCP layers with ego lite and adds requirements, batch filling, the done check, blocker-aware clicks
and state-preserving page fitting.

ego-jev is not affiliated with Citro Labs (ego lite) or TypeSafe (Jev).

## License

MIT. See [LICENSE](LICENSE).
