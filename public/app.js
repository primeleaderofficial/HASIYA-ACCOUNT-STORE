const state = {
  accounts: [],
  sold: [],
  page: 1,
  range: 0,
  perPage: 12,
  settings: {},
  priceRanges: []
};

const $ = (selector) =>
  document.querySelector(selector);

const $$ = (selector) =>
  Array.from(document.querySelectorAll(selector));

/* =========================================================
   API
========================================================= */

async function get(url) {
  const response = await fetch(url, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store"
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data.error ||
      `Request failed (${response.status})`
    );
  }

  return data;
}

/* =========================================================
   ESCAPE HTML
========================================================= */

function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => {
      const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      };

      return map[char];
    }
  );
}

/* =========================================================
   PRICE
========================================================= */

function money(value) {
  return Number(value || 0).toLocaleString(
    "en-LK"
  );
}

/* =========================================================
   LOAD STORE
========================================================= */

async function load() {
  try {
    const store = await get("/api/store");

    state.settings =
      store.settings || {};

    state.priceRanges =
      Array.isArray(store.priceRanges)
        ? store.priceRanges
        : Array.isArray(store.price_ranges)
        ? store.price_ranges
        : [];

    applySettings();

    renderPrices();

    await loadAccounts();
    await loadSold();

  } catch (error) {
    console.error(error);

    const grid = $("#accountsGrid");

    if (grid) {
      grid.innerHTML = `
        <div class="empty-state">
          <h3>Unable to load accounts</h3>
          <p>${esc(error.message)}</p>
        </div>
      `;
    }

    const priceGrid = $("#priceGrid");

    if (priceGrid) {
      priceGrid.innerHTML = `
        <button class="price-btn active" data-range="0">
          ALL PRICES
        </button>
      `;
    }
  }
}

/* =========================================================
   SETTINGS
========================================================= */

function applySettings() {
  const settings = state.settings;

  const storeName = settings.store_name ||
    "HASIYA ACCOUNT STORE";

  const slogan = settings.slogan ||
    "Premium Gaming Accounts";

  const secondary =
    settings.secondary_slogan ||
    "Trusted • Secure • Fast";

  if ($("#storeName")) {
    $("#storeName").textContent =
      storeName;
  }

  if ($("#slogan")) {
    $("#slogan").textContent =
      slogan;
  }

  if ($("#secondary")) {
    $("#secondary").textContent =
      secondary;
  }

  if ($("#footerSlogan")) {
    $("#footerSlogan").textContent =
      slogan;
  }

  if ($("#footerSecondary")) {
    $("#footerSecondary").textContent =
      secondary;
  }

  if ($("#footerWhatsApp")) {
    const whatsapp =
      settings.whatsapp_number || "";

    if (whatsapp) {
      $("#footerWhatsApp").textContent =
        whatsapp;
    }
  }

  document.title =
    `${storeName} — ${slogan}`;
}

/* =========================================================
   PRICE FILTERS
========================================================= */

function renderPrices() {
  const grid = $("#priceGrid");

  if (!grid) {
    console.warn(
      "#priceGrid not found"
    );
    return;
  }

  let html = `
    <button
      type="button"
      class="price-btn active"
      data-range="0"
    >
      ALL PRICES
    </button>
  `;

  for (const range of state.priceRanges) {
    const id =
      Number(range.id);

    const label =
      range.label ||
      `Rs. ${money(range.min)} – ${money(range.max)}`;

    html += `
      <button
        type="button"
        class="price-btn"
        data-range="${id}"
      >
        ${esc(label)}
      </button>
    `;
  }

  grid.innerHTML = html;

  $$("#priceGrid .price-btn").forEach(
    (button) => {
      button.addEventListener(
        "click",
        () => {
          const range =
            Number(
              button.dataset.range
            );

          selectPriceRange(range);
        }
      );
    }
  );
}

/* =========================================================
   SELECT PRICE
========================================================= */

