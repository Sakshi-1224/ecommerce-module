import bcrypt from "bcrypt";
import sequelize from "./config/db.js";
import Vendor from "./models/Vendor.js";
import dotenv from "dotenv";

dotenv.config();

const seedVendor = async () => {
  try {
    await sequelize.authenticate();
    
    // Using alter: true ensures all your new business & KYC columns are created in the database
    await sequelize.sync({ alter: true }); 

    const hashedPassword = await bcrypt.hash("password123", 10);

    await Vendor.findOrCreate({
      where: { email: "vendor@test.com" },
      defaults: {
        // Basic Info
        name: "Test Vendor",
        email: "vendor@test.com",
        phone: "9876543210",
        password: hashedPassword,
        
        // Business Details
        businessName: "SuperMart Retail",
        businessType: "Electronics & Fashion",
        businessDescription: "A trusted local business providing quality goods.",
        yearsInBusiness: 5,
        businessAddress: "456 Market Square, Vijay Nagar, Indore",
        
        // KYC Details
        aadharNumber: "[Aadhaar Redacted]",
        panNumber: "ABCDE1234F",
        gstNumber: "23AAAAA0000A1Z5",
        
        // Bank Details
        bankAccountHolderName: "Test Vendor Store",
        bankAccountNumber: "0000123456789",
        bankIFSC: "HDFC0001234",
        bankName: "HDFC Bank",
        
        // Status
        status: "APPROVED" // Set to approved so they can start selling right away!
      },
    });

    console.log("✅ Vendor seeded successfully with full Business & KYC details! (vendor@test.com / password123)");
    process.exit(0);
  } catch (error) {
    console.error("❌ Vendor Seeding Error:", error);
    process.exit(1);
  }
};

seedVendor();