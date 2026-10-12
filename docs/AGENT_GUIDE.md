# ego-jev for agents

ego-jev drives a stretch of a site inside your ego TaskSpace: you give the goal, the strings to type and the page
states to reach; Jev picks every click (about 1 to 3 s per action, no tokens of yours).

**Use it for one thing: on a site whose markup you do not know, filters and sorting on a results page, or a flow
over several screens (cart, checkout, multi-step forms).** Make it your first browser call, with `--url`, instead of
looking at the page yourself. Do everything else with your own `ego-browser nodejs` scripts: sites you know, a URL
you have seen work, a single form or click on one page, and reading the result afterwards.

```bash
ego-jev do "<goal>" key=value ... --url <start url> --name <taskspace> --max <actions + 3> \
  --require "<page state 1>" --require "<page state 2>" ... [--allow-irreversible]
```

- `key=value`: every string to type (search terms, names). Jev cannot write text.
- `--require`: what the page shows when each part is done, in order ("the 로지텍 brand filter is selected",
  "the list is sorted by lowest price"). Not clicks.
- `--allow-irreversible` only when the task says to order, submit, send or delete.
- `--url`: start as close to the work as you can. If you know the site's search URL pattern, start on the results
  page; every search Jev does from the home page costs two or three rounds.
- `--name` is the TaskSpace your scripts open with `taskSpace("<name>")`.

The last line is `EGO_JEV_RESULT {json}`. On `done`, the page is in that state: read what the task asks for and
finish, or finish right away if there is nothing to read. On anything else, the `requirements` scores show which
part is missing (under 0.5); the page is often already right, so check that part with one script and do only what
is left.
