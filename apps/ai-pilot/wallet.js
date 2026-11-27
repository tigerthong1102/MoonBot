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
  retryable: "Chưa tính phí · có thể thử lại",
  settled: "Đã quyết toán",
};
const errors = {
  invalid_pilot_sign_in: "Mã xác nhận không hợp lệ hoặc tài khoản chưa được mời.",
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
  const price = (n, currency) => {
    const fmt = new Intl.NumberFormat("vi", { style: "currency", currency });
    return fmt.format(n / 10 ** fmt.resolvedOptions().maximumFractionDigits);
  };
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
  el("usage").textContent =
    "Tổng chi phí AI đã quyết toán " +
    credits(wallet.usage.cost) +
    (wallet.usage.input !== null ? " · Token đầu vào đã báo cáo " + wallet.usage.input : "") +
    (wallet.usage.output !== null ? " · Token đầu ra đã báo cáo " + wallet.usage.output : "");
  el("extras").checked = wallet.spendExtras;
  el("cancel").hidden = !wallet.canCancel;
  el("offers").replaceChildren();
  el("history").replaceChildren();
  for (const [sku, offer] of Object.entries(wallet.offers)) {
    const button = document.createElement("button");
    const pending = wallet.pending.find((o) => o.sku === sku);
    const quote = pending ?? {
      sku,
      version: wallet.version,
      amount: offer.amountMinor,
      credits: offer.creditMicros,
      currency: wallet.currency,
    };
    button.textContent =
      (pending ? "Tiếp tục đơn · " : "") +
      labels[sku] +
      " · " +
      price(quote.amount, quote.currency) +
      " · " +
      credits(quote.credits);
    button.onclick = action(async () => {
      const key = JSON.stringify([wallet.account, sku, quote.version]);
      const id = pending?.id || sessionStorage.getItem(key) || crypto.randomUUID();
      sessionStorage.setItem(key, id);
      const { url } = await api("/wallet/checkout", { ...quote, id });
      sessionStorage.removeItem(key);
      location.assign(url);
    });
    el("offers").append(button);
  }
  for (const entry of [...wallet.orders, ...wallet.recent].sort((a, b) => b.created - a.created)) {
    const item = document.createElement("li");
    item.textContent = [
      new Date(entry.created).toLocaleString("vi-VN"),
      labels[entry.sku] || entry.model || "AI",
      states[entry.state],
      entry.cost != null ? credits(entry.cost) : "",
    ].join(" · ");
    el("history").append(item);
  }
}
async function openWallet(credential) {
  token = credential;
  await refresh();
  el("token").value = "";
  document.querySelector("main").hidden = false;
  el("login").hidden = true;
  el("accountLogin").hidden = true;
}
el("login").onsubmit = action(() => openWallet(el("token").value));
fetch("/wallet/sign-in-options")
  .then((r) => r.json())
  .then((options) => {
    if (!wallet) el("accountLogin").hidden = !options.email;
  })
  .catch(() => {});
el("emailForm").onsubmit = action(async () => {
  await api("/wallet/request-code", { email: el("email").value });
  el("otpForm").hidden = false;
  el("status").textContent = "Nếu tài khoản đã được mời, hãy mở email để lấy mã.";
});
el("otpForm").onsubmit = action(async () => {
  const result = await api("/wallet/verify-code", { email: el("email").value, otp: el("otp").value });
  el("otp").value = "";
  await openWallet(result.token);
});
el("refresh").onclick = action(refresh);
el("logout").onclick = action(async () => {
  try {
    await api("/wallet/sign-out", {});
  } finally {
    location.reload();
  }
});
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
