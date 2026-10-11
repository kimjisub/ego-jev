# ego-jev

Let **Jev** drive multi-step browser flows inside **ego lite**, your real browser, while your agent keeps the goal and
the values.

- [ego lite](https://github.com/citrolabs/ego-lite) runs a real Chrome-based browser on your Mac with your logins,
  split into isolated TaskSpaces that agents can share.
- **Jev** (TypeSafe System One) is a judgment model: it answers yes/no, multiple-choice and score questions over a
  state object. **It never generates text.**
- **ego-jev** reads the page, asks Jev "what next, on which element, with which of the given values", and performs
  the action through ego. Strings to type always come from the caller as `key=value`; Jev only decides where they go.

Your LLM agent stays in charge of what to do and why. ego-jev takes the clicking off its hands.

## Requirements

- macOS with ego lite installed and onboarded (`ego-browser` on your PATH or in `~/.local/bin`)
- Node.js 20 or later
- A TypeSafe API key in `TYPESAFE_API_KEY`

No other dependencies: no Playwright, no bundled browser.

## Install

```bash
git clone https://github.com/kimjisub/ego-jev.git
cd ego-jev && npm link        # puts `ego-jev` on your PATH
```

## Usage

```bash
ego-jev do "<goal>" [key=value ...] [--url U] [--space N] [--page p1] [--max 10] [--allow-irreversible] [--finish] [--name NAME]
ego-jev check "<yes/no question>" [--space N] [--page p1]
ego-jev read "<question>" [--space N] [--page p1]
```

```bash
export TYPESAFE_API_KEY=...

ego-jev do "Log in, add Sauce Labs Backpack to the cart and check out with the given name and zip code" \
  username=standard_user password=secret_sauce first=Ada last=Lovelace zip=12345 \
  --url https://www.saucedemo.com/ --max 14
```

Progress goes to stdout, one line per round. The last line is the result:

```text
  r0: type(1) -> #0 input:text "Username" (0.99) value=username  done=0.01 ...
  ...
EGO_JEV_RESULT {"status":"done","url":"...","actions":[...],"jev_calls":17,"space":12,"page":"p1"}
```

- `space` is the ego TaskSpace id. Pass it to `--space` to continue in the same tab, or open it from your own
  `ego-browser nodejs` script with `taskSpace(12)` and take over by hand.
- `--finish` closes the TaskSpace when the command ends. Otherwise close it yourself with `task.finish({ keep: [] })`.
- If you keep the key in a secret manager, wrap the call, for example `op run --env-file keys.env -- ego-jev do ...`.

### Statuses

| status | meaning | what the caller should do |
|---|---|---|
| `done` | Jev says the goal is reached and a separate check agreed that every part is in effect | move on |
| `likely_done` | probably reached, but the second check was unsure | look at the page (`check`, snapshot) before relying on it |
| `needs_confirmation` | the next click looks hard to undo (order, payment, delete, send) | rerun with `--allow-irreversible` only if that step is intended |
| `needs_login` | the page asks for sign-in and no credentials were given | log in in ego (or hand off to a human), then rerun |
| `blocked` | captcha, access denied, error page | hand off to a human |
| `ambiguous` | Jev could not pick a target with confidence | act on one of the returned `candidates` yourself |
| `stuck` | the same action repeated without progress, or Jev stopped while the goal is not in effect | inspect the page and take over |
| `error` | the page shows an error after the last action | read `page_text` |
| `max_actions` | the action budget ran out | raise `--max` or split the goal |

## How it works

Each round:

1. Wait until the DOM has been quiet for 400 ms.
2. List the interactive elements of the top document (labels, state, values) and tag them with `data-jev-i`.
3. Ask Jev one request with several questions: is the goal done, is the page blocked, is an error shown, is this a
   login wall, would the next step be hard to undo, which tool, which element, which value. Pages with more than 240
   elements go through two stages: pick a group of 30 consecutive elements, then the element inside it.
4. Resolve the answers into one action (`click`, `type`, `press_enter`, `press_key`, `select`, `hover`, `drag`,
   `upload`, `scroll`, `wait`) and run it through the ego Page API.
5. Stop on done, on a guard (login, irreversible, error, repetition) or on the action budget.

Before returning `done`, ego-jev asks Jev a second, stricter question: judging from the page state only (checked
boxes, selected filters, sort order, entered values), is every part of the goal in effect right now? In testing, a
filter whose click had opened a glossary popup instead of ticking the box got 0.28 on this question, and the run was
not reported as done.

Clicks on checkboxes and radios land on the left edge of their label, because labels often hold links in the middle.
A click blocked by a sticky header is retried after scrolling the target to the centre.

The API key reaches the ego runtime through a one-shot FIFO (mode 600). It is not written to disk and is removed
from the runtime's environment.

## When to use it

Measured against an agent driving ego by itself ([benchmarks](benchmarks/README.md)):

| Task | Plain ego | ego + ego-jev |
|---|---|---|
| Danawa: two filters + sort on a 900-element page, read top 5 | 31.6 s | **22.8 s** |
| SauceDemo: log in, add 2 items, check out, finish | 19.3 s | **16.7 s** |
| httpbin form: 7 fields + submit | **10.2 s** | 15.8 s |
| Wikipedia: search, open article, read one value | **7.7 s** | 15.9 s |

- **Use ego-jev** for flows of five or more steps, for pages with hundreds of elements or awkward markup, and when you
  want to keep page snapshots out of your agent's context.
- **Drive ego directly** for one or two actions on a page with clean selectors. Every ego-jev call pays 2 to 3 s of
  start-up plus 0.7 to 1.5 s per Jev round.
- **Mix them.** Let ego-jev do the clicking, then read and extract with your own `ego-browser nodejs` script in the
  same TaskSpace.

## Limits

- Only the top document is read; elements inside iframes are not listed.
- Settling watches DOM mutations only, not network requests.
- New tabs are not followed automatically.
- The irreversible-step guard is a probability with a 0.6 threshold. On sites with real payments, deletes or
  messages, keep `--max` small and split the goal into steps you can check.
- The `done` judgment is better with the second check but still not proof. Check the conditions that matter.

## Credits

The decision loop, page script, page model, content pruning and Jev client are derived from
[jev-browser](https://github.com/Ying-Kai-Liao/jev-browser) 0.1.2 by Ying-Kai Liao (MIT). ego-jev replaces its
Playwright and MCP layers with ego lite and adds the done verification, label-edge clicks and state-preserving page
fitting.

ego-jev is not affiliated with Citro Labs (ego lite) or TypeSafe (Jev).

## License

MIT. See [LICENSE](LICENSE).
