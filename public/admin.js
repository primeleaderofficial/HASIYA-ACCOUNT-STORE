const $ = (s) => document.querySelector(s);

let accounts = [];

const fields = [
"title",
"game",
"price",
"image_url",
"level",
"fashion",
"evo_guns",
"emotes",
"likes",
"bind_info",
"description",
"featured",
"status"
];

/* =========================================
API HELPER
========================================= */

async function api(url, opts = {}) {

const options = {
credentials: "same-origin",
...opts,
headers: {
"Content-Type": "application/json",
...(opts.headers || {})
}
};

let response;

try {
response = await fetch(url, options);
} catch (error) {
throw new Error("Unable to connect to server.");
}

let data = {};

try {
data = await response.json();
} catch {
data = {};
}

if (!response.ok) {

```
if (response.status === 401) {
  throw new Error("Admin session expired. Please login again.");
}

throw new Error(
  data.error ||
  data.message ||
  `Request failed (${response.status})`
);
```

}

return data;
}

/* =========================================
BOOT
========================================= */

async function boot() {

try {

```
const me = await api("/api/admin/me");

if (me && me.authenticated) {

  await showDashboard();

} else {

  $("#loginView").hidden = false;
  $("#dashboardView").hidden = true;

}
```

} catch (error) {

```
console.error("BOOT ERROR:", error);

$("#loginView").hidden = false;
$("#dashboardView").hidden = true;
```

}
}

/* =========================================
SHOW DASHBOARD
========================================= */

async function showDashboard() {

$("#loginView").hidden = true;
$("#dashboardView").hidden = false;

try {

```
await Promise.all([
  loadDash(),
  loadAccounts(),
  loadSettings()
]);
```

} catch (error) {

```
console.error("DASHBOARD LOAD ERROR:", error);

$("#dashboardView").hidden = true;
$("#loginView").hidden = false;

$("#loginMsg").textContent = error.message;
```

}
}

/* =========================================
LOGIN
========================================= */

$("#loginForm").onsubmit = async (e) => {

e.preventDefault();

const msg = $("#loginMsg");
const button = $("#loginForm button[type='submit']");

msg.textContent = "";
button.disabled = true;
button.textContent = "LOGGING IN...";

try {

```
const username = $("#loginUser").value.trim();
const password = $("#loginPass").value;

if (!username || !password) {
  throw new Error("Enter username and password.");
}

const result = await api(
  "/api/admin/login",
  {
    method: "POST",
    body: JSON.stringify({
      username,
      password
    })
  }
);

if (!result.success) {
  throw new Error(result.error || "Login failed.");
}

/*
  Small delay gives the browser time to
  commit the session cookie before the
  next authenticated API request.
*/

await new Promise(resolve => setTimeout(resolve, 100));

const me = await api("/api/admin/me");

if (!me.authenticated) {
  throw new Error(
    "Login succeeded but admin session was not created."
  );
}

await showDashboard();
```

} catch (error) {

```
console.error("LOGIN ERROR:", error);

msg.textContent = error.message;
```

} finally {

```
button.disabled = false;
button.textContent = "LOGIN TO CONTROL PANEL";
```

}
};

/* =========================================
LOGOUT
========================================= */

$("#logoutBtn").onclick = async () => {

try {

```
await api(
  "/api/admin/logout",
  {
    method: "POST"
  }
);
```

} catch (error) {

```
console.error("LOGOUT ERROR:", error);
```

}

location.reload();
};

/* =========================================
DASHBOARD STATS
========================================= */

async function loadDash() {

const d = await api("/api/admin/dashboard");

$("#sTotal").textContent =
Number(d.total || 0).toLocaleString("en-LK");

$("#sAvail").textContent =
Number(d.available || 0).toLocaleString("en-LK");

$("#sSold").textContent =
Number(d.sold || 0).toLocaleString("en-LK");

$("#sFeatured").textContent =
Number(d.featured || 0).toLocaleString("en-LK");

$("#sValue").textContent =
"Rs. " +
Number(d.totalListedValue || 0).toLocaleString("en-LK");
}

/* =========================================
LOAD ACCOUNTS
========================================= */

async function loadAccounts() {

const data = await api("/api/admin/accounts");

accounts = Array.isArray(data)
? data
: Array.isArray(data.accounts)
? data.accounts
: [];

renderAccounts();
}

