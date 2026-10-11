const task = await taskSpace(11);
const page = task.page("p1");
await page.fill('input[name="user-name"]', "standard_user");
await page.fill('input[name="password"]', "secret_sauce");
await page.click('input[name="login-button"]');
await page.waitForURL(/inventory/);
const s = String(await page.snapshot());
console.log(s.split("\n").filter(l => /button|link "Sauce|cart/i.test(l)).slice(0, 20).join("\n"));
