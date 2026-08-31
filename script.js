// =====================================================
// KORUXA ORE & GEM MARKET
// Every Gem automatically adds 6 matching Ore.
// No individual Ore/Gem can exceed 15,000.
// =====================================================

const ORE_PER_GEM = 6;
const MAX_ITEM_QTY = 500000;


const API_URL = "https://koruxa-ore-gem-orders.spookbuilds.workers.dev";


// =====================================================
// STATE
//
// oreQty = EXTRA ore the player chose themselves.
// Required gem ore is calculated separately as gemQty * 6.
// =====================================================

const state = {
  menu: [],
  cart: [],
  search: ""
};


// =====================================================
// ELEMENTS
// =====================================================

const list = document.querySelector("#materialList");
const template = document.querySelector("#materialTemplate");
const search = document.querySelector("#search");
const cartItems = document.querySelector("#cartItems");
const grandTotal = document.querySelector("#grandTotal");
const cartCount = document.querySelector("#cartCount");
const validationMessage = document.querySelector("#validationMessage");
const customerName = document.querySelector("#customerName");
const orderNotes = document.querySelector("#orderNotes");
const website = document.querySelector("#website");
const submitOrder = document.querySelector("#submitOrder");
const submitStatus = document.querySelector("#submitStatus");
const setupWarning = document.querySelector("#setupWarning");


// =====================================================
// HELPERS
// =====================================================

const gp = value =>
  value == null
    ? "N/A"
    : `${Number(value).toLocaleString("en-GB")} GP`;

function isConfigured() {
  return API_URL && !API_URL.includes("FILL_HERE");
}

function clamp(value, min, max) {
  const number = Number.parseInt(value, 10);

  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.min(max, Math.max(min, number));
}

function getMaterial(materialName) {
  return state.menu.find(material => material.name === materialName);
}

function getCartEntry(materialName) {
  return state.cart.find(entry => entry.name === materialName);
}

function ensureCartEntry(materialName) {
  let entry = getCartEntry(materialName);

  if (!entry) {
    entry = {
      name: materialName,
      oreQty: 0,
      gemQty: 0
    };

    state.cart.push(entry);
  }

  return entry;
}

function requiredOre(entry) {
  return entry.gemQty * ORE_PER_GEM;
}

function totalOre(entry) {
  return entry.oreQty + requiredOre(entry);
}

function removeEmptyEntries() {
  state.cart = state.cart.filter(entry => entry.oreQty > 0 || entry.gemQty > 0);
}

function remainingOreCapacity(materialName) {
  const entry = getCartEntry(materialName);
  const currentTotalOre = entry ? totalOre(entry) : 0;

  return Math.max(0, MAX_ITEM_QTY - currentTotalOre);
}

function remainingGemCapacity(materialName) {
  const entry = getCartEntry(materialName);
  const currentGemQty = entry?.gemQty || 0;

  const remainingByGemLimit = MAX_ITEM_QTY - currentGemQty;
  const remainingByOreLimit = Math.floor(
    remainingOreCapacity(materialName) / ORE_PER_GEM
  );

  return Math.max(
    0,
    Math.min(remainingByGemLimit, remainingByOreLimit)
  );
}

function saveCart() {
  localStorage.setItem("koruxaOreGemOrder", JSON.stringify(state.cart));
}


// =====================================================
// LOAD MENU FROM WORKER
// =====================================================

async function loadMenu() {
  if (!isConfigured()) {
    setupWarning.hidden = false;
    list.innerHTML = `
      <div class="no-results">
        Fill in the Cloudflare Worker URL in script.js to load the market.
      </div>
    `;
    return;
  }

  try {
    const response = await fetch(`${API_URL}/menu`);

    if (!response.ok) {
      throw new Error("Could not load ore/gem prices.");
    }

    const data = await response.json();
    state.menu = data.materials;

    setupWarning.hidden = true;
    renderMaterials();
    renderCart();
  } catch (error) {
    console.error(error);

    list.innerHTML = `
      <div class="no-results">
        Could not load the market. Check the Worker URL in script.js.
      </div>
    `;
  }
}


// =====================================================
// MARKET CARDS
// =====================================================

