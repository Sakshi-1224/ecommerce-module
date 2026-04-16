import bcrypt from "bcrypt";
import sequelize from "./config/db.js";
import DeliveryBoy from "./models/DeliveryBoy.js";
import ShippingRate from "./models/ShippingRate.js";
import dotenv from "dotenv";

dotenv.config();

const seedOrderService = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync();

    // 1. Seed Shipping Rates
    const areas = [
      { areaName: "Vijay Nagar", rate: 50 },
      { areaName: "Bhawarkua", rate: 60 },
      { areaName: "Palasia", rate: 40 },
      { areaName: "General", rate: 100 }
    ];

    await ShippingRate.bulkCreate(areas, { ignoreDuplicates: true });

    // 2. Seed Delivery Boy
    const hashedPassword = await bcrypt.hash("password123", 10);

    await DeliveryBoy.findOrCreate({
      where: { email: "raju@test.com" },
      defaults: {
        name: "Raju Courier",
        email: "raju@test.com",
        phone: "9999999999",
        password: hashedPassword,
        state: "Madhya Pradesh",
        city: "Indore",
        assignedAreas: ["Vijay Nagar", "Palasia", "General"],
        maxOrders: 15,
        active: true,
      },
    });

    console.log("✅ Delivery Boy & Shipping Rates seeded! (raju@test.com / password123)");
    process.exit(0);
  } catch (error) {
    console.error("❌ Order Service Seeding Error:", error);
    process.exit(1);
  }
};

seedOrderService();