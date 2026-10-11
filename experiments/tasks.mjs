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
      const checked = t => [...document.querySelectorAll("input[type=checkbox]")].some(i => {
        const l = i.closest("label") || (i.id && document.querySelector(`label[for="${CSS.escape(i.id)}"]`));
        return i.checked && l && l.innerText.trim().startsWith(t);
      });
      const ih = checked("IH압력밥솥"), p3 = checked("3인용"), low = /sort=priceASC/.test(location.href);
      return { ok: ih && p3 && low, ih, p3, low };
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
