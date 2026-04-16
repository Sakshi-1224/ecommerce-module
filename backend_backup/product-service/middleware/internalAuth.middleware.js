import dotenv from "dotenv";
dotenv.config();

const internalAuth = (req, res, next) => {
  const internalToken = req.headers["x-internal-token"];

  if (!internalToken) {
    return res.status(401).json({ message: "Access Denied. No internal token provided." });
  }

  if (internalToken !== process.env.INTERNAL_API_KEY) {
    return res.status(403).json({ message: "Forbidden. Invalid internal token." });
  }

  // Optional: Tag the request so controllers know it came from an internal service
  req.isInternal = true; 
  next();
};

export default internalAuth;