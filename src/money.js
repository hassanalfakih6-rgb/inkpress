// Small helpers shared by order and finance routes.

const num = d => (d == null ? 0 : Number(d));
const round = n => Math.round(n * 100) / 100;

// Normalise phone numbers so "70 123 456" and "70-123456" are the same client.
const normalizePhone = p => String(p || "").replace(/[^0-9+]/g, "");

// Amount the customer has paid at the shop, derived from the payment status.
function paidAmount(paymentDetail, price, amountPaid) {
  if (paymentDetail === "PAID") return round(price);
  if (paymentDetail === "NOT_PAID") return 0;
  const paid = round(Number(amountPaid) || 0);
  return Math.min(Math.max(paid, 0), round(price));
}

// "Cash" or "Whish" → balance bucket
const methodKey = m => (/whish/i.test(String(m || "")) ? "WHISH" : "CASH");

async function upsertClient(db, name, phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const client = await db.client.upsert({
    where: { phone: normalized },
    update: { name },
    create: { name, phone: normalized }
  });
  return client.id;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

module.exports = { num, round, normalizePhone, paidAmount, methodKey, upsertClient, httpError };