/* =========================================
RENDER ACCOUNTS
========================================= */

function renderAccounts() {

const container = $("#adminAccounts");

if (!container) return;

const q = ($("#search").value || "")
.trim()
.toLowerCase();

const list = accounts.filter((a) => {

```
const text =
  `${a.title || ""} ${a.game || ""}`;

return text.toLowerCase().includes(q);
```

});

if (!list.length) {

```
container.innerHTML =
  '<div class="muted">No accounts found.</div>';

return;
```

}

container.innerHTML = list.map((a) => {

```
const image =
  esc(a.image_url || "");

const title =
  esc(a.title || "Untitled");

const game =
  esc(a.game || "");

const status =
  esc(a.status || "AVAILABLE");

const featured =
  Number(a.featured) === 1 ||
  a.featured === true;

const price =
  Number(a.price || 0).toLocaleString("en-LK");

return `
  <div class="admin-account">

    <img
      src="${image}"
      alt=""
      loading="lazy"
      onerror="this.style.opacity='.2'"
    >

    <div>

      <h3>
        ${title} — Rs. ${price}
      </h3>

      <p>
        ${game}
        ·
        ${status}
        ·
        ${featured ? "Featured" : "Normal"}
      </p>

    </div>

    <div class="admin-actions">

      <button
        class="btn ghost small"
        onclick="editAccount(${Number(a.id)})"
      >
        EDIT
      </button>

      ${
        status === "AVAILABLE"
          ? `
            <button
              class="btn ghost small"
              onclick="setStatus(${Number(a.id)}, 'SOLD')"
            >
              MARK SOLD
            </button>
          `
          : `
            <button
              class="btn ghost small"
              onclick="setStatus(${Number(a.id)}, 'AVAILABLE')"
            >
              RESTORE
            </button>
          `
      }

      <button
        class="btn ghost small"
        onclick="deleteAccount(${Number(a.id)})"
      >
        DELETE
      </button>

    </div>

  </div>
`;
```

}).join("");
}

/* =========================================
SEARCH
========================================= */

$("#search").oninput = renderAccounts;

/* =========================================
ESCAPE HTML
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
FILL EDIT FORM
========================================= */

function fill(account) {

fields.forEach((key) => {

```
const element = $("#" + key);

if (!element) return;

if (element.tagName === "SELECT") {

  if (key === "featured") {

    element.value =
      Number(account[key]) === 1
        ? "1"
        : "0";

  } else {

    element.value =
      account[key] || "";

  }

} else {

  element.value =
    account[key] ?? "";

}
```

});

$("#editId").value = account.id;

$("#formTitle").textContent =
"EDIT ACCOUNT";

$("#publishBtn").textContent =
"SAVE CHANGES";

$("#priceRange").value =
rangeLabel(Number(account.price || 0));

window.scrollTo({
top: 0,
behavior: "smooth"
});

}

/* =========================================
EDIT
========================================= */

window.editAccount = (id) => {

const account =
accounts.find(
(item) => Number(item.id) === Number(id)
);

if (account) {

```
fill(account);
```

}

};

/* =========================================
STATUS
========================================= */

window.setStatus = async (id, status) => {

try {

```
await api(
  `/api/admin/accounts/${id}/status`,
  {
    method: "PATCH",
    body: JSON.stringify({
      status
    })
  }
);

await refresh();
```

} catch (error) {

```
alert(error.message);
```

}

};

/* =========================================
DELETE
========================================= */

window.deleteAccount = async (id) => {

if (
!confirm(
"Delete this account permanently?"
)
) {
return;
}

try {

```
await api(
  `/api/admin/accounts/${id}`,
  {
    method: "DELETE"
  }
);

await refresh();
```

} catch (error) {

```
alert(error.message);
```

}

};

/* =========================================
REFRESH
========================================= */

async function refresh() {

try {

```
await Promise.all([
  loadDash(),
  loadAccounts()
]);

clearForm();
```

} catch (error) {

```
alert(error.message);
```

}

}

/* =========================================
CLEAR FORM
========================================= */

