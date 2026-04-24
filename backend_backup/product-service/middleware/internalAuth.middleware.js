import dotenv from "dotenv";
import crypto from "crypto";
dotenv.config();

const internalAuth = (req, res, next) => {
  const internalToken = req.headers["x-internal-token"];
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!internalToken || typeof internalToken !== 'string') {
    return res.status(401).json({ message: "Access Denied. No internal token provided." });
  }

  try {
    const tokenBuffer = Buffer.from(internalToken);
    const expectedBuffer = Buffer.from(expectedKey);

    if (tokenBuffer.length !== expectedBuffer.length || 
        !crypto.timingSafeEqual(tokenBuffer, expectedBuffer)) {
      return res.status(403).json({ message: "Forbidden. Invalid internal token." });
    }
    
    req.isInternal = true; 
    next();
  } catch (err) {
    return res.status(403).json({ message: "Forbidden. Token validation error." });
  }
};

export default internalAuth;