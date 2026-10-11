const task = await taskSpace(10);
const page = task.page("p1");
const wait = ms => new Promise(r => setTimeout(r, ms));
for (const t of ["IH압력밥솥", "3인용"]) {
  await page.evaluate((t) => { document.querySelectorAll("[data-b]").forEach(e => e.removeAttribute("data-b")); const l = [...document.querySelectorAll("label.srch_lb")].find(l => l.innerText.trim() === t); l.scrollIntoView({ block: "center" }); l.setAttribute("data-b", "1"); }, t);
  await page.click("[data-b]", { position: { x: 4, y: 8 } });
  await wait(2000);
}
await page.evaluate(() => { const a = [...document.querySelectorAll("a")].find(a => a.innerText.trim() === "낮은가격순"); a.setAttribute("data-b2", "1"); });
await page.click("[data-b2]");
await wait(2500);
console.log(JSON.stringify(await page.evaluate(() => ({
  checked: [...document.querySelectorAll("input[type=checkbox]:checked")].map(i => document.querySelector(`label[for="${i.id}"]`)?.innerText.trim()).filter(Boolean),
  sort: location.search.match(/sort=[^&]*/)?.[0],
  top: [...document.querySelectorAll("li.prod_item")].filter(li => li.querySelector(".prod_name")).slice(0, 5).map(li => li.querySelector(".prod_name").innerText.trim() + " " + li.querySelector(".price_sect strong")?.innerText.trim()),
}))));
await task.finish({ keep: [] });
