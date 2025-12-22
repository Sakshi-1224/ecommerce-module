import jwt from "jsonwebtoken";

export default (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Unauthorized" });

  // Accept both "Bearer <token>" and raw token in the header
  const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    // Log the verification error to help debugging
    console.error("JWT verification failed:", err && err.message ? err.message : err);
    return res.status(401).json({ message: "Invalid token" });
  }
};