function clearForm() {

$("#accountForm").reset();

$("#editId").value = "";

$("#formTitle").textContent =
"ADD NEW ACCOUNT";

$("#publishBtn").textContent =
"PUBLISH ACCOUNT";

$("#priceRange").value = "";

$("#formMsg").textContent = "";

}

/* =========================================
CLEAR BUTTON
========================================= */

$("#clearForm").onclick = clearForm;

/* =========================================
PRICE RANGE
========================================= */

$("#price").oninput = (e) => {

$("#priceRange").value =
rangeLabel(
Number(e.target.value || 0)
);

};

function rangeLabel(price) {

const ranges = [
[1000, 10000],
[10000, 20000],
[20000, 30000],
[30000, 40000],
[40000, 50000],
[50000, 60000],
[60000, 70000],
[70000, 80000],
[80000, 90000],
[90000, 100000],
[100000, 200000],
[200000, 300000],
[300000, 400000],
[400000, 500000],
[500000, 600000],
[600000, 700000],
[700000, 800000],
[800000, 900000],
[900000, 1000000]
];

const found =
ranges.find(
([min, max]) =>
price >= min &&
price <= max
);

return found
? `Rs. ${found[0].toLocaleString()} – ${found[1].toLocaleString()}`
: "Outside preset ranges";

}

/* =========================================
ADD / EDIT ACCOUNT
========================================= */

$("#accountForm").onsubmit = async (e) => {

e.preventDefault();

const message = $("#formMsg");
const button = $("#publishBtn");

message.textContent = "";

button.disabled = true;
button.textContent = "SAVING...";

try {

```
const body = {};

fields.forEach((key) => {

  const element = $("#" + key);

  if (!element) return;

  if (key === "price") {

    body[key] =
      Number(element.value || 0);

  } else if (key === "featured") {

    body[key] =
      element.value === "1";

  } else {

    body[key] =
      element.value;

  }

});

const editId =
  $("#editId").value.trim();

const url =
  editId
    ? `/api/admin/accounts/${editId}`
    : "/api/admin/accounts";

const method =
  editId
    ? "PUT"
    : "POST";

const result = await api(
  url,
  {
    method,
    body: JSON.stringify(body)
  }
);

console.log(
  "ACCOUNT SAVE RESULT:",
  result
);

message.textContent =
  editId
    ? "Account updated successfully."
    : "Account published successfully.";

await refresh();
```

} catch (error) {

```
console.error(
  "ACCOUNT SAVE ERROR:",
  error
);

message.textContent =
  error.message;
```

} finally {

```
button.disabled = false;

button.textContent =
  $("#editId").value
    ? "SAVE CHANGES"
    : "PUBLISH ACCOUNT";
```

}

};

/* =========================================
SETTINGS
========================================= */

async function loadSettings() {

const data =
await api("/api/store");

const settings =
data.settings || {};

$("#whatsapp").value =
settings.whatsapp_number || "";

$("#setName").value =
settings.store_name || "";

$("#setSlogan").value =
settings.slogan || "";

$("#setSecondary").value =
settings.secondary_slogan || "";

}

/* =========================================
SAVE SETTINGS
========================================= */

$("#settingsForm").onsubmit = async (e) => {

e.preventDefault();

try {

```
await api(
  "/api/admin/settings",
  {
    method: "PUT",
    body: JSON.stringify({

      whatsapp_number:
        $("#whatsapp").value,

      store_name:
        $("#setName").value,

      slogan:
        $("#setSlogan").value,

      secondary_slogan:
        $("#setSecondary").value

    })
  }
);

$("#settingsMsg").textContent =
  "Settings saved.";
```

} catch (error) {

```
$("#settingsMsg").textContent =
  error.message;
```

}

};

/* =========================================
CHANGE PASSWORD
========================================= */

$("#passwordForm").onsubmit = async (e) => {

e.preventDefault();

try {

```
await api(
  "/api/admin/password",
  {
    method: "POST",
    body: JSON.stringify({

      currentPassword:
        $("#currentPassword").value,

      newPassword:
        $("#newPassword").value

    })
  }
);

$("#passwordMsg").textContent =
  "Password changed.";

$("#passwordForm").reset();
```

} catch (error) {

```
$("#passwordMsg").textContent =
  error.message;
```

}

};

/* =========================================
START
========================================= */

boot();
