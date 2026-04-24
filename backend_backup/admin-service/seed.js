import bcrypt from "bcrypt";
import sequelize from "./config/db.js";
import Admin from "./models/Admin.js";
import dotenv from "dotenv";

dotenv.config();

const seedAdmin = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync(); // Ensure tables exist

    const hashedPassword = await bcrypt.hash("Admin@123", 10);

    await Admin.findOrCreate({
      where: { email: "admin@test.com" },
      defaults: {
        name: "Super Admin",
        email: "admin@test.com",
        password: hashedPassword,
        phone: "9876543210",
      },
    });

    console.log(
      "✅ Admin seeded successfully! (admin@test.com / adminpassword)",
    );
    process.exit(0);
  } catch (error) {
    console.error("❌ Admin Seeding Error:", error);
    process.exit(1);
  }
};

seedAdmin();
