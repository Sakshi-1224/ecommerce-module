import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const register = async (req, res) => {
  const { name,phone, password } = req.body;
 if (!name || !phone || !password) {
      return res.status(400).json({
        message: "All fields are required"
      });
    }
  const existingUser = await User.findOne({ where: { phone } });
  if (existingUser) {
    return res.status(400).json({ message: "User already exists" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await User.create({
    name,
    phone,
    password: hashedPassword,
    role: "user"
  });

  res.status(201).json({ message: "User registered successfully" });
};

export const login = async (req, res) => {
  const { phone, password } = req.body;

  const user = await User.findOne({ where: { phone } });
  if (!user) {
    return res.status(400).json({ message: "Invalid credentials" });
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.status(400).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign(
    { id: user.id, name: user.name, phone: user.phone },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token,
    user:{
      id:user.id,
      name:user.name,
      phone:user.phone
    }
   });
};

export const logout = async (req, res) => {
  res.json({ message: "Logout successful" });
};

export const me = async (req, res) => {
  res.json(req.user);
};



export const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        message: "Old password and new password are required"
      });
    }

    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Old password is incorrect" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    user.password = hashedPassword;
    await user.save();

    res.json({ message: "Password changed successfully" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to change password" });
  }
};

//admin
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ["password"] }, // 🔐 hide password
      order: [["createdAt", "DESC"]]
    });

    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