async function selectPriceRange(range) {
  state.range = Number(range || 0);
  state.page = 1;

  $$("#priceGrid .price-btn")
    .forEach((button) => {
      button.classList.toggle(
        "active",
        Number(button.dataset.range) ===
          state.range
      );
    });

  await loadAccounts();

  const accountsSection =
    $("#accountsGrid");

  if (accountsSection) {
    accountsSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
}

/* =========================================================
   LOAD ACCOUNTS
========================================================= */

async function loadAccounts() {
  const grid =
    $("#accountsGrid");

  if (grid) {
    grid.innerHTML = `
      <div class="loading-state">
        Loading accounts...
      </div>
    `;
  }

  const url =
    state.range > 0
      ? `/api/accounts?range=${encodeURIComponent(
          state.range
        )}`
      : "/api/accounts";

  try {
    const data =
      await get(url);

    if (Array.isArray(data)) {
      state.accounts = data;
    } else if (
      Array.isArray(data.accounts)
    ) {
      state.accounts =
        data.accounts;
    } else if (
      Array.isArray(data.data)
    ) {
      state.accounts =
        data.data;
    } else {
      state.accounts = [];
    }

    renderAccounts();

  } catch (error) {
    console.error(
      "Accounts error:",
      error
    );

    state.accounts = [];

    if (grid) {
      grid.innerHTML = `
        <div class="empty-state">
          <h3>Could not load accounts</h3>
          <p>${esc(error.message)}</p>
        </div>
      `;
    }
  }
}

/* =========================================================
   LOAD SOLD
========================================================= */

async function loadSold() {
  const grid =
    $("#soldGrid");

  if (grid) {
    grid.innerHTML = `
      <div class="loading-state">
        Loading...
      </div>
    `;
  }

  try {
    const data =
      await get("/api/accounts?sold=1");

    if (Array.isArray(data)) {
      state.sold = data;
    } else if (
      Array.isArray(data.accounts)
    ) {
      state.sold =
        data.accounts;
    } else if (
      Array.isArray(data.data)
    ) {
      state.sold =
        data.data;
    } else {
      state.sold = [];
    }

    renderSold();

  } catch (error) {
    console.error(
      "Sold accounts error:",
      error
    );

    state.sold = [];

    renderSold();
  }
}

/* =========================================================
   ACCOUNT CARD
========================================================= */

function accountCard(account) {
  const image =
    account.image_url ||
    "https://via.placeholder.com/600x400?text=HASIYA+ACCOUNT";

  const featured =
    account.featured
      ? `<span class="account-badge">FEATURED</span>`
      : "";

  return `
    <article
      class="account-card"
      data-id="${Number(account.id)}"
    >
      <div class="account-image-wrap">
        ${featured}

        <img
          class="account-image"
          src="${esc(image)}"
          alt="${esc(account.title)}"
          loading="lazy"
          onerror="this.src='https://via.placeholder.com/600x400?text=ACCOUNT'"
        >
      </div>

      <div class="account-content">

        <div class="account-game">
          ${esc(account.game || "Free Fire")}
        </div>

        <h3 class="account-title">
          ${esc(account.title)}
        </h3>

        <div class="account-price">
          Rs. ${money(account.price)}
        </div>

        <div class="account-meta">

          ${
            account.level
              ? `
                <span>
                  Level ${esc(account.level)}
                </span>
              `
              : ""
          }

          ${
            account.likes
              ? `
                <span>
                  ${esc(account.likes)} Likes
                </span>
              `
              : ""
          }

          ${
            account.fashion
              ? `
                <span>
                  ${esc(account.fashion)}
                </span>
              `
              : ""
          }

        </div>

        <button
          type="button"
          class="account-view-btn"
        >
          VIEW DETAILS
        </button>

      </div>
    </article>
  `;
}

/* =========================================================
   RENDER ACCOUNTS
========================================================= */

function renderAccounts() {
  const grid =
    $("#accountsGrid");

  if (!grid) return;

  const total =
    state.accounts.length;

  if ($("#resultCount")) {
    $("#resultCount").textContent =
      `${total} account${total === 1 ? "" : "s"} found`;
  }

  if (total === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>No accounts found</h3>
        <p>
          No accounts are available
          in this price range.
        </p>
      </div>
    `;

    renderPagination(0);
    return;
  }

  const start =
    (state.page - 1) *
    state.perPage;

  const end =
    start + state.perPage;

  const visible =
    state.accounts.slice(
      start,
      end
    );

  grid.innerHTML =
    visible
      .map(accountCard)
      .join("");

  $$("#accountsGrid .account-card")
    .forEach((card) => {
      card.addEventListener(
        "click",
        () => {
          const id =
            Number(card.dataset.id);

          const account =
            state.accounts.find(
              a =>
                Number(a.id) === id
            );

          if (account) {
            openDetails(account);
          }
        }
      );
    });

  renderPagination(total);
}

/* =========================================================
   PAGINATION
========================================================= */

function renderPagination(total) {
  const pagination =
    $("#pagination");

  if (!pagination) return;

  const pages =
    Math.ceil(
      total / state.perPage
    );

  if (pages <= 1) {
    pagination.innerHTML = "";
    return;
  }

  let html = "";

  for (
    let i = 1;
    i <= pages;
    i++
  ) {
    html += `
      <button
        type="button"
        class="page-btn ${
          i === state.page
            ? "active"
            : ""
        }"
        data-page="${i}"
      >
        ${i}
      </button>
    `;
  }

  pagination.innerHTML =
    html;

  $$("#pagination .page-btn")
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          state.page =
            Number(
              button.dataset.page
            );

          renderAccounts();

          window.scrollTo({
            top: 0,
            behavior: "smooth"
          });
        }
      );
    });
}

/* =========================================================
   SOLD ACCOUNTS
========================================================= */

function renderSold() {
  const grid =
    $("#soldGrid");

  if (!grid) return;

  if (state.sold.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>No sold accounts</h3>
        <p>
          Sold accounts will appear here.
        </p>
      </div>
    `;

    return;
  }

  grid.innerHTML =
    state.sold
      .map(account => {
        const image =
          account.image_url ||
          "https://via.placeholder.com/600x400?text=SOLD";

        return `
          <article
            class="account-card sold-card"
            data-id="${Number(account.id)}"
          >

            <div class="account-image-wrap">

              <span class="account-badge sold-badge">
                SOLD OUT
              </span>

              <img
                class="account-image"
                src="${esc(image)}"
                alt="${esc(account.title)}"
                loading="lazy"
              >

            </div>

            <div class="account-content">

              <div class="account-game">
                ${esc(account.game || "Free Fire")}
              </div>

              <h3 class="account-title">
                ${esc(account.title)}
              </h3>

              <div class="account-price">
                Rs. ${money(account.price)}
              </div>

              <button
                type="button"
                class="account-view-btn"
              >
                VIEW DETAILS
              </button>

            </div>

          </article>
        `;
      })
      .join("");

  $$("#soldGrid .account-card")
    .forEach(card => {
      card.addEventListener(
        "click",
        () => {
          const id =
            Number(card.dataset.id);

          const account =
            state.sold.find(
              a =>
                Number(a.id) === id
            );

          if (account) {
            openDetails(
              account,
              true
            );
          }
        }
      );
    });
}

