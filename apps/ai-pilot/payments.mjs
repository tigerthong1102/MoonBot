import { createHmac, timingSafeEqual } from "node:crypto";
import { Fault } from "./ledger.mjs";

const API_VERSION = "2024-06-20";
function verify(raw, header, secret) {
  if (!secret?.startsWith("whsec_")) throw new Fault(503, "webhook_not_configured");
  const fields = String(header)
    .split(",")
    .map((pair) => pair.split("="));
  const timestamp = fields.find(([name]) => name === "t")?.[1];
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300)
    throw new Fault(400, "invalid_signature");
  const expected = createHmac("sha256", secret)
    .update(timestamp + ".")
    .update(raw)
    .digest();
  if (
    !fields.some(
      ([name, value]) =>
        name === "v1" && /^[a-f\d]{64}$/i.test(value) && timingSafeEqual(expected, Buffer.from(value, "hex")),
    )
  )
    throw new Fault(400, "invalid_signature");
}

export function payments(ledger, settings, http = fetch) {
  async function stripe(path, fields, idempotency) {
    if (!/^(sk|rk)_test_/.test(settings.stripeKey ?? "")) throw new Fault(503, "test_checkout_not_configured");
    const headers = { Authorization: "Bearer " + settings.stripeKey, "Stripe-Version": API_VERSION };
    if (idempotency) headers["Idempotency-Key"] = idempotency;
    const response = await http("https://api.stripe.com/v1/" + path, {
      headers,
      method: fields ? "POST" : "GET",
      body: fields ? new URLSearchParams(fields) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Fault(503, "payment_provider_unavailable");
    const object = await response.json();
    if (object.livemode !== false) throw new Fault(409, "test_object_required");
    return object;
  }
  function findOrder(id) {
    return ledger.db.prepare("SELECT * FROM orders WHERE id=?").get(id || "");
  }
  function match(value, currency, order) {
    if (!order || value !== order.amount || currency !== order.currency) throw new Fault(409, "order_mismatch");
  }
  async function checkout(order) {
    if (order.state !== "pending") throw new Fault(409, "order_" + order.state);
    if (order.session && Date.now() - order.created > 23 * 3600000) {
      const saved = await stripe("checkout/sessions/" + encodeURIComponent(order.session));
      if (saved.status === "expired") {
        ledger.db.prepare("UPDATE orders SET state='expired' WHERE id=? AND state='pending'").run(order.id);
        throw new Fault(409, "order_expired");
      }
    }
    if (!order.session && Date.now() - order.created > 23 * 3600000) throw new Fault(409, "checkout_needs_review");
    if (order.url) return order.url;
    const recurring = order.sku !== "topup";
    const fields = {
      mode: recurring ? "subscription" : "payment",
      client_reference_id: order.id,
      "metadata[order]": order.id,
      success_url: settings.origin + "/",
      cancel_url: settings.origin + "/",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": order.currency,
      "line_items[0][price_data][unit_amount]": String(order.amount),
      "line_items[0][price_data][product_data][name]": "StartupBot pilot · " + order.sku,
      "payment_method_types[0]": "card",
    };
    if (recurring) {
      fields["line_items[0][price_data][recurring][interval]"] = order.sku === "annual" ? "year" : "month";
      fields["subscription_data[metadata][order]"] = order.id;
    }
    const session = await stripe("checkout/sessions", fields, order.id);
    if (!session.id?.startsWith("cs_test_") || new URL(session.url).origin !== "https://checkout.stripe.com")
      throw new Fault(409, "invalid_checkout");
    ledger.db.prepare("UPDATE orders SET session=?,url=? WHERE id=?").run(session.id, session.url, order.id);
    return session.url;
  }
  async function webhook(raw, signature) {
    verify(raw, signature, settings.webhookSecret);
    const event = JSON.parse(raw);
    if (event.livemode !== false) throw new Fault(400, "test_event_required");
    const obj = event.data?.object;
    const pathId = encodeURIComponent(obj?.id ?? "");
    if (event.type === "invoice.paid") {
      const invoice = await stripe("invoices/" + pathId);
      if (
        !invoice.subscription ||
        !invoice.payment_intent ||
        invoice.status !== "paid" ||
        invoice.paid_out_of_band
      )
        return;
      const sub = await stripe("subscriptions/" + encodeURIComponent(invoice.subscription));
      const order = findOrder(sub.metadata?.order);
      if (!order) return;
      if (!order.session) throw new Fault(503, "awaiting_checkout");
      const session = await stripe("checkout/sessions/" + encodeURIComponent(order.session));
      if (
        order.sku === "topup" ||
        session.subscription !== sub.id ||
        invoice.customer !== sub.customer ||
        session.client_reference_id !== order.id
      )
        throw new Fault(409, "subscription_mismatch");
      match(invoice.amount_paid, invoice.currency, order);
      const line = invoice.lines?.data?.[0];
      if (
        invoice.lines.has_more ||
        invoice.lines.data.length !== 1 ||
        line.proration ||
        line.quantity !== 1 ||
        line.price?.recurring?.interval !== (order.sku === "annual" ? "year" : "month") ||
        line.price.recurring.interval_count !== 1
      )
        throw new Fault(409, "unexpected_invoice");
      match(line.amount, line.currency, order);
      ledger.grant(order, {
        id: invoice.id,
        payment: invoice.payment_intent,
        start: line.period.start * 1000,
        end: line.period.end * 1000,
      });
    } else if (event.type === "checkout.session.completed" || event.type === "checkout.session.expired") {
      const session = await stripe("checkout/sessions/" + pathId);
      const order = findOrder(session.client_reference_id);
      if (!order) return;
      if (!order.session) throw new Fault(503, "awaiting_checkout");
      if (session.id !== order.session || session.metadata?.order !== order.id)
        throw new Fault(409, "order_mismatch");
      if (session.status === "expired") {
        ledger.db.prepare("UPDATE orders SET state='expired' WHERE id=? AND state='pending'").run(order.id);
      } else if (order.sku === "topup" && session.payment_status === "paid" && session.mode === "payment") {
        match(session.amount_total, session.currency, order);
        ledger.grant(order, {
          id: session.id,
          payment: session.payment_intent,
          start: session.created * 1000,
          end: null,
        });
      }
    } else if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
      const dispute = event.type === "charge.dispute.created";
      const charge = await stripe("charges/" + encodeURIComponent(dispute ? obj.charge : obj.id));
      const amount = dispute ? charge.amount : charge.amount_refunded;
      if (charge.payment_intent && Number.isSafeInteger(amount) && amount > 0)
        ledger.db
          .prepare("INSERT OR IGNORE INTO reversals VALUES (?,?,?)")
          .run(event.id, charge.payment_intent, amount);
    }
  }
  async function cancel(owner) {
    const order = ledger.db
      .prepare(
        `SELECT o.* FROM orders o JOIN grants g ON g.orderId=o.id WHERE o.owner=? AND g.end>? ORDER BY g.end DESC LIMIT 1`,
      )
      .get(owner, Date.now());
    if (!order) throw new Fault(404, "no_subscription");
    const session = await stripe("checkout/sessions/" + encodeURIComponent(order.session));
    if (!session.subscription || session.client_reference_id !== order.id)
      throw new Fault(409, "subscription_mismatch");
    await stripe(
      "subscriptions/" + encodeURIComponent(session.subscription),
      { cancel_at_period_end: "true" },
      order.id + "-cancel",
    );
  }
  return { checkout, webhook, cancel };
}