function renderMaterials() {
  list.innerHTML = "";

  const filtered = state.menu.filter(material => {
    const text = `${material.name} ${material.gemName || ""}`.toLowerCase();
    return text.includes(state.search.toLowerCase());
  });

  if (!filtered.length) {
    list.innerHTML = `
      <div class="no-results">
        No matching materials found.
      </div>
    `;
    return;
  }

  filtered.forEach(material => {
    const node = template.content.cloneNode(true);
    const title = node.querySelector("h3");
    const prices = node.querySelector(".prices");
    const requirement = node.querySelector(".required-ore-note");
    const buttons = [...node.querySelectorAll(".type-btn")];
    const qty = node.querySelector(".qty-input");
    const lineTotal = node.querySelector(".line-total");
    const add = node.querySelector(".add-btn");

    const oreButton = buttons.find(button => button.dataset.type === "ore");
    const gemButton = buttons.find(button => button.dataset.type === "gem");

    let selectedType = "ore";

    function currentMaximum() {
      return selectedType === "gem"
        ? remainingGemCapacity(material.name)
        : remainingOreCapacity(material.name);
    }

    function unitPrice() {
      return selectedType === "ore"
        ? material.orePrice
        : material.gemPrice;
    }

    function updateCardDisplay() {
      if (selectedType === "gem" && material.gemName) {
        title.textContent = material.gemName;

        prices.innerHTML = `
          Gem <b>${gp(material.gemPrice)}</b>
          <span class="dot">•</span>
          Matching Ore <b>${material.name} — ${gp(material.orePrice)}</b>
        `;

        requirement.textContent =
          `Each ${material.gemName} automatically adds ${ORE_PER_GEM} ${material.name} Ore.`;
      } else {
        title.textContent = material.name;

        prices.innerHTML = material.gemName
          ? `
              Ore <b>${gp(material.orePrice)}</b>
              <span class="dot">•</span>
              Gem <b>${material.gemName} — ${gp(material.gemPrice)}</b>
            `
          : `
              Ore <b>${gp(material.orePrice)}</b>
              <span class="dot">•</span>
              Gem <b>N/A</b>
            `;

        requirement.textContent = "";
      }
    }

    function updateQuantityLimits() {
      const max = currentMaximum();

      qty.min = "1";
      qty.max = String(Math.max(max, 1));

      const unavailable = max <= 0;

      qty.disabled = unavailable;
      add.disabled = unavailable;

      if (unavailable) {
        qty.value = "1";
        add.textContent = selectedType === "gem"
          ? "Ore limit reached"
          : "15k limit reached";
      } else {
        add.textContent = "Add";

        if (qty.value !== "") {
          qty.value = String(clamp(qty.value, 1, max));
        }
      }
    }

    function updateLineTotal() {
      if (qty.value === "") {
        lineTotal.textContent = "—";
        return;
      }

      const max = currentMaximum();

      if (max <= 0) {
        lineTotal.textContent = "—";
        return;
      }

      const amount = clamp(qty.value, 1, max);

      if (selectedType === "gem") {
        const gemCost = material.gemPrice * amount;
        const forcedOreCost = material.orePrice * amount * ORE_PER_GEM;

        lineTotal.textContent = gp(gemCost + forcedOreCost);
      } else {
        lineTotal.textContent = gp(material.orePrice * amount);
      }
    }

    if (material.orePrice == null) {
      oreButton.disabled = true;
    }

    if (material.gemPrice == null || material.gemName == null) {
      gemButton.disabled = true;
    }

    if (material.orePrice != null) {
      selectedType = "ore";
      oreButton.classList.add("active");
    } else if (material.gemPrice != null) {
      selectedType = "gem";
      gemButton.classList.add("active");
    }

    buttons.forEach(button => {
      button.addEventListener("click", () => {
        if (button.disabled) {
          return;
        }

        selectedType = button.dataset.type;

        buttons.forEach(btn => {
          btn.classList.toggle("active", btn === button);
        });

        qty.value = "1";

        updateCardDisplay();
        updateQuantityLimits();
        updateLineTotal();
      });
    });

    // Let the field stay temporarily blank while the player types.
    qty.addEventListener("input", () => {
      if (qty.value === "") {
        lineTotal.textContent = "—";
        return;
      }

      const max = currentMaximum();

      if (max > 0) {
        const amount = clamp(qty.value, 1, max);
        qty.value = String(amount);
      }

      updateLineTotal();
    });

    qty.addEventListener("blur", () => {
      const max = currentMaximum();

      if (max <= 0) {
        qty.value = "1";
      } else {
        qty.value = String(clamp(qty.value || "1", 1, max));
      }

      updateLineTotal();
    });

    add.addEventListener("click", () => {
      if (add.disabled) {
        return;
      }

      const max = currentMaximum();
      const amount = clamp(qty.value || "1", 1, max);
      const entry = ensureCartEntry(material.name);

      if (selectedType === "gem") {
        entry.gemQty += amount;
      } else {
        entry.oreQty += amount;
      }

      removeEmptyEntries();
      saveCart();

      renderCart();
      renderMaterials();
    });

    updateCardDisplay();
    updateQuantityLimits();
    updateLineTotal();

    list.appendChild(node);
  });
}


