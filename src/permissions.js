// Pure permission rules for the order workflow. Kept free of database access
// so they can be unit-tested (see test/permissions.test.js).

const isAdmin = user => user?.role === "ADMIN";

// Intake orders, and in-progress orders sent to "all designers", can be claimed by anyone.
function canClaim(user, order) {
  if (!user) return false;
  return order.status === "INTAKE" || (order.status === "IN_PROGRESS" && order.openToAll === true);
}

// Only admins choose who an intake order goes to (a specific designer, themselves, or everyone).
function canAssign(user, order) {
  return isAdmin(user) && ["INTAKE", "IN_PROGRESS"].includes(order.status);
}

// Moving an in-progress order between people.
//  - Admin: any target, applied immediately.
//  - Designer taking it for themselves (from another designer): immediate.
//  - Designer sending their own order to someone else: needs admin approval.
function reassignDecision(user, order, targetUserId) {
  if (order.status !== "IN_PROGRESS") return { error: "Only in-progress orders can be reassigned.", status: 409 };
  if (!targetUserId) return { error: "Choose a designer.", status: 400 };
  if (order.laborUserId === targetUserId && !order.openToAll) return { error: "The order is already assigned to that designer.", status: 409 };
  if (isAdmin(user)) return { action: "direct" };
  if (targetUserId === user.id) return { action: "direct" };
  if (order.laborUserId !== user.id) return { error: "You can only hand off orders that are assigned to you.", status: 403 };
  return { action: "request" };
}

// Mark as done / cancel: the assigned designer or an admin.
function canFinish(user, order) {
  if (order.status !== "IN_PROGRESS") return false;
  return isAdmin(user) || (!!order.laborUserId && order.laborUserId === user.id);
}

// Undo / restore and everything else that rewrites an order: admin only.
const canEdit = user => isAdmin(user);
const canDelete = user => isAdmin(user);
const canSetPriority = user => isAdmin(user);

module.exports = { isAdmin, canClaim, canAssign, reassignDecision, canFinish, canEdit, canDelete, canSetPriority };
