# Benchmarks: plain ego vs ego + ego-jev

Measured on 2026-10-11 on one MacBook (macOS, ego lite 0.5.1.13) with Claude Opus 5.5 in Claude Code as the agent.
Each task was run once per mode.

- **Plain ego**: the agent drives ego directly. It reads `page.snapshot()` output and writes `ego-browser nodejs`
  scripts until the task is done.
- **ego + ego-jev**: the agent hands multi-step manipulation to `ego-jev do` and only reads results or verifies.

The timer is wall-clock time from the agent's first browser call to the moment it had the answer, including the
agent's own thinking between calls. `scripts/mark.mjs` wrote each timestamp to `results.tsv`.

## Results

| Task | Plain ego | ego + ego-jev | Jev actions | Agent browser calls (plain / mixed) |
|---|---|---|---|---|
| T1 Danawa: filter "3-person" + "IH pressure", sort by lowest price, read top 5 | 31.6 s | **22.8 s** | 4 | 2 / 2 |
| T2 SauceDemo: log in, add 2 items, check out, finish order | 19.3 s | **16.7 s** | 13 | 4 / 1 |
| T3 httpbin pizza form: 7 fields + submit, read echo | **10.2 s** | 15.8 s | 10 | 2 / 2 |
| T4 Wikipedia: search "Jeju Island", open article, read area | **7.7 s** | 15.9 s | 3 | 2 / 2 |
| Total | 68.8 s | 71.2 s | | 10 / 7 |

All eight runs produced the correct result (same top-5 list and prices, order completed, all 7 form values echoed
back, area 1,826 km2).

T3 was first run at 26.3 s: the loop stopped before "Submit order" even with `--allow-irreversible`, and the
agent submitted by hand. That bug was fixed and the 15.8 s figure is the rerun.

## Reading the numbers

- **ego-jev is faster on long flows.** T2 is 13 actions in one `ego-jev` call; plain ego needed four
  snapshot-read-write cycles. T1 has 900+ interactive elements and filter checkboxes hidden behind labels;
  Jev found the right elements in two stages (groups, then elements).
- **Plain ego is faster on short tasks with clean selectors.** Each `ego-jev` call costs about 2 to 3 s of runtime
  start-up and secret hand-off, plus 0.7 to 1.5 s per Jev round. T3 and T4 had stable CSS names that the agent
  could write straight into one script.
- **The agent reads less with ego-jev.** In T2 plain mode the agent pulled three snapshots into its context; in
  mixed mode it read one result line. Token use was not measured precisely.

## Caveats

- n = 1 per task and mode. Network and site latency vary between runs.
- The agent was not naive: it had studied Danawa's DOM (`label.srch_lb`) and the SauceDemo flow earlier in the same
  session. That favours plain ego in T1 and T2; a first visit would need more exploration.
- The agent was a fast model inside Claude Code. A slower agent loop widens the gap in ego-jev's favour on long
  flows, because its thinking time sits between every plain-ego call but not between Jev rounds.
- Order alternated (T1 and T3 ran mixed first, T2 and T4 ran plain first) to spread warm-cache effects.

## Files

- `results.tsv`: raw timestamps (`iso, epoch ms, task, mode, start|end, note`). `T3 mixed` is the run before the fix, `T3 mixed2` the rerun. An extra `T3 mixed end` row comes from a failed submit attempt; the later `final` row is the real end.
- `scripts/`: the plain-ego scripts the agent wrote (`t*-ego*.js`) and the read/verify scripts used in mixed mode.

The ego-jev commands were:

```bash
# T1
ego-jev do "검색 결과 필터에서 용량 3인용과 품목 IH압력밥솥을 선택하고, 상품목록을 낮은가격순으로 정렬한다" \
  --url "https://search.danawa.com/dsearch.php?query=3%EC%9D%B8%EC%9A%A9%20%EC%95%95%EB%A0%A5%EB%B0%A5%EC%86%A5" --max 10
# T2
ego-jev do "Log in, add Sauce Labs Backpack and Sauce Labs Bike Light to the cart, check out with the given name and zip code, and finish the order" \
  username=standard_user password=secret_sauce first=Jisub last=Kim zip=12345 \
  --url https://www.saucedemo.com/ --max 16 --allow-irreversible --finish
# T3
ego-jev do "Fill in the pizza order form with the given customer name, telephone, email, a Medium size, bacon and extra cheese toppings, the given delivery time and comments, then submit the order" \
  name="Jisub Kim" tel=010-1234-5678 email=jisub@example.com time=19:30 comments="Ring the bell twice" \
  --url https://httpbin.org/forms/post --max 14 --allow-irreversible
# T4
ego-jev do "Search Wikipedia for the given topic and open its article" topic="Jeju Island" \
  --url https://en.wikipedia.org/wiki/Main_Page --max 6
```
