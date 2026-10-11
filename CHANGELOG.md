# Changelog

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
