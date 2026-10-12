// Experiment tasks. Each task has one goal per phrasing mode, the values Jev may type, the requirements for the
// `require` mode, an optional state reset, and a check that runs in the page afterwards and returns { ok, ... }.
//
// Modes:
//   procedure  the goal spells out the steps
//   outcome    the goal says only what the user wants
//   require    the outcome goal plus --require page states

export const TASKS = {
  danawa: {
    url: "https://www.danawa.com/",
    max: 14,
    values: { query: "3인용 압력밥솥" },
    goals: {
      procedure: "검색창에 query 를 입력해 검색하고, 검색 결과 필터에서 품목 IH압력밥솥과 용량 3인용을 선택하고, 상품목록을 낮은가격순으로 정렬한다",
      outcome: "3인분까지 짓는 IH 압력밥솥을 가장 싼 것부터 보고 싶다",
    },
    require: [
      "검색 결과가 3인용 압력밥솥이다",
      "IH압력밥솥만 표시되도록 필터가 선택되어 있다",
      "3인용만 표시되도록 용량 필터가 선택되어 있다",
      "상품 목록이 낮은가격순으로 정렬되어 있다",
    ],
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
    url: "https://www.gmarket.co.kr/",
    max: 10,
    values: { query: "무선 마우스" },
    goals: {
      procedure: "검색창에 query 를 입력해 검색하고, 필터에서 브랜드 로지텍과 무료배송을 선택하고, 낮은 가격순으로 정렬한다",
      outcome: "무료배송되는 로지텍 무선 마우스를 가장 싼 것부터 보고 싶다",
    },
    require: [
      "무선 마우스 검색 결과가 표시되어 있다",
      "브랜드 로지텍 필터가 선택되어 있다",
      "무료배송 필터가 선택되어 있다",
      "상품 목록이 낮은 가격순으로 정렬되어 있다",
    ],
    check: () => {
      const u = new URL(location.href), f = u.searchParams.get("f") ?? "";
      const sel = document.querySelector(".list__selected-filter")?.innerText ?? "";
      const ok = /무선/.test(u.searchParams.get("keyword") ?? "") && f.includes("d:f") && /로지텍/.test(sel) && u.searchParams.get("s") === "1";
      return { ok, f, s: u.searchParams.get("s") };
    },
  },

  yes24: {
    url: "https://www.yes24.com/",
    max: 8,
    values: { query: "파이썬" },
    goals: {
      procedure: "검색창에 query 를 입력해 검색하고, 분야를 국내도서로 좁히고, 신상품순으로 정렬한다",
      outcome: "파이썬 국내도서를 최신 책부터 보고 싶다",
    },
    require: [
      "파이썬 검색 결과가 표시되어 있다",
      "검색 결과가 국내도서로 좁혀져 있다",
      "검색 결과가 신상품순으로 정렬되어 있다",
    ],
    check: () => {
      const u = new URL(location.href);
      let q = u.searchParams.get("query") ?? ""; try { q = decodeURIComponent(q); } catch {}
      return { ok: /파이썬/.test(q) && u.searchParams.get("domain") === "BOOK" && u.searchParams.get("order") === "RECENT", q, order: u.searchParams.get("order") };
    },
  },

  saucedemo: {
    url: "https://www.saucedemo.com/",
    max: 18,
    irreversible: true,
    reset: "https://www.saucedemo.com/",
    values: { username: "standard_user", password: "secret_sauce", first: "Ada", last: "Lovelace", zip: "12345" },
    goals: {
      procedure: "Log in, add Sauce Labs Backpack and Sauce Labs Bike Light to the cart, check out with the given name and zip code, and finish the order",
      outcome: "I want to buy the Sauce Labs Backpack and the Sauce Labs Bike Light",
    },
    require: [
      "Logged in to the store",
      "Sauce Labs Backpack and Sauce Labs Bike Light are both in the cart",
      "The checkout form has the given first name, last name and zip code",
      "The order is complete (a thank-you confirmation is shown)",
    ],
    check: () => ({ ok: location.pathname.endsWith("/checkout-complete.html"), path: location.pathname }),
  },

  httpbin: {
    url: "https://httpbin.org/forms/post",
    max: 14,
    irreversible: true,
    values: { name: "Ada Lovelace", tel: "010-1234-5678", email: "ada@example.com", time: "19:30", comments: "Ring the bell twice" },
    goals: {
      procedure: "Fill in the customer name, telephone and email with the given values, choose size Medium, tick the toppings Bacon and Extra Cheese, fill in the delivery time and comments, then press Submit order",
      outcome: "Order a medium pizza with bacon and extra cheese, delivered at the given time, with the given contact details and comments",
    },
    require: [
      "Customer name, telephone and email are filled with the given values",
      "Pizza size Medium is selected",
      "The toppings Bacon and Extra Cheese are ticked",
      "Delivery time and comments are filled with the given values",
      "The order has been submitted (the page shows the submitted form data as JSON)",
    ],
    check: () => {
      let f; try { f = JSON.parse(document.body.innerText).form; } catch { return { ok: false, reason: "not the JSON echo" }; }
      const t = [].concat(f.topping ?? []);
      const ok = f.custname === "Ada Lovelace" && f.custtel === "010-1234-5678" && f.custemail === "ada@example.com"
        && f.size === "medium" && t.includes("bacon") && t.includes("cheese") && t.length === 2
        && f.delivery === "19:30" && f.comments === "Ring the bell twice";
      return { ok, form: f };
    },
  },

  wikipedia: {
    url: "https://en.wikipedia.org/wiki/Main_Page",
    max: 6,
    values: { topic: "Jeju Island" },
    goals: {
      procedure: "Type the given topic into the Wikipedia search box, submit the search and open the article",
      outcome: "Open the Wikipedia article about the given topic",
    },
    require: ["The Wikipedia article about Jeju Island is open"],
    check: () => ({ ok: /^Jeju Island/.test(document.title), title: document.title }),
  },

  login: {
    url: "https://the-internet.herokuapp.com/login",
    max: 6,
    values: { username: "tomsmith", password: "SuperSecretPassword!" },
    goals: {
      procedure: "Type the username and password into the form and click Login",
      outcome: "Log in with the given credentials",
    },
    require: ["The secure area page says you logged in"],
    check: () => ({ ok: location.pathname === "/secure", path: location.pathname }),
  },

  todomvc: {
    url: "https://demo.playwright.dev/todomvc/#/",
    max: 14,
    reset: "https://demo.playwright.dev/todomvc/#/",
    values: { a: "Buy milk", b: "Walk the dog", c: "Pay rent" },
    goals: {
      procedure: "Add the three todos one by one (type each into the new todo box and press Enter), mark Walk the dog as completed, then click the Active filter",
      outcome: "Make a todo list of the three given items, with Walk the dog done, and show only what is still left to do",
    },
    require: [
      "The todos Buy milk, Walk the dog and Pay rent are all in the list",
      "Walk the dog is marked completed",
      "The Active filter is selected",
    ],
    check: () => {
      const todos = JSON.parse(localStorage.getItem("react-todos") || "[]");
      const by = Object.fromEntries(todos.map(t => [t.title, t.completed]));
      const ok = todos.length === 3 && by["Buy milk"] === false && by["Walk the dog"] === true && by["Pay rent"] === false && location.hash === "#/active";
      return { ok, todos: todos.map(t => `${t.title}${t.completed ? " (done)" : ""}`), hash: location.hash };
    },
  },
};
