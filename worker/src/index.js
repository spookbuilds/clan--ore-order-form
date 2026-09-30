// =====================================================
// KORUXA ORE & GEM ORDERS — CLOUDFLARE WORKER
//
// IMPORTANT:
// Do NOT paste the Discord webhook into this file.
// Store it as the Cloudflare secret DISCORD_WEBHOOK_URL.
// =====================================================

const BASE_ORE_PER_GEM = 50;
const HIGH_QTY_ORE_PER_GEM = 100;
const HIGH_QTY_GEM_THRESHOLD = 4000;

const MAX_ITEM_QTY = 500000;


// =====================================================
// PRICES — SOURCE OF TRUTH
// =====================================================

const MATERIALS = [
  { name: "Dustite", orePrice: 1000, gemName: "Opal", gemPrice: 25000 },
  { name: "Void Rift", orePrice: 350, gemName: null, gemPrice: null },
  { name: "Gold", orePrice: 1500, gemName: null, gemPrice: null },
  { name: "Copite", orePrice: 550, gemName: "Amber", gemPrice: 27000 },
  { name: "Velorite", orePrice: 650, gemName: "Aquastone", gemPrice: 29000 },
  { name: "Crimsite", orePrice: 750, gemName: "Garnet", gemPrice: 31500 },
  { name: "Shalore", orePrice: 850, gemName: "Frostgem", gemPrice: 33500 },
  { name: "Noctite", orePrice: 950, gemName: "Voidopal", gemPrice: 35500 },
  { name: "Auorite", orePrice: 1050, gemName: "Sunstone", gemPrice: 37500 },
  { name: "Vexite", orePrice: 1150, gemName: "Duskgem", gemPrice: 39500 },
  { name: "Zephyne", orePrice: 1250, gemName: "Stormheart", gemPrice: 41500 },
  { name: "Korunite", orePrice: 1350, gemName: "Astralite", gemPrice: 44000 },
  { name: "Drakonite", orePrice: 1450, gemName: "Emberstone", gemPrice: 46000 },
  { name: "Potent Void Rift", orePrice: 350, gemName: null, gemPrice: null },
  { name: "Pyrethium", orePrice: 5000, gemName: "Magmaheart", gemPrice: 100000 },
  { name: "Infernite", orePrice: 40000, gemName: "Pyreshard", gemPrice: 100000 }
];

const MATERIAL_BY_NAME = new Map(
  MATERIALS.map(material => [material.name, material])
);


// =====================================================
// CORS
// =====================================================

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = allowedOrigins(env);

  const headers = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };

  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function isOriginAllowed(request, env) {
  const origin = request.headers.get("Origin");

  if (!origin) {
    return true;
  }

  return allowedOrigins(env).includes(origin);
}

function jsonResponse(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": "application/json; charset=UTF-8"
    }
  });
}


// =====================================================
// HELPERS
// =====================================================

function cleanSingleLine(value, maxLength) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanNotes(value, maxLength) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-GB").format(value);
}

function makeOrderId() {
  const datePart = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const randomPart = crypto.randomUUID().slice(0, 6).toUpperCase();

  return `ORE-${datePart}-${randomPart}`;
}


// =====================================================
// VALIDATE + PRICE SERVER-SIDE
// =====================================================

function validateAndPriceOrder(body) {
  const playerName = cleanSingleLine(body.playerName, 60);
  const notes = cleanNotes(body.notes, 500);
  const honeypot = cleanSingleLine(body.website, 100);

  if (honeypot) {
    return { error: "Order rejected." };
  }

  if (playerName.length < 2) {
    return { error: "A Koruxa/Discord name is required." };
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return { error: "The basket is empty." };
  }

  if (body.items.length > MATERIALS.length) {
    return { error: "There are too many material groups in this order." };
  }

  const seen = new Set();
  const pricedGroups = [];

  let grandTotal = 0;
  let totalUnits = 0;

  for (const item of body.items) {
    const materialName = cleanSingleLine(item.material, 60);
    const material = MATERIAL_BY_NAME.get(materialName);

    if (!material) {
      return { error: `Unknown material: ${materialName || "blank"}` };
    }

    if (seen.has(materialName)) {
      return { error: `Duplicate material group: ${materialName}` };
    }

    seen.add(materialName);

    const extraOreQuantity = Number(item.extraOreQuantity || 0);
    const gemQuantity = Number(item.gemQuantity || 0);

    if (!Number.isInteger(extraOreQuantity) || extraOreQuantity < 0) {
      return { error: `Invalid ore quantity for ${materialName}.` };
    }

    if (!Number.isInteger(gemQuantity) || gemQuantity < 0) {
      return { error: `Invalid gem quantity for ${materialName}.` };
    }

    if (gemQuantity > 0 && (!material.gemName || material.gemPrice == null)) {
      return { error: `${materialName} does not have a gem available.` };
    }

  const baseGemQuantity =
    Math.min(gemQuantity, HIGH_QTY_GEM_THRESHOLD);

  const highQtyGemQuantity =
    Math.max(0, gemQuantity - HIGH_QTY_GEM_THRESHOLD);

  const requiredOreQuantity =
    (baseGemQuantity * BASE_ORE_PER_GEM) +
    (highQtyGemQuantity * HIGH_QTY_ORE_PER_GEM);

  const totalOreQuantity =
    extraOreQuantity + requiredOreQuantity;

    if (extraOreQuantity > MAX_ITEM_QTY) {
      return {
        error: `${materialName} Ore cannot exceed ${formatNumber(MAX_ITEM_QTY)}.`
      };
    }

    if (gemQuantity > MAX_ITEM_QTY) {
      return {
        error: `${material.gemName || materialName + " Gem"} cannot exceed ${formatNumber(MAX_ITEM_QTY)}.`
      };
    }

    if (extraOreQuantity === 0 && gemQuantity === 0) {
      continue;
    }

    const oreTotal = totalOreQuantity * material.orePrice;
    const gemTotal = gemQuantity > 0
      ? gemQuantity * material.gemPrice
      : 0;

    const groupTotal = oreTotal + gemTotal;

    grandTotal += groupTotal;
    totalUnits += totalOreQuantity + gemQuantity;

    pricedGroups.push({
      material: material.name,
      orePrice: material.orePrice,
      extraOreQuantity,
      requiredOreQuantity,
      baseGemQuantity,
      highQtyGemQuantity,
      totalOreQuantity,
      gemName: material.gemName,
      gemPrice: material.gemPrice,
      gemQuantity,
      oreTotal,
      gemTotal,
      groupTotal
    });
  }

  if (pricedGroups.length === 0) {
    return { error: "The basket is empty." };
  }

  if (!Number.isSafeInteger(grandTotal)) {
    return { error: "Order total is too large." };
  }

  return {
    order: {
      playerName,
      notes,
      groups: pricedGroups,
      totalUnits,
      grandTotal
    }
  };
}


// =====================================================
// DISCORD MESSAGE
// =====================================================

