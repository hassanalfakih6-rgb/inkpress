const { z } = require("zod");

const id = z.string().regex(/^[0-9a-f-]{36}$/i, "Invalid id.");
const optionalId = z.union([id, z.literal(""), z.null()]).optional().transform(v => v || null);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");
const money = z.coerce.number().min(0).max(999999999);

const paymentDetails = ["PAID", "NOT_PAID", "DOWN_PAYMENT"];
const receivingMethods = ["DELIVERY", "LOCAL_DELIVERY", "PICK_UP"];
const paymentMethods = ["Cash", "Whish"];
const priorities = ["NORMAL", "HIGH", "URGENT"];
const statuses = ["INTAKE", "IN_PROGRESS", "DONE", "CANCELED", "RECEIVED"];

const orderBase = {
  orderDate: dateStr.optional(),
  customerName: z.string().trim().min(1, "Customer name is required.").max(150),
  phoneNumber: z.string().trim().min(3, "Phone number is required.").max(40),
  orderDetail: z.string().trim().min(1, "Order details are required.").max(10000),
  note: z.string().trim().max(5000).optional().transform(v => v || null),
  price: money,
  amountPaid: money.optional(),
  paymentDetail: z.enum(paymentDetails),
  receivingMethod: z.enum(receivingMethods),
  paymentMethod: z.enum(paymentMethods),
  productTypeId: optionalId,
  deliveryCompanyId: optionalId,
  priority: z.enum(priorities).optional()
};

const orderCreate = z.object(orderBase);

// Admin edit: absolutely everything.
const orderAdminEdit = z.object({
  ...orderBase,
  status: z.enum(statuses),
  laborUserId: optionalId,
  openToAll: z.boolean().optional().default(false),
  deliverySettled: z.boolean().optional().default(false)
});

const userCreate = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  password: z.string().min(8, "Password must be at least 8 characters.").max(100),
  role: z.enum(["ADMIN", "STAFF"]).default("STAFF")
});
const userUpdate = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().toLowerCase().email("Enter a valid email.").optional(),
  password: z.union([z.string().min(8, "Password must be at least 8 characters.").max(100), z.literal("")]).optional(),
  role: z.enum(["ADMIN", "STAFF"]).optional()
});

const cashEntry = z.object({
  type: z.enum(["EXPENSE", "ADJUSTMENT"]),
  method: z.enum(["CASH", "WHISH"]),
  amount: z.coerce.number().min(-999999999).max(999999999).refine(v => v !== 0, "Amount cannot be zero."),
  description: z.string().trim().max(300).optional().default(""),
  entryDate: dateStr.optional()
}).refine(e => e.type !== "EXPENSE" || e.amount > 0, { message: "Expense amount must be positive." });

const namedItem = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100),
  phone: z.string().trim().max(40).optional().transform(v => v || null)
});

const printSettings = z.object({
  businessName: z.string().trim().max(100).default("Inkpress"),
  phone: z.string().trim().max(60).default(""),
  address: z.string().trim().max(200).default(""),
  footer: z.string().trim().max(300).default("Thank you for your business!"),
  paperSize: z.enum(["A4", "A5", "80mm"]).default("A4"),
  showDetails: z.boolean().default(true),
  showDesigner: z.boolean().default(false),
  copies: z.coerce.number().int().min(1).max(5).default(1)
});

function parse(schema, body, res) {
  const r = schema.safeParse(body ?? {});
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  res.status(400).json({ error: issue?.message || "Invalid input." });
  return null;
}

const toDate = s => (s ? new Date(`${s}T00:00:00.000Z`) : undefined);

module.exports = { orderCreate, orderAdminEdit, userCreate, userUpdate, cashEntry, namedItem, printSettings, parse, toDate, dateStr };
