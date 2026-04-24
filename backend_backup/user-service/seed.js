import bcrypt from "bcrypt";
import sequelize from "./config/db.js";
import User from "./models/User.js";
import Address from "./models/Address.js";
import defineAssociations from "./models/associations.js";
import dotenv from "dotenv";

dotenv.config();

const seedUser = async () => {
  try {
    await sequelize.authenticate();
    defineAssociations();
    await sequelize.sync();

    const hashedPassword = await bcrypt.hash("Password@123", 10);

    const [user] = await User.findOrCreate({
      where: { email: "customer@test.com" },
      defaults: {
        name: "Test Customer",
        email: "customer@test.com",
        phone: "9112233449",
        password: hashedPassword,
        role: "user",
      },
    });

    await Address.findOrCreate({
      where: { userId: user.id, isDefault: true },
      defaults: {
        userId: user.id,
        fullName: "Test Customer",
        phone: "9112233449",
        addressLine1: "123 Test Street",
        area: "Vijay Nagar",
        city: "Indore",
        state: "Madhya Pradesh",
        pincode: "452010",
        isDefault: true,
      },
    });

    console.log(
      "✅ User & Address seeded successfully! (customer@test.com / password123)",
    );
    process.exit(0);
  } catch (error) {
    console.error("❌ User Seeding Error:", error);
    process.exit(1);
  }
};

seedUser();