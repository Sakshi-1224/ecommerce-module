const vendorOrAdmin = (req, res, next) => {
  if (req.user.role === "admin" || req.user.role === "vendor") {
    return next();
  }
  return res.status(403).json({ message: "Admin or Vendor only" });
};

export default vendorOrAdmin;
