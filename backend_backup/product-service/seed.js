import sequelize from "./config/db.js";
import Category from "./models/Category.js";
import Product from "./models/Product.js";
import dotenv from "dotenv";
import axios from "axios"; // 🟢 ADDED: Import axios to talk to the Vendor service

dotenv.config();

const seedProducts = async () => {
  try {
    await sequelize.authenticate();

    await sequelize.sync();

    // 1. Create Categories (these don't depend on vendor-service)
    const [electronics] = await Category.findOrCreate({
      where: { name: "Electronics" },
      defaults: { name: "Electronics" },
    });
    const [clothing] = await Category.findOrCreate({
      where: { name: "Clothing" },
      defaults: { name: "Clothing" },
    });
const [fresh] = await Category.findOrCreate({
  where: { name: "Fresh & Daily Essentials" },
  defaults: { name: "Fresh & Daily Essentials" },
});

const [snacks] = await Category.findOrCreate({
  where: { name: "Snacks & Ready-to-Eat" },
  defaults: { name: "Snacks & Ready-to-Eat" },
});

const [beverages] = await Category.findOrCreate({
  where: { name: "Beverages" },
  defaults: { name: "Beverages" },
});

const [staples] = await Category.findOrCreate({
  where: { name: "Staples & Cooking Essentials" },
  defaults: { name: "Staples & Cooking Essentials" },
});

const [packaged] = await Category.findOrCreate({
  where: { name: "Packaged & Branded Foods" },
  defaults: { name: "Packaged & Branded Foods" },
});

const [sweets] = await Category.findOrCreate({
  where: { name: "Sweets & Desserts" },
  defaults: { name: "Sweets & Desserts" },
});

const [healthy] = await Category.findOrCreate({
  where: { name: "Healthy & Organic" },
  defaults: { name: "Healthy & Organic" },
});

const [baby] = await Category.findOrCreate({
  where: { name: "Baby Food" },
  defaults: { name: "Baby Food" },
});

const [combos] = await Category.findOrCreate({
  where: { name: "Combos & Offers" },
  defaults: { name: "Combos & Offers" },
});
    // 🟢 1. Fetch real vendors from your API Gateway / Vendor Service
    console.log("🔄 Fetching live vendors from Vendor Service...");
    let realVendorId;

    try {
      const ADMIN_SERVICE_URL = process.env.ADMIN_SERVICE_URL;
      const VENDOR_SERVICE_ADMIN_URL = process.env.VENDOR_SERVICE_ADMIN_URL;

      const loginResponse = await axios.post(`${ADMIN_SERVICE_URL}/login`, {
        phone: "9999999999",
        password: "Admin@123",
      });

      const adminToken = loginResponse.data.token;
      console.log("✅ Admin logged in! Fetching vendors...");

      const vendorResponse = await axios.get(
        `${VENDOR_SERVICE_ADMIN_URL}/vendors`,
        {
          headers: {
            Authorization: `Bearer ${adminToken}`,
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

      realVendorId = vendors[0].id;
      console.log(`✅ Success! Found Vendor ID ${realVendorId}.`);
    } catch (apiErr) {
      console.error("❌ Failed to fetch vendors.");
      const status = apiErr.response?.status;
      const message = apiErr.response?.data?.message || apiErr.message;
      console.error(
        "Error Details:",
        status ? `${status} ${message}` : message,
      );
      console.error(
        "Tip: start admin-service (5005) + vendor-service (5006), or set SEED_VENDOR_ID in product-service/.env",
      );
      process.exit(1);
    }

    await Product.destroy({ where: {} });
    // 3. Create Products using the dynamic realVendorId
    await Product.bulkCreate(
      [
        {
          name: "Wireless Headphones",
          description: "High quality noise-cancelling headphones.",
          price: 2500,
          totalStock: 50,
          warehouseStock: 40,
          CategoryId: electronics.id,
          vendorId: realVendorId, // 🟢 Injecting the real database ID here
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
          vendorId: realVendorId, // 🟢 Injecting the real database ID here
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
