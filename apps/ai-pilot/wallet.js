const el = (id) => document.getElementById(id);
let token = "",
  wallet,
  busy = false;
const labels = { monthly: "Gói tháng", annual: "Gói năm", topup: "Mua thêm credit" };
const states = {
  pending: "Chờ thanh toán",
  paid: "Đã thanh toán",
  expired: "Đã hết hạn",
  held: "Chờ đối soát",
  settled: "Đã quyết toán",
};
const errors = {
  personal_credit_exhausted: "Hết hạn mức khả dụng. Bạn có thể mua thêm credit hoặc bật dùng credit đã mua.",
  supplier_credit_unavailable: "Quỹ nhà cung cấp đang thiếu. Vui lòng liên hệ quản trị viên.",
  price_changed_refresh: "Giá vừa thay đổi. Vui lòng cập nhật số dư và xem lại giá.",
  reconciliation_required: "Đang chờ đối soát. Kiểm tra lịch sử trước khi gửi lại.",
  invalid_pilot_token: "Mã truy cập không hợp lệ.",
  subscription_active_or_pending: "Bạn đã có gói hoặc đơn đang chờ.",
  test_checkout_not_configured: "Quản trị viên chưa cấu hình cổng thanh toán thử.",
};
const credits = (n) =>
  new Intl.NumberFormat("vi", { maximumFractionDigits: 6 }).format(n / 1000000) + " USD credit";
async function api(path, body, id) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      ...(id ? { "idempotency-key": id } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(errors[data.error.code] || data.error.code);
  return data;
}
function action(fn) {
  return async (event) => {
    event?.preventDefault();
    if (busy) return;
    busy = true;
    el("status").textContent = "";
    try {
      await fn();
    } catch (e) {
      el("status").textContent = e.message;
    } finally {
      busy = false;
    }
  };
}
async function refresh() {
  wallet = await api("/wallet");
  const fmt = new Intl.NumberFormat("vi", { style: "currency", currency: wallet.currency });
  const price = (n) => fmt.format(n / 10 ** fmt.resolvedOptions().maximumFractionDigits);
  el("account").textContent = "Tài khoản " + wallet.account;
  el("balance").textContent =
    "Còn trong gói " +
    credits(wallet.included) +
    " · Đã mua thêm " +
    credits(wallet.purchased) +
    (wallet.expires
      ? " · Hết kỳ " +
        new Date(wallet.expires).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) +
        " (giờ Việt Nam)"
      : "");
  el("extras").checked = wallet.spendExtras;
  el("cancel").hidden = !wallet.expires;
  el("offers").replaceChildren();
  el("history").replaceChildren();
  for (const [sku, offer] of Object.entries(wallet.offers)) {
    const button = document.createElement("button");
    button.textContent = labels[sku] + " · " + price(offer.amountMinor) + " · " + credits(offer.creditMicros);
    button.onclick = action(async () => {
      const key = JSON.stringify([wallet.account, sku, wallet.version]);
      const resume = sku === "topup" ? null : wallet.orders.find((o) => o.sku === sku && o.state === "pending");
      const id = resume?.id || sessionStorage.getItem(key) || crypto.randomUUID();
      sessionStorage.setItem(key, id);
      const { url } = await api("/wallet/checkout", {
        sku,
        id,
        version: wallet.version,
        amount: offer.amountMinor,
        credits: offer.creditMicros,
        currency: wallet.currency,
      });
      // Clear only after a confirmed handoff. The customer can buy another pack on return.
      sessionStorage.removeItem(key);
      location.assign(url);
    });
    el("offers").append(button);
  }
  for (const entry of [...wallet.orders, ...wallet.recent].sort((a, b) => b.created - a.created)) {
    const item = document.createElement("li");
    item.textContent = [
      new Date(entry.created).toLocaleString("vi-VN"),
      labels[entry.sku] || "AI",
      states[entry.state],
      entry.cost != null ? credits(entry.cost) : "",
    ].join(" · ");
    el("history").append(item);
  }
}
el("login").onsubmit = action(async () => {
  token = el("token").value;
  await refresh();
  el("token").value = "";
  document.querySelector("main").hidden = false;
  el("login").hidden = true;
});
el("refresh").onclick = action(refresh);
el("logout").onclick = () => location.reload();
el("extras").onchange = action(async () => {
  try {
    await api("/wallet/use-purchased", { enabled: el("extras").checked });
  } finally {
    await refresh();
  }
});
el("cancel").onclick = action(async () => {
  await api("/wallet/cancel-renewal", {});
  el("status").textContent = "Đã tắt gia hạn cuối kỳ.";
});
el("chat").onsubmit = action(async () => {
  try {
    const reply = await api(
      "/v1/chat/completions",
      { model: wallet.model, messages: [{ role: "user", content: el("prompt").value }] },
      crypto.randomUUID(),
    );
    el("answer").textContent = reply.choices[0].message.content;
  } finally {
    await refresh();
  }
});

el("engine").onclick = action(async () => {
  el("engineToken").textContent = (await api("/wallet/engine-token", {})).token;
});
