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
    password: hashedPassword
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
    { expiresIn: "24h" }
  );

  res.json({ token });
};

export const logout = async (req, res) => {
  res.json({ message: "Logout successful" });
};

export const me = async (req, res) => {
  res.json(req.user);
};
