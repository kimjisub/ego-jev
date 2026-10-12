# Changelog

## 0.3.0 (2026-10-12)

- Security: the API key no longer goes into the ego runtime's `process.env`. The runtime keeps one `process.env` for
  its whole life and shares it with every script, so 0.2.0 left the key readable by later ego scripts. It now lives
  only in the Jev client's module scope.
- `ego-jev proxy [--idle MINUTES]`, `proxy status`, `proxy stop`: a background process holds the key and forwards Jev
  requests over a unix socket (mode 600). While it runs, `do`, `check` and `read` need no key, which saves the 2 to 4 s
  a secret manager takes per call.
- Settle waits for same-origin `fetch`/XHR requests as well as DOM mutations, so single-page apps that re-render
  after their own request are not read too early.
- Custom checkboxes whose transparent input covers the label's left edge are clicked on the input.
- Requirements count as reached only in order: a later one is not latched while an earlier one is still open (a
  "filter is selected" score on the home page no longer counts as progress).
- With requirements, a confident target (0.6 or more) is acted on when the focused requirement scores under 0.2, even
  if Jev's tool answer is "no action".
- Enter in the field just typed into no longer stops as `ambiguous` when its target confidence is low.
- `docs/AGENT_GUIDE.md`: when an agent should hand work to ego-jev, from six rounds of agent experiments.
- `experiments/agent/`: agent-with-ego-jev against agent-alone runs (tasks, grader, summariser, 122 recorded runs).
  With the final guide: 20.5 s against 29.0 s on average over six tasks, 25 s against 75 s on Danawa.
- `experiments/`: G마켓 and YES24 tasks; Danawa checks read all three filter layouts. With requirements, 29 of 30
  regression runs were correct and none reported `done` for a wrong result.

## 0.2.0 (2026-10-12)

- `--require "<page state>"` (repeatable): states the run has to reach, in order. Each round Jev scores them and works
  on the first one not reached yet. With requirements, outcome-only goals went from 8/12 to 12/12 correct in the
  experiments.
- Batch fill: when the next action types a value and more values have empty fields, all are typed in the same round.
  The httpbin form dropped from 14.3 to 9.3 Jev requests.
- Requirement scores ride in the action request on pages that fit one stage (`--no-merge-require` turns it off).
- Click errors name the element that covers the target; blocked clicks retry after Escape.
- Elements that only open a popup or help text carry `opens`.
- Enter is pressed only on fields and buttons, otherwise on the field typed last.
- The done check accepts what an action leads to (the page after logging in) and rejects a filled but unsent form
  for goals that order, send or submit.
- With requirements, a weak `none` next to a confident target becomes an action.
- Pages open at `domcontentloaded` instead of `load`.
- The CLI writes its own lines to stdout even when piped (the ego runtime sends `console.log` to stderr then).
- Results report `jev_tokens`.
- `experiments/`: task definitions, runner, summariser and 156 recorded runs.

## 0.1.0 (2026-10-11)

- First release: Jev decision loop from jev-browser 0.1.2 on top of ego lite, `do`, `check`, `read`, done
  verification, label-edge clicks, state-preserving page fitting, FIFO key hand-off.
