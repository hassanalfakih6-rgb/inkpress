const test = require("node:test");
const assert = require("node:assert");
const p = require("../src/permissions");
const { paidAmount, normalizePhone, methodKey } = require("../src/money");

const admin = { id: "a", role: "ADMIN" }, d1 = { id: "d1", role: "STAFF" }, d2 = { id: "d2", role: "STAFF" };
const prog = (over = {}) => ({ status: "IN_PROGRESS", laborUserId: "d1", openToAll: false, ...over });

test("anyone can claim intake and open orders, not assigned ones", () => {
  assert.ok(p.canClaim(d2, { status: "INTAKE" }));
  assert.ok(p.canClaim(d2, prog({ laborUserId: null, openToAll: true })));
  assert.ok(!p.canClaim(d2, prog()));
});
test("only admins assign", () => {
  assert.ok(p.canAssign(admin, { status: "INTAKE" }));
  assert.ok(!p.canAssign(d1, { status: "INTAKE" }));
});
test("designer can take another designer's order directly", () => {
  assert.deepStrictEqual(p.reassignDecision(d2, prog(), "d2"), { action: "direct" });
});
test("designer handing their own order to someone else needs approval", () => {
  assert.deepStrictEqual(p.reassignDecision(d1, prog(), "d2"), { action: "request" });
});
test("designer cannot move someone else's order to a third person", () => {
  assert.strictEqual(p.reassignDecision(d2, prog(), "d3").status, 403);
});
test("admin reassigns directly", () => {
  assert.deepStrictEqual(p.reassignDecision(admin, prog(), "d2"), { action: "direct" });
});
test("done/cancel: assignee or admin only", () => {
  assert.ok(p.canFinish(d1, prog()));
  assert.ok(p.canFinish(admin, prog()));
  assert.ok(!p.canFinish(d2, prog()));
  assert.ok(!p.canFinish(d1, prog({ status: "DONE" })));
});
test("priority/edit/delete are admin only", () => {
  for (const f of [p.canEdit, p.canDelete, p.canSetPriority]) { assert.ok(f(admin)); assert.ok(!f(d1)); }
});
test("money helpers", () => {
  assert.strictEqual(paidAmount("PAID", 50, 0), 50);
  assert.strictEqual(paidAmount("NOT_PAID", 50, 20), 0);
  assert.strictEqual(paidAmount("DOWN_PAYMENT", 50, 20), 20);
  assert.strictEqual(paidAmount("DOWN_PAYMENT", 50, 80), 50);
  assert.strictEqual(normalizePhone("+961 70-123 456"), "+96170123456");
  assert.strictEqual(methodKey("Whish"), "WHISH");
  assert.strictEqual(methodKey("Cash"), "CASH");
});