function buildDiscordPayload(order, orderId) {
  const lines = [];

  for (const group of order.groups) {
    if (group.totalOreQuantity > 0) {
      let oreLine =
        `⛏️ **${formatNumber(group.totalOreQuantity)} × ${group.material} Ore**\n` +
        `↳ ${formatNumber(group.orePrice)} each · **${formatNumber(group.oreTotal)}**`;

    if (group.requiredOreQuantity > 0) {
      let tierText;

      if (group.highQtyGemQuantity > 0) {
        tierText =
          `${formatNumber(group.baseGemQuantity)} @ ${BASE_ORE_PER_GEM} ore each + ` +
          `${formatNumber(group.highQtyGemQuantity)} @ ${HIGH_QTY_ORE_PER_GEM} ore each`;
      } else {
        tierText =
          `${formatNumber(group.baseGemQuantity)} @ ${BASE_ORE_PER_GEM} ore each`;
      }

      if (group.extraOreQuantity > 0) {
        oreLine +=
          `\n↳ ${formatNumber(group.extraOreQuantity)} extra + ` +
          `${formatNumber(group.requiredOreQuantity)} required for ` +
          `${formatNumber(group.gemQuantity)} ${group.gemName}\n` +
          `↳ ${tierText}`;
      } else {
        oreLine +=
          `\n↳ ${formatNumber(group.requiredOreQuantity)} required for ` +
          `${formatNumber(group.gemQuantity)} ${group.gemName}\n` +
          `↳ ${tierText}`;
      }
    }

      lines.push(oreLine);
    }

    if (group.gemQuantity > 0) {
      lines.push(
        `💎 **${formatNumber(group.gemQuantity)} × ${group.gemName}**\n` +
        `↳ ${formatNumber(group.gemPrice)} each · **${formatNumber(group.gemTotal)}**`
      );
    }
  }

  const fields = [
    {
      name: "Player",
      value: order.playerName,
      inline: true
    },
    {
      name: "Total units",
      value: formatNumber(order.totalUnits),
      inline: true
    },
    {
      name: "Order total",
      value: `🪙 **${formatNumber(order.grandTotal)}**`,
      inline: true
    }
  ];

  if (order.notes) {
    fields.push({
      name: "Notes",
      value: order.notes,
      inline: false
    });
  }

  return {
    username: "Clan Ore & Gem Market",
    allowed_mentions: {
      parse: []
    },
    embeds: [
      {
        title: "⛏️ New Ore & Uncut Gem Order",
        description: lines.join("\n\n").slice(0, 3900),
        color: 15247151,
        fields,
        footer: {
        text: `Order ${orderId} · First 4,000 gems: 50 ore each · Gems over 4,000: 100 ore each`        },
        timestamp: new Date().toISOString()
      }
    ]
  };
}

async function sendToDiscord(webhookUrl, payload) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    console.error("Discord webhook failed:", response.status, details);
    throw new Error("Discord webhook failed.");
  }
}


// =====================================================
// WORKER
// =====================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      if (!isOriginAllowed(request, env)) {
        return new Response(null, { status: 403 });
      }

      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env)
      });
    }

    if (!isOriginAllowed(request, env)) {
      return jsonResponse(request, env, { error: "Origin not allowed." }, 403);
    }

    if (request.method === "GET" && url.pathname === "/menu") {
      return new Response(JSON.stringify({ materials: MATERIALS }), {
        status: 200,
        headers: {
          ...corsHeaders(request, env),
          "Content-Type": "application/json; charset=UTF-8",
          "Cache-Control": "public, max-age=300"
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return jsonResponse(request, env, {
        ok: true,
        service: "Koruxa Ore & Gem Orders API"
      });
    }

    if (request.method === "POST" && url.pathname === "/order") {
      if (!env.DISCORD_WEBHOOK_URL) {
        console.error("DISCORD_WEBHOOK_URL secret is missing.");
        return jsonResponse(
          request,
          env,
          { error: "Order service is not configured." },
          500
        );
      }

      const contentType = request.headers.get("Content-Type") || "";

      if (!contentType.toLowerCase().includes("application/json")) {
        return jsonResponse(request, env, { error: "JSON required." }, 415);
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return jsonResponse(request, env, { error: "Invalid JSON." }, 400);
      }

      const result = validateAndPriceOrder(body);

      if (result.error) {
        return jsonResponse(request, env, { error: result.error }, 400);
      }

      const orderId = makeOrderId();
      const discordPayload = buildDiscordPayload(result.order, orderId);

      try {
        await sendToDiscord(env.DISCORD_WEBHOOK_URL, discordPayload);
      } catch (error) {
        console.error(error);

        return jsonResponse(
          request,
          env,
          { error: "The order could not be delivered to Discord." },
          502
        );
      }

      return jsonResponse(request, env, {
        ok: true,
        orderId,
        total: result.order.grandTotal
      });
    }

    return jsonResponse(request, env, { error: "Not found." }, 404);
  }
};
