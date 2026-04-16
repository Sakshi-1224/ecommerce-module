import sequelize from "./config/db.js";
import Category from "./models/Category.js";
import Product from "./models/Product.js";
import dotenv from "dotenv";
import axios from "axios"; // 🟢 ADDED: Import axios to talk to the Vendor service

dotenv.config();

const seedProducts = async () => {
  try {
    await sequelize.authenticate();
    
    Category.hasMany(Product, { foreignKey: "categoryId" });
    Product.belongsTo(Category, { foreignKey: "categoryId" });
    
    await sequelize.sync();

    // 🟢 1. Fetch real vendors from your API Gateway / Vendor Service
    console.log("🔄 Fetching live vendors from Vendor Service...");
    let realVendorId;
    
    try {
      // Note: Change this URL to match your route that gets all vendors. 
      // If your Gateway runs on 5000, use that.
    const loginResponse = await axios.post("http://localhost:5000/api/admin/login", {
        phone: "9876543210",       // Or use "phone": "9999999999" if you changed it earlier
        password: "adminpassword"
      });

      const adminToken = loginResponse.data.token;
      console.log("✅ Admin logged in! Fetching vendors...");

      // 🟢 STEP 2: Use the token to access the protected route
      const vendorResponse = await axios.get("http://localhost:5006/api/admin/vendors", {
        headers: {
          Authorization: `Bearer ${adminToken}` // Pass the token exactly like Postman does
        }
      });
      
      const vendors = vendorResponse.data.vendors || vendorResponse.data;
      
      if (!vendors || vendors.length === 0) {
        console.error("❌ No vendors exist! Run 'npm run seed' in vendor-service first.");
        process.exit(1);
      }

      // Grab the ID of the first active vendor
      realVendorId = vendors[0].id;
      console.log(`✅ Success! Found Vendor ID ${realVendorId}.`);

    } catch (apiErr) {
       console.error("❌ Failed to fetch vendors.");
       console.error("Error Details:", apiErr.response?.data?.message || apiErr.message);
       process.exit(1);
    }

    // 2. Create Categories
    const [electronics] = await Category.findOrCreate({ where: { name: "Electronics" }, defaults: { name: "Electronics" } });
    const [clothing] = await Category.findOrCreate({ where: { name: "Clothing" }, defaults: { name: "Clothing" } });
await Product.destroy({ where: {} });
    // 3. Create Products using the dynamic realVendorId
    await Product.bulkCreate([
      {
        name: "Wireless Headphones",
        description: "High quality noise-cancelling headphones.",
        price: 2500,
        totalStock: 50,
        warehouseStock:40,
        categoryId: electronics.id,
        vendorId: realVendorId, // 🟢 Injecting the real database ID here
        images: ["https://img.freepik.com/premium-photo/photo-wireless-headphones_1029469-18128.jpg"],
        isActive: true,
      },
      {
        name: "Cotton T-Shirt",
        description: "Comfortable 100% cotton t-shirt.",
        price: 500,
        totalStock: 100,
        warehouseStock: 50,
        categoryId: clothing.id,
        vendorId: realVendorId, // 🟢 Injecting the real database ID here
        images: ["https://th.bing.com/th/id/OIP.uUHWw_qUuuPphnghYUcjjgHaJQ?w=208&h=260&c=7&r=0&o=7&dpr=1.3&pid=1.7&rm=3"],
        isActive: true,
      }
    ], { ignoreDuplicates: true });

    console.log("✅ Products & Categories seeded successfully with real Vendor ID!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Product Seeding Error:", error);
    process.exit(1);
  }
};

seedProducts();