// Tasks for the agent comparison: the same request goes to an agent that drives ego alone ("ego") and to one that may
// also call ego-jev ("mixed"). `prompt` is what the agent is asked. `check` runs in the page the agent leaves behind;
// `answer` (optional) grades the reported answer.

export const AGENT_TASKS = {
  wikipedia: {
    prompt: "On English Wikipedia, find the total area of Jeju Island in square kilometres. Report the number.",
    check: () => ({ ok: /^Jeju/.test(document.title), title: document.title }),
    answer: a => /1[,.]?8(26|33|49)/.test(a),
  },
  login: {
    prompt: "Log in at https://the-internet.herokuapp.com/login with username tomsmith and password SuperSecretPassword! and report the message shown after logging in.",
    check: () => ({ ok: location.pathname === "/secure", path: location.pathname }),
    answer: a => /logged into a secure area/i.test(a),
  },
  httpbin: {
    prompt: "At https://httpbin.org/forms/post, order a medium pizza with bacon and extra cheese for Ada Lovelace (telephone 010-1234-5678, email ada@example.com), delivery at 19:30, with the comment \"Ring the bell twice\". Submit the order.",
    check: () => {
      let f; try { f = JSON.parse(document.body.innerText).form; } catch { return { ok: false, reason: "not the JSON echo" }; }
      const t = [].concat(f.topping ?? []);
      const ok = f.custname === "Ada Lovelace" && f.custtel === "010-1234-5678" && f.custemail === "ada@example.com"
        && f.size === "medium" && t.includes("bacon") && t.includes("cheese") && t.length === 2
        && f.delivery === "19:30" && f.comments === "Ring the bell twice";
      return { ok, form: f };
    },
  },
  saucedemo: {
    reset: "https://www.saucedemo.com/",
    prompt: "On https://www.saucedemo.com/ (username standard_user, password secret_sauce), buy the Sauce Labs Backpack and the Sauce Labs Bike Light. Check out as Ada Lovelace, zip code 12345, and finish the order.",
    check: () => ({ ok: location.pathname.endsWith("/checkout-complete.html"), path: location.pathname }),
  },
  danawa: {
    prompt: "On Danawa (https://www.danawa.com/), search for 3인용 압력밥솥, narrow the results with the filters to the product type IH압력밥솥 and the capacity 3인용, and sort by lowest price (낮은가격순). Leave that list on screen and report the names and prices of the first three products.",
    check: () => {
      // Danawa serves two filter layouts: native checkboxes, and buttons with role=checkbox and data-state
      const on = i => i.checked === true || i.getAttribute("data-state") === "checked" || i.getAttribute("aria-checked") === "true";
      const checked = t => [...document.querySelectorAll("input[type=checkbox], [role=checkbox]")].some(i => {
        const l = i.closest("label") || (i.id && document.querySelector(`label[for="${CSS.escape(i.id)}"]`)) || i;
        return on(i) && l.innerText.trim().startsWith(t);
      });
      // a third layout keeps the selection only in the URL: attribute=556-2771-OR (IH압력밥솥), 6941-125068-OR (3인용)
      const attr = decodeURIComponent(new URL(location.href).searchParams.get("attribute") ?? "");
      const ih = checked("IH압력밥솥") || attr.includes("556-2771-OR"), p3 = checked("3인용") || attr.includes("6941-125068-OR");
      const low = /sort=priceASC/.test(location.href);
      return { ok: ih && p3 && low, ih, p3, low };
    },
  },
  gmarket: {
    prompt: "On G마켓 (https://www.gmarket.co.kr/), search for 무선 마우스, keep only 무료배송 items from the brand 로지텍, and sort by lowest price (낮은 가격순). Leave that list on screen and report the names and prices of the first three products.",
    check: () => {
      const u = new URL(location.href), f = u.searchParams.get("f") ?? "";
      const sel = document.querySelector(".list__selected-filter")?.innerText ?? "";
      const ok = /무선/.test(u.searchParams.get("keyword") ?? "") && f.includes("d:f") && /로지텍/.test(sel) && u.searchParams.get("s") === "1";
      return { ok, f, s: u.searchParams.get("s"), selected: sel.replace(/\s+/g, " ").slice(0, 80) };
    },
  },
  yes24: {
    prompt: "On YES24 (https://www.yes24.com/), search for 파이썬, limit the results to 국내도서, and sort them by newest (신상품순). Report the titles of the first three books.",
    check: () => {
      const u = new URL(location.href);
      let q = u.searchParams.get("query") ?? "";
      try { q = decodeURIComponent(q); } catch {}
      const ok = /파이썬/.test(q) && u.searchParams.get("domain") === "BOOK" && u.searchParams.get("order") === "RECENT";
      return { ok, q, domain: u.searchParams.get("domain"), order: u.searchParams.get("order") };
    },
  },
  law: {
    prompt: "On 국가법령정보센터 (https://www.law.go.kr/), open the current 개인정보 보호법 and report how Article 2, item 1 defines 개인정보 (its first sentence is enough).",
    check: () => ({ ok: true, url: location.href.slice(0, 120) }),
    answer: a => /살아\s*있는\s*개인에\s*관한\s*정보/.test(a),
  },
  todomvc: {
    reset: "https://demo.playwright.dev/todomvc/#/",
    prompt: "In the TodoMVC demo at https://demo.playwright.dev/todomvc/#/, add the todos \"Buy milk\", \"Walk the dog\" and \"Pay rent\", mark \"Walk the dog\" as completed, and switch the list to show only active todos.",
    check: () => {
      const todos = JSON.parse(localStorage.getItem("react-todos") || "[]");
      const by = Object.fromEntries(todos.map(t => [t.title, t.completed]));
      const ok = todos.length === 3 && by["Buy milk"] === false && by["Walk the dog"] === true && by["Pay rent"] === false && location.hash === "#/active";
      return { ok, todos: todos.map(t => `${t.title}${t.completed ? " (done)" : ""}`), hash: location.hash };
    },
  },
};
