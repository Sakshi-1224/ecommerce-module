import sequelize from "./config/db.js";
import DeliveryBoy from "./models/DeliveryBoy.js";
import ShippingRate from "./models/ShippingRate.js";
import dotenv from "dotenv";
import { safeDeleteCache } from "./utils/redisWrapper.js";

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
      { areaName: "General", rate: 100 },
    ];

    await ShippingRate.bulkCreate(areas, { ignoreDuplicates: true });

    // 2. Seed Delivery Boy
    const seedPassword = process.env.SEED_PASSWORD;
    if (!seedPassword) {
      throw new Error(
        "Missing SEED_PASSWORD in environment variables. Cannot seed DeliveryBoy.",
      );
    }
    await DeliveryBoy.findOrCreate({
      where: { email: "raju@test.com" },
      defaults: {
        name: "Raju Courier",
        email: "raju@test.com",
        phone: "9999999990",
        password: seedPassword,
        state: "Madhya Pradesh",
        city: "Indore",
        assignedAreas: ["Vijay Nagar", "Palasia", "General"],
        maxOrders: 15,
        active: true,
      },
    });

    console.log(
      "✅ Delivery Boy & Shipping Rates seeded! (raju@test.com / password123)",
    );

    await safeDeleteCache([
      "delivery_boys:all",
      "shipping_rates:all",
      "shipping_rates:active",
      "delivery_locations:all",
    ]);

    process.exit(0);
  } catch (error) {
    console.error("❌ Order Service Seeding Error:", error);
    process.exit(1);
  }
};

seedOrderService();
