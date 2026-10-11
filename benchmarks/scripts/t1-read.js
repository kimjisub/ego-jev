const spaces = await listTaskSpaces();
const s = spaces.find(x => (x.name || x.title) === "bench-T1-mixed") ?? spaces.at(-1);
const task = await taskSpace(s.id ?? s.spaceId);
const p = task.page("p1");
const top = await p.evaluate(() => [...document.querySelectorAll("li.prod_item")].filter(li => li.querySelector(".prod_name")).slice(0, 5).map(li => ({
  name: li.querySelector(".prod_name").innerText.trim(),
  price: li.querySelector(".price_sect strong")?.innerText.trim(),
})));
console.log(JSON.stringify(top));
await task.finish({ keep: [] });
