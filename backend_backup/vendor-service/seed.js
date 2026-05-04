import bcrypt from "bcrypt";
import sequelize from "./config/db.js";
import Vendor from "./models/Vendor.js";
import dotenv from "dotenv";

dotenv.config();

const seedVendor = async () => {
  try {
    await sequelize.authenticate();

    await sequelize.sync({ alter: true });

    const hashedPassword = await bcrypt.hash("Password@123", 10);

    await Vendor.findOrCreate({
      where: { email: "vendor@test.com" },
      defaults: {
       
        name: "Test Vendor",
        email: "vendor@test.com",
        phone: "9876543210",
        password: hashedPassword,

        businessName: "SuperMart Retail",
        businessType: "Electronics & Fashion",
        businessDescription:
          "A trusted local business providing quality goods.",
        yearsInBusiness: 5,
        businessAddress: "456 Market Square, Vijay Nagar, Indore",

        aadharNumber: "[Aadhaar Redacted]",
        panNumber: "ABCDE1234F",
        gstNumber: "23AAAAA0000A1Z5",

        bankAccountHolderName: "Test Vendor Store",
        bankAccountNumber: "0000123456789",
        bankIFSC: "HDFC0001234",
        bankName: "HDFC Bank",

        status: "APPROVED", 
      },
    });

    console.log(
      "✅ Vendor seeded successfully with full Business & KYC details! (vendor@test.com / password123)",
    );
    process.exit(0);
  } catch (error) {
    console.error("❌ Vendor Seeding Error:", error);
    process.exit(1);
  }
};

seedVendor();