// =====================================================
// VALIDATION
// =====================================================

function getOrderProblems() {
  const problems = [];

  for (const entry of state.cart) {
    const material = getMaterial(entry.name);

    if (!material) {
      problems.push(`Unknown material: ${entry.name}`);
      continue;
    }

    const oreTotal = totalOre(entry);

    if (oreTotal > MAX_ITEM_QTY) {
      problems.push(`${material.name} Ore is over the ${MAX_ITEM_QTY.toLocaleString()} limit.`);
    }

    if (entry.gemQty > MAX_ITEM_QTY) {
      problems.push(`${material.gemName || material.name + " Gem"} is over the ${MAX_ITEM_QTY.toLocaleString()} limit.`);
    }

    if (entry.gemQty > 0 && !material.gemName) {
      problems.push(`${material.name} does not have a gem available.`);
    }

    if (requiredOre(entry) > oreTotal) {
      problems.push(`${entry.gemQty} gems require ${requiredOre(entry)} matching ore.`);
    }
  }

  return problems;
}


// =====================================================
// BASKET
// =====================================================

function renderCart() {
  removeEmptyEntries();

  const problems = getOrderProblems();
  let itemCount = 0;
  let total = 0;

  cartItems.innerHTML = "";

  if (!state.cart.length) {
    cartItems.innerHTML = `
      <div class="empty-cart">
        Your basket is empty.
      </div>
    `;
  }

  state.cart.forEach(entry => {
    const material = getMaterial(entry.name);

    if (!material) {
      return;
    }

    const forcedOre = requiredOre(entry);
    const oreTotal = totalOre(entry);

    if (oreTotal > 0) {
      const row = document.createElement("div");
      row.className = "cart-row";

      let oreMeta = `${oreTotal.toLocaleString("en-GB")} × ${gp(material.orePrice)}`;
      let requiredText = "";

      if (forcedOre > 0) {
        if (entry.oreQty > 0) {
          requiredText = `${entry.oreQty.toLocaleString("en-GB")} extra + ${forcedOre.toLocaleString("en-GB")} required by ${entry.gemQty.toLocaleString("en-GB")} ${material.gemName}`;
        } else {
          requiredText = `${forcedOre.toLocaleString("en-GB")} required by ${entry.gemQty.toLocaleString("en-GB")} ${material.gemName}`;
        }
      }

      row.innerHTML = `
        <div>
          <div class="cart-name">${material.name} Ore</div>
          <div class="cart-meta">${oreMeta}</div>
          ${requiredText ? `<div class="cart-required">↳ ${requiredText}</div>` : ""}
        </div>

        <div class="cart-price">
          ${gp(oreTotal * material.orePrice)}
        </div>

        <button
          class="remove-btn"
          type="button"
          aria-label="Remove extra ${material.name} Ore"
          ${entry.oreQty <= 0 ? "disabled" : ""}
          title="${entry.oreQty <= 0 ? "This ore is required by the gem order" : "Remove extra ore"}"
        >
          ×
        </button>
      `;

      const removeOre = row.querySelector(".remove-btn");

      if (entry.oreQty > 0) {
        removeOre.addEventListener("click", () => {
          entry.oreQty = 0;
          removeEmptyEntries();
          saveCart();
          renderCart();
          renderMaterials();
        });
      }

      cartItems.appendChild(row);

      itemCount += oreTotal;
      total += oreTotal * material.orePrice;
    }

    if (entry.gemQty > 0 && material.gemName) {
      const row = document.createElement("div");
      row.className = "cart-row";

      row.innerHTML = `
        <div>
          <div class="cart-name">${material.gemName} (Uncut Gem)</div>
          <div class="cart-meta">
            ${entry.gemQty.toLocaleString("en-GB")} × ${gp(material.gemPrice)}
          </div>
          <div class="cart-required">
            ↳ Includes ${forcedOre.toLocaleString("en-GB")} matching ${material.name} Ore above
          </div>
        </div>

        <div class="cart-price">
          ${gp(entry.gemQty * material.gemPrice)}
        </div>

        <button
          class="remove-btn"
          type="button"
          aria-label="Remove ${material.gemName}"
          title="Remove gems and their required ore"
        >
          ×
        </button>
      `;

      row.querySelector(".remove-btn").addEventListener("click", () => {
        entry.gemQty = 0;
        removeEmptyEntries();
        saveCart();
        renderCart();
        renderMaterials();
      });

      cartItems.appendChild(row);

      itemCount += entry.gemQty;
      total += entry.gemQty * material.gemPrice;
    }
  });

  cartCount.textContent =
    `${itemCount.toLocaleString("en-GB")} item${itemCount === 1 ? "" : "s"}`;

  grandTotal.textContent = gp(total);

  if (problems.length) {
    validationMessage.className = "validation-message";
    validationMessage.textContent = `⚠ ${problems[0]}`;
  } else if (state.cart.some(entry => entry.gemQty > 0)) {
    validationMessage.className = "validation-message ok";
    validationMessage.textContent =
      `✓ Gem requirement included automatically: ${ORE_PER_GEM} matching ore per gem.`;
  } else {
    validationMessage.className = "validation-message";
    validationMessage.textContent = "";
  }

  saveCart();
}


