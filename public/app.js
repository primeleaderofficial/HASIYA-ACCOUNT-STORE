const state = {
accounts: [],
sold: [],
page: 1,
range: "all",
perPage: 20,
settings: {},
priceRanges: []
};

const $ = (s) => document.querySelector(s);

/* =========================================
MONEY
========================================= */

function money(n) {
return "Rs. " + Number(n || 0).toLocaleString("en-LK");
}

/* =========================================
WHATSAPP
========================================= */

function waUrl(account) {

const number =
String(state.settings.whatsapp_number || "")
.replace(/\D/g, "");

if (!number) return "#";

const message =
`Hi, I'm interested in buying ${account.title} - ${money(account.price)}.`;

return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/* =========================================
API
========================================= */

async function get(url) {

try {

```
const response = await fetch(url, {
  credentials: "same-origin"
});

const text = await response.text();

let data = {};

try {
  data = JSON.parse(text);
} catch {
  data = {};
}

if (!response.ok) {
  throw new Error(
    data.error ||
    data.message ||
    `Request failed (${response.status})`
  );
}

return data;
```

} catch (error) {

```
console.error("API ERROR:", url, error);

throw error;
```

}
}

/* =========================================
HTML ESCAPE
========================================= */

function esc(value) {

return String(value ?? "").replace(
/[&<>"']/g,
(char) => ({
"&": "&",
"<": "<",
">": ">",
'"': """,
"'": "'"
})[char]
);

}

/* =========================================
ACCOUNT CARD
========================================= */

function card(account, sold = false) {

const featured =
Number(account.featured) === 1 ||
account.featured === true;

return ` <article
   class="account-card"
   data-id="${Number(account.id)}"
 >

```
  <img
    class="account-img"
    src="${esc(account.image_url)}"
    alt="${esc(account.title)}"
    loading="lazy"
    onerror="
      this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 800 450%22%3E%3Crect width=%22800%22 height=%22450%22 fill=%22%2307111e%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 fill=%22%237aa7d8%22 font-size=%2230%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22%3EImage unavailable%3C/text%3E%3C/svg%3E'
    "
  >

  <div class="account-info">

    <div class="account-top">

      <div>

        <div class="account-title">
          ${esc(account.title)}
        </div>

        <div class="muted">
          ${esc(account.game)}
        </div>

      </div>

      <div class="price">
        ${money(account.price)}
      </div>

    </div>


    <span class="badge ${sold ? "sold" : ""}">

      ${
        sold
          ? "SOLD OUT"
          : featured
            ? "FEATURED"
            : "AVAILABLE"
      }

    </span>


    <div class="specs">

      <div class="spec">
        Level
        <b>${esc(account.level || "—")}</b>
      </div>

      <div class="spec">
        Likes
        <b>${esc(account.likes || "—")}</b>
      </div>

      <div class="spec">
        Fashion
        <b>${esc(account.fashion || "—")}</b>
      </div>

      <div class="spec">
        Evo Guns
        <b>${esc(account.evo_guns || "—")}</b>
      </div>

    </div>


    <div class="account-actions">

      <button
        class="btn ghost details"
        type="button"
      >
        VIEW DETAILS
      </button>

      ${
        sold
          ? ""
          : `
            <a
              class="btn primary buy"
              href="${waUrl(account)}"
              target="_blank"
              rel="noopener"
            >
              WHATSAPP
            </a>
          `
      }

    </div>

  </div>

</article>
```

`;
}

/* =========================================
LOAD MAIN STORE
========================================= */

async function load() {

try {

```
const store = await get("/api/store");

console.log("STORE RESPONSE:", store);


/* SETTINGS */

state.settings =
  store.settings || {};


$("#storeName").textContent =
  state.settings.store_name ||
  "HASIYA ACCOUNT STORE";

$("#slogan").textContent =
  state.settings.slogan || "";

$("#secondary").textContent =
  state.settings.secondary_slogan || "";

$("#footerSlogan").textContent =
  state.settings.slogan || "";

$("#footerSecondary").textContent =
  state.settings.secondary_slogan || "";


const whatsapp =
  String(
    state.settings.whatsapp_number || ""
  ).replace(/\D/g, "");


$("#footerWhatsApp").href =
  whatsapp
    ? `https://wa.me/${whatsapp}`
    : "#";


/* PRICE RANGES */

const backendRanges =
  Array.isArray(store.priceRanges)
    ? store.priceRanges
    : Array.isArray(store.price_ranges)
      ? store.price_ranges
      : [];


/*
  Fallback ranges.
  This guarantees the price filters
  still appear even if backend doesn't
  send priceRanges.
*/

state.priceRanges =
  backendRanges.length
    ? backendRanges
    : [
        [1, 1000, 10000],
        [2, 10000, 20000],
        [3, 20000, 30000],
        [4, 30000, 40000],
        [5, 40000, 50000],
        [6, 50000, 60000],
        [7, 60000, 70000],
        [8, 70000, 80000],
        [9, 80000, 90000],
        [10, 90000, 100000],
        [11, 100000, 200000],
        [12, 200000, 300000],
        [13, 300000, 400000],
        [14, 400000, 500000],
        [15, 500000, 600000],
        [16, 600000, 700000],
        [17, 700000, 800000],
        [18, 800000, 900000],
        [19, 900000, 1000000]
      ];


renderPrices(state.priceRanges);


/* ACCOUNTS */

const accountsResponse =
  await get(
    `/api/accounts?range=${encodeURIComponent(state.range)}`
  );


const soldResponse =
  await get("/api/accounts?sold=1");


state.accounts =
  Array.isArray(accountsResponse)
    ? accountsResponse
    : Array.isArray(accountsResponse.accounts)
      ? accountsResponse.accounts
      : Array.isArray(accountsResponse.data)
        ? accountsResponse.data
        : [];


state.sold =
  Array.isArray(soldResponse)
    ? soldResponse
    : Array.isArray(soldResponse.accounts)
      ? soldResponse.accounts
      : Array.isArray(soldResponse.data)
        ? soldResponse.data
        : [];


console.log(
  "AVAILABLE ACCOUNTS:",
  state.accounts
);

console.log(
  "SOLD ACCOUNTS:",
  state.sold
);


render();
renderSold();

/*
  Trust / feature filter initialization.
*/

setupTrustFilters();
```

} catch (error) {

```
console.error(
  "STORE LOAD ERROR:",
  error
);


if ($("#accountsGrid")) {

  $("#accountsGrid").innerHTML = `
    <div class="muted">
      Unable to load accounts.
    </div>
  `;

}

if ($("#resultCount")) {

  $("#resultCount").textContent =
    "Unable to load accounts";

}
```

}

}

/* =========================================
PRICE FILTERS
========================================= */

function renderPrices(ranges) {

const grid =
$("#priceGrid");

if (!grid) return;

const labels = [
"ALL PRICES",
...ranges.map((range) => {

```
  const min =
    Number(range[1] ?? range[0] ?? 0);

  const max =
    Number(range[2] ?? range[1] ?? 0);

  return `Rs. ${min.toLocaleString()} – ${max.toLocaleString()}`;

})
```

];

grid.innerHTML =
labels.map((label, index) => {

```
  const rangeValue =
    index === 0
      ? "all"
      : String(index);


  const active =
    String(state.range) === rangeValue;


  return `
    <button
      type="button"
      class="price-btn ${active ? "active" : ""}"
      data-range="${rangeValue}"
    >
      ${label}
    </button>
  `;

}).join("");
```

document
.querySelectorAll(".price-btn")
.forEach((button) => {

```
  button.onclick = async () => {

    state.range =
      button.dataset.range || "all";

    state.page = 1;


    document
      .querySelectorAll(".price-btn")
      .forEach((item) =>
        item.classList.remove("active")
      );


    button.classList.add("active");


    try {

      const response =
        await get(
          `/api/accounts?range=${encodeURIComponent(state.range)}`
        );


      state.accounts =
        Array.isArray(response)
          ? response
          : Array.isArray(response.accounts)
            ? response.accounts
            : Array.isArray(response.data)
              ? response.data
              : [];


      render();

      location.hash = "accounts";

    } catch (error) {

      console.error(
        "PRICE FILTER ERROR:",
        error
      );

    }

  };

});
```

}

/* =========================================
MAIN ACCOUNT RENDER
========================================= */

function render() {

const grid =
$("#accountsGrid");

if (!grid) return;

const total =
state.accounts.length;

const pages =
Math.max(
1,
Math.ceil(
total / state.perPage
)
);

if (state.page > pages) {
state.page = pages;
}

const start =
(state.page - 1) *
state.perPage;

const slice =
state.accounts.slice(
start,
start + state.perPage
);

grid.innerHTML =
slice.length
? slice.map(
(account) =>
card(account, false)
).join("")
: `         <div class="muted">
          No accounts found in this price range.         </div>
      `;

if ($("#resultCount")) {

```
$("#resultCount").textContent =
  `${total} account${total === 1 ? "" : "s"} found`;
```

}

const pagination =
$("#pagination");

if (!pagination) return;

pagination.innerHTML =
pages > 1
? ` <button
       type="button"
       class="page"
       data-p="${Math.max(
         1,
         state.page - 1
       )}"
     >
PREVIOUS </button>

```
    ${Array.from(
      { length: pages },
      (_, index) => {

        const page =
          index + 1;

        return `
          <button
            type="button"
            class="page ${
              state.page === page
                ? "active"
                : ""
            }"
            data-p="${page}"
          >
            ${page}
          </button>
        `;

      }
    ).join("")}

    <button
      type="button"
      class="page"
      data-p="${Math.min(
        pages,
        state.page + 1
      )}"
    >
      NEXT
    </button>
  `
  : "";
```

document
.querySelectorAll(".page")
.forEach((button) => {

```
  button.onclick = () => {

    state.page =
      Number(
        button.dataset.p
      );


    render();


    const accountsSection =
      $("#accounts");

    if (accountsSection) {

      accountsSection.scrollIntoView({
        behavior: "smooth"
      });

    }

  };

});
```

document
.querySelectorAll(
"#accountsGrid .account-card"
)
.forEach((cardElement) => {

```
  cardElement.onclick = (event) => {

    if (
      event.target.closest("a") ||
      event.target.closest(".buy") ||
      event.target.closest("button")
    ) {
      if (
        event.target.closest(".details")
      ) {
        openDetails(
          Number(
            cardElement.dataset.id
          ),
          false
        );
      }

      return;
    }


    openDetails(
      Number(
        cardElement.dataset.id
      ),
      false
    );

  };

});
```

}

/* =========================================
SOLD
========================================= */

function renderSold() {

const grid =
$("#soldGrid");

if (!grid) return;

grid.innerHTML =
state.sold.length
? state.sold
.slice(0, 20)
.map(
(account) =>
card(account, true)
)
.join("")
: `         <div class="muted">
          No sold accounts yet.         </div>
      `;

document
.querySelectorAll(
"#soldGrid .account-card"
)
.forEach((element) => {

```
  element.onclick = () => {

    openDetails(
      Number(element.dataset.id),
      true
    );

  };

});
```

}

/* =========================================
DETAILS MODAL
========================================= */

function openDetails(id, sold) {

const source =
sold
? state.sold
: state.accounts;

const account =
source.find(
(item) =>
Number(item.id) ===
Number(id)
);

if (!account) return;

const featured =
Number(account.featured) === 1 ||
account.featured === true;

$("#detailBody").innerHTML = `

```
<div class="detail">

  <img
    src="${esc(account.image_url)}"
    alt="${esc(account.title)}"
  >


  <div class="account-top">

    <div>

      <h2>
        ${esc(account.title)}
      </h2>

      <div class="muted">
        ${esc(account.game)}
      </div>

    </div>

    <div class="price">
      ${money(account.price)}
    </div>

  </div>


  <span class="badge ${sold ? "sold" : ""}">

    ${
      sold
        ? "SOLD OUT"
        : featured
          ? "FEATURED"
          : "AVAILABLE"
    }

  </span>


  <div class="detail-grid">

    <div class="spec">
      Level
      <b>${esc(account.level || "—")}</b>
    </div>

    <div class="spec">
      Fashion / Bundles
      <b>${esc(account.fashion || "—")}</b>
    </div>

    <div class="spec">
      Evo Guns
      <b>${esc(account.evo_guns || "—")}</b>
    </div>

    <div class="spec">
      Emotes
      <b>${esc(account.emotes || "—")}</b>
    </div>

    <div class="spec">
      Likes
      <b>${esc(account.likes || "—")}</b>
    </div>

    <div class="spec">
      Bind
      <b>${esc(account.bind_info || "—")}</b>
    </div>

  </div>


  <p class="description">
    ${esc(
      account.description ||
      "No description provided."
    )}
  </p>


  ${
    sold
      ? ""
      : `
        <a
          class="btn primary"
          target="_blank"
          rel="noopener"
          href="${waUrl(account)}"
        >
          BUY / CONTACT ON WHATSAPP
        </a>
      `
  }

</div>
```

`;

$("#detailModal")
.classList
.add("show");

}

/* =========================================
MODAL
========================================= */

if ($("#modalClose")) {

$("#modalClose").onclick = () => {

```
$("#detailModal")
  .classList
  .remove("show");
```

};

}

if ($("#detailModal")) {

$("#detailModal").onclick = (event) => {

```
if (
  event.target.id ===
  "detailModal"
) {

  event.currentTarget
    .classList
    .remove("show");

}
```

};

}

/* =========================================
MOBILE NAV
========================================= */

if ($("#navToggle")) {

$("#navToggle").onclick = () => {

```
const links =
  $("#navLinks");

if (!links) return;

links.style.display =
  links.style.display === "flex"
    ? "none"
    : "flex";
```

};

}

/* =========================================
TRUST FILTERS
========================================= */

function setupTrustFilters() {

/*
Supports existing trust-filter buttons
without requiring a specific HTML design.
*/

const filters =
document.querySelectorAll(
"[data-trust-filter], .trust-filter"
);

if (!filters.length) {

```
console.log(
  "No trust filter elements found in HTML."
);

return;
```

}

filters.forEach((button) => {

```
button.onclick = () => {

  const value =
    button.dataset.trustFilter ||
    button.dataset.filter ||
    "all";


  filters.forEach((item) =>
    item.classList.remove("active")
  );

  button.classList.add("active");


  let filtered =
    [...state.accounts];


  if (
    value !== "all" &&
    value !== "available"
  ) {

    filtered =
      filtered.filter(
        (account) =>
          String(
            account.bind_info || ""
          )
          .toLowerCase()
          .includes(
            String(value)
              .toLowerCase()
          )
      );

  }


  state.page = 1;

  const old =
    state.accounts;

  state.accounts =
    filtered;

  render();

  /*
    Restore original accounts when
    ALL is selected.
  */

  if (value === "all") {

    state.accounts =
      old;

  }

};
```

});

}

/* =========================================
START
========================================= */

load();
