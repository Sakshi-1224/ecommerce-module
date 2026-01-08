import jwt from "jsonwebtoken";

const authDeliveryBoy = (req, res, next) => {
  const token = req.header("Authorization");
  if (!token) return res.status(401).json({ message: "Access Denied" });

  try {
    const verified = jwt.verify(token.replace("Bearer ", ""), process.env.JWT_SECRET);
    
    if (verified.role !== "delivery_boy") {
       return res.status(403).json({ message: "Access Restricted to Delivery Boys" });
    }

    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ message: "Invalid Token" });
  }
};

export default authDeliveryBoy;