/* =========================================================
   DETAILS MODAL
========================================================= */

function openDetails(
  account,
  sold = false
) {
  const modal =
    $("#detailModal");

  const body =
    $("#detailBody");

  if (!modal || !body) {
    return;
  }

  const image =
    account.image_url ||
    "https://via.placeholder.com/700x500?text=ACCOUNT";

  body.innerHTML = `
    <div class="detail-layout">

      <div class="detail-image">
        <img
          src="${esc(image)}"
          alt="${esc(account.title)}"
        >
      </div>

      <div class="detail-info">

        <div class="account-game">
          ${esc(account.game || "Free Fire")}
        </div>

        <h2>
          ${esc(account.title)}
        </h2>

        <div class="detail-price">
          Rs. ${money(account.price)}
        </div>

        ${
          account.level
            ? `
              <div class="detail-row">
                <strong>Level</strong>
                <span>${esc(account.level)}</span>
              </div>
            `
            : ""
        }

        ${
          account.fashion
            ? `
              <div class="detail-row">
                <strong>Fashion</strong>
                <span>${esc(account.fashion)}</span>
              </div>
            `
            : ""
        }

        ${
          account.evo_guns
            ? `
              <div class="detail-row">
                <strong>Evo Guns</strong>
                <span>${esc(account.evo_guns)}</span>
              </div>
            `
            : ""
        }

        ${
          account.emotes
            ? `
              <div class="detail-row">
                <strong>Emotes</strong>
                <span>${esc(account.emotes)}</span>
              </div>
            `
            : ""
        }

        ${
          account.likes
            ? `
              <div class="detail-row">
                <strong>Likes</strong>
                <span>${esc(account.likes)}</span>
              </div>
            `
            : ""
        }

        ${
          account.bind_info
            ? `
              <div class="detail-row">
                <strong>Bind</strong>
                <span>${esc(account.bind_info)}</span>
              </div>
            `
            : ""
        }

        ${
          account.description
            ? `
              <div class="detail-description">
                ${esc(account.description)}
              </div>
            `
            : ""
        }

        ${
          sold
            ? `
              <div class="sold-message">
                SOLD OUT
              </div>
            `
            : `
              <a
                class="contact-account-btn"
                href="#contact"
              >
                CONTACT TO BUY
              </a>
            `
        }

      </div>

    </div>
  `;

  modal.hidden = false;
  document.body.classList.add(
    "modal-open"
  );
}

/* =========================================================
   CLOSE MODAL
========================================================= */

function closeModal() {
  const modal =
    $("#detailModal");

  if (modal) {
    modal.hidden = true;
  }

  document.body.classList.remove(
    "modal-open"
  );
}

function setupModal() {
  const close =
    $("#modalClose");

  if (close) {
    close.addEventListener(
      "click",
      closeModal
    );
  }

  const modal =
    $("#detailModal");

  if (modal) {
    modal.addEventListener(
      "click",
      event => {
        if (
          event.target === modal
        ) {
          closeModal();
        }
      }
    );
  }

  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Escape"
      ) {
        closeModal();
      }
    }
  );
}

/* =========================================================
   NAVIGATION
========================================================= */

function setupNavigation() {
  $$("a[href^='#']")
    .forEach(link => {
      link.addEventListener(
        "click",
        event => {
          const targetId =
            link
              .getAttribute("href")
              .slice(1);

          if (!targetId) return;

          const target =
            document.getElementById(
              targetId
            );

          if (!target) return;

          event.preventDefault();

          target.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });
        }
      );
    });
}

/* =========================================================
   START
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    setupModal();
    setupNavigation();

    await load();
  }
);