// =====================================================
// ORDER PAYLOAD
// =====================================================

function buildOrderPayload() {
  return {
    playerName: customerName.value.trim(),
    notes: orderNotes.value.trim(),
    website: website.value,
    items: state.cart.map(entry => ({
      material: entry.name,
      extraOreQuantity: entry.oreQty,
      gemQuantity: entry.gemQty
    }))
  };
}


// =====================================================
// SEARCH
// =====================================================

search.addEventListener("input", event => {
  state.search = event.target.value;
  renderMaterials();
});


// =====================================================
// CUSTOMER INFO SAVE
// =====================================================

customerName.addEventListener("input", () => {
  localStorage.setItem("koruxaOreGemCustomerName", customerName.value);
});

orderNotes.addEventListener("input", () => {
  localStorage.setItem("koruxaOreGemOrderNotes", orderNotes.value);
});


// =====================================================
// CLEAR BASKET
// =====================================================

document.querySelector("#clearOrder").addEventListener("click", () => {
  if (!state.cart.length) {
    return;
  }

  const confirmed = confirm("Clear everything from your basket?");

  if (!confirmed) {
    return;
  }

  state.cart = [];
  submitStatus.textContent = "";
  submitStatus.className = "submit-status";

  saveCart();
  renderCart();
  renderMaterials();
});


// =====================================================
// SUBMIT ORDER
// =====================================================

submitOrder.addEventListener("click", async () => {
  submitStatus.className = "submit-status";
  submitStatus.textContent = "";

  const problems = getOrderProblems();

  if (!state.cart.length) {
    submitStatus.className = "submit-status error";
    submitStatus.textContent = "Add something to your basket before submitting.";
    return;
  }

  const name = customerName.value.trim();

  if (!name) {
    submitStatus.className = "submit-status error";
    submitStatus.textContent = "Please enter your Discord or game name.";
    customerName.focus();
    return;
  }

  if (problems.length) {
    submitStatus.className = "submit-status error";
    submitStatus.textContent = problems[0];
    return;
  }

  if (!isConfigured()) {
    submitStatus.className = "submit-status error";
    submitStatus.textContent = "Fill in the Cloudflare Worker URL in script.js first.";
    return;
  }

  const order = buildOrderPayload();

  submitOrder.disabled = true;
  submitOrder.textContent = "Submitting...";

  try {
    const response = await fetch(`${API_URL}/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(order)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Order submission failed.");
    }

    state.cart = [];
    orderNotes.value = "";

    localStorage.removeItem("koruxaOreGemOrderNotes");
    saveCart();

    renderCart();
    renderMaterials();

    // Show AFTER renderCart so it cannot be cleared by the basket refresh.
    submitStatus.className = "submit-status success";
    submitStatus.textContent =
      `✓ Order ${data.orderId} submitted successfully! Sent to the clan Discord.`;

    setTimeout(() => {
      submitStatus.className = "submit-status";
      submitStatus.textContent = "";
    }, 5000);
  } catch (error) {
    console.error(error);

    submitStatus.className = "submit-status error";
    submitStatus.textContent =
      error.message || "Something went wrong submitting the order. Please try again.";
  } finally {
    submitOrder.disabled = false;
    submitOrder.textContent = "Submit Order";
  }
});


// =====================================================
// LOAD SAVED INFORMATION
// =====================================================

try {
  const savedCart = JSON.parse(
    localStorage.getItem("koruxaOreGemOrder") || "[]"
  );

  if (Array.isArray(savedCart)) {
    state.cart = savedCart
      .filter(entry => entry && typeof entry.name === "string")
      .map(entry => ({
        name: entry.name,
        oreQty: clamp(entry.oreQty || 0, 0, MAX_ITEM_QTY),
        gemQty: clamp(entry.gemQty || 0, 0, MAX_ITEM_QTY)
      }));
  }
} catch {
  state.cart = [];
}

customerName.value =
  localStorage.getItem("koruxaOreGemCustomerName") || "";

orderNotes.value =
  localStorage.getItem("koruxaOreGemOrderNotes") || "";


// =====================================================
// START
// =====================================================

loadMenu();
