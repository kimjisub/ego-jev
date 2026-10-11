const s = (await listTaskSpaces()).find(x => (x.name || x.title) === "bench-T4-mixed");
const task = await taskSpace(s.id ?? s.spaceId);
const page = task.page("p1");
console.log(JSON.stringify(await page.evaluate(() => ({ url: location.href, area: [...document.querySelectorAll(".infobox tr")].map(r => r.innerText.replace(/\s+/g, " ").trim()).filter(r => /^(• )?(Total|Area)\b/i.test(r)).slice(0, 4) }))));
await task.finish({ keep: [] });
