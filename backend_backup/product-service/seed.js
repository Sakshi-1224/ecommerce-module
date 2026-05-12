import sequelize from "./config/db.js";
import Category from "./models/Category.js";
import Product from "./models/Product.js";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const extractJwtCookie = (setCookieHeader) => {
  if (!setCookieHeader) return null;

  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : [setCookieHeader];

  const jwtSetCookie = cookies.find(
    (c) => typeof c === "string" && c.startsWith("jwt="),
  );

  if (!jwtSetCookie) return null;
  return jwtSetCookie.split(";")[0]?.trim() || null;
};

// HELPER 1: Handle category creation to keep main function clean
const seedCategories = async () => {
  const [electronics] = await Category.findOrCreate({
    where: { name: "Electronics" },
    defaults: { name: "Electronics" },
  });

  const [clothing] = await Category.findOrCreate({
    where: { name: "Clothing" },
    defaults: { name: "Clothing" },
  });

  const remainingCategories = [
    "Fresh & Daily Essentials",
    "Snacks & Ready-to-Eat",
    "Beverages",
    "Staples & Cooking Essentials",
    "Packaged & Branded Foods",
    "Sweets & Desserts",
    "Healthy & Organic",
    "Baby Food",
    "Combos & Offers"
  ];

  for (const name of remainingCategories) {
    await Category.findOrCreate({
      where: { name },
      defaults: { name },
    });
  }

  return { electronics, clothing };
};

// HELPER 2: Extracted vendor fetching logic (Resolves Cognitive Complexity)
const fetchLiveVendorId = async (seedPassword) => {
  if (process.env.SEED_VENDOR_ID) {
    console.log(`✅ Using SEED_VENDOR_ID=${process.env.SEED_VENDOR_ID}`);
    return process.env.SEED_VENDOR_ID;
  }

  try {
    const ADMIN_SERVICE_URL = process.env.ADMIN_SERVICE_URL;
    const VENDOR_SERVICE_ADMIN_URL = process.env.VENDOR_SERVICE_ADMIN_URL;

    if (!ADMIN_SERVICE_URL || !VENDOR_SERVICE_ADMIN_URL) {
      throw new Error(
        "Missing ADMIN_SERVICE_URL or VENDOR_SERVICE_ADMIN_URL in product-service/.env",
      );
    }

    const loginResponse = await axios.post(`${ADMIN_SERVICE_URL}/login`, {
      phone: "9999999999",
      password: seedPassword,
    });

    const jwtCookie = extractJwtCookie(loginResponse.headers?.["set-cookie"]);

    if (!jwtCookie) {
      throw new Error(
        "Admin login succeeded but no jwt cookie was set (check cookie settings / proxy / http vs https)",
      );
    }
    console.log("✅ Admin logged in! Fetching vendors...");

    const vendorResponse = await axios.get(
      `${VENDOR_SERVICE_ADMIN_URL}/vendors`,
      {
        headers: {
          Cookie: jwtCookie,
        },
      },
    );

    const vendors = vendorResponse.data.vendors || vendorResponse.data;

    if (!vendors || vendors.length === 0) {
      console.error(
        "❌ No vendors exist! Run 'npm run seed' in vendor-service first.",
      );
      process.exit(1);
    }

    const realVendorId = vendors[0].id;
    console.log(`✅ Success! Found Vendor ID ${realVendorId}.`);
    return realVendorId;

  } catch (error_) {
    console.error("❌ Failed to fetch vendors.");

    const status = error_.response?.status;
    const message = error_.response?.data?.message || error_.message;

    console.error(
      "Error Details:",
      status ? `${status} ${message}` : message,
    );
    console.error(
      "Tip: start admin-service (5005) + vendor-service (5006), or set SEED_VENDOR_ID in product-service/.env",
    );
    process.exit(1);
  }
};

// MAIN FUNCTION: Now simplified and within Cognitive Complexity limits
const seedProducts = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync();

    // 1. Seed Categories
    const { electronics, clothing } = await seedCategories();

    // 2. Validate Environment
    const seedPassword = process.env.SEED_PASSWORD;
    if (!seedPassword) {
      throw new Error(
        "Missing SEED_PASSWORD in environment variables. Cannot seed.",
      );
    }

    // 3. Fetch Vendor ID
    console.log("🔄 Fetching live vendors from Vendor Service...");
    const realVendorId = await fetchLiveVendorId(seedPassword);

    // 4. Seed Products
    await Product.destroy({ where: {} });

    await Product.bulkCreate(
      [
        {
          name: "Wireless Headphones",
          description: "High quality noise-cancelling headphones.",
          price: 2500,
          totalStock: 50,
          warehouseStock: 40,
          CategoryId: electronics.id,
          vendorId: realVendorId,
          images: [
            "https://img.freepik.com/premium-photo/photo-wireless-headphones_1029469-18128.jpg",
          ],
        },
        {
          name: "Cotton T-Shirt",
          description: "Comfortable 100% cotton t-shirt.",
          price: 500,
          totalStock: 100,
          warehouseStock: 50,
          CategoryId: clothing.id,
          vendorId: realVendorId,
          images: [
            "https://th.bing.com/th/id/OIP.uUHWw_qUuuPphnghYUcjjgHaJQ?w=208&h=260&c=7&r=0&o=7&dpr=1.3&pid=1.7&rm=3",
          ],
        },
      ],
      { ignoreDuplicates: true },
    );

    console.log(
      "✅ Products & Categories seeded successfully with real Vendor ID!",
    );
    process.exit(0);
  } catch (error) {
    console.error("❌ Product Seeding Error:", error);
    process.exit(1);
  }
};

seedProducts();