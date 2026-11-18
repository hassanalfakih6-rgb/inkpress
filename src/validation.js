const { z } = require("zod");

const paymentDetails = ["PAID", "NOT_PAID", "DOWN_PAYMENT"];
const receivingMethods = ["DELIVERY", "LOCAL_DELIVERY", "PICK_UP"];
const orderInput = z.object({
  orderDate: z.string().optional(),
  laborName: z.string().trim().min(1).max(100),
  customerName: z.string().trim().min(1).max(150),
  phoneNumber: z.string().trim().min(3).max(40),
  orderDetail: z.string().trim().min(1).max(10000),
  price: z.coerce.number().min(0).max(999999999),
  paymentDetail: z.enum(paymentDetails),
  receivingMethod: z.enum(receivingMethods),
  paymentMethod: z.string().trim().min(1).max(50)
});
module.exports = { orderInput };
