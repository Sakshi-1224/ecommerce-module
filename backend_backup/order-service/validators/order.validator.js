import { z } from "zod";

const orderItemSchema = z.object({
  productId: z.number().int().positive("Product ID must be a valid positive integer"),
  vendorId: z.number().int().positive("Vendor ID must be a valid positive integer"),
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
  price: z.number().positive("Price must be strictly greater than 0"),
});

const addressSchema = z.object({
  area: z.string().trim().min(1, "Area is required for delivery calculation"),
  street: z.string().trim().optional(),
  city: z.string().trim().optional(),
  pincode: z.string().trim().optional(),
  phone: z.string().trim().optional(),
}).passthrough();

const validStatuses = ["PENDING", "PROCESSING", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];

export const checkoutSchema = z.object({
  body: z.object({
    items: z.array(orderItemSchema)
      .min(1, "Cart cannot be empty. Please add items to checkout.")
     
      .refine(
        (items) => {
          const productIds = items.map((item) => item.productId);
          return new Set(productIds).size === productIds.length;
        },
        { message: "Duplicate products found. Please consolidate quantities into a single item." }
      ),
    amount: z.number().positive("Total amount must be greater than 0"),
    address: addressSchema,
    paymentMethod: z.enum(["COD", "RAZORPAY"], {
      errorMap: () => ({ message: "Payment method must be either 'COD' or 'RAZORPAY'" }),
    }),
  }),
});


export const adminCreateOrderSchema = z.object({
  body: z.object({
    userId: z.number().int().positive("User ID is required and must be valid"),
    items: z.array(orderItemSchema)
      .min(1, "Cart cannot be empty.")
    
      .refine(
        (items) => {
          const productIds = items.map((item) => item.productId);
          return new Set(productIds).size === productIds.length;
        },
        { message: "Duplicate products found." }
      ),
    amount: z.number().positive("Total amount must be greater than 0"),
    address: addressSchema,
    paymentMethod: z.enum(["COD", "RAZORPAY"]).optional().default("COD"), 
  }),
});


export const updateOrderStatusSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, "Order ID must be a numeric string"),
  }),
  body: z.object({
    status: z.enum(validStatuses, {
      errorMap: () => ({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` }),
    }),
  }),
});


export const updateOrderItemStatusSchema = z.object({
  params: z.object({
    orderId: z.string().regex(/^\d+$/, "Order ID must be a numeric string"),
    itemId: z.string().regex(/^\d+$/, "Item ID must be a numeric string"),
  }),
  body: z.object({
    status: z.enum(validStatuses, {
      errorMap: () => ({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` }),
    }),
  }),
});


export const paginationQuerySchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/, "Page must be a number").transform(Number).optional(),
    limit: z.string().regex(/^\d+$/, "Limit must be a number").transform(Number).optional(),
  }).optional(),
});

export const idParamSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, "ID must be a numeric string"),
  }),
});