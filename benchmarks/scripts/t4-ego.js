const task = await taskSpace(15);
const page = task.page("p1");
await page.fill("@3", "Jeju Island");
await page.press("@3", "Enter");
await page.waitForURL(/Jeju/);
await page.waitForLoadState("domcontentloaded");
console.log(JSON.stringify(await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".infobox tr")].map(r => r.innerText.replace(/\s+/g, " ").trim());
  return { url: location.href, title: document.title, area: rows.filter(r => /^(• )?(Total|Area)\b/i.test(r)).slice(0, 4) };
})));
await task.finish({ keep: [] });
