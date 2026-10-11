const spaces = await listTaskSpaces();
const s = spaces.find(x => (x.name || x.title) === "bench-T3-mixed2");
const task = await taskSpace(s.id ?? s.spaceId);
const page = task.page("p1");


const body = await page.evaluate(() => document.body.innerText);
const form = JSON.parse(body).form;
console.log(JSON.stringify(form));
await task.finish({ keep: [] });
