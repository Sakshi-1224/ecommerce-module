const vendor = (req, res, next) => {
  console.log("--- VENDOR MIDDLEWARE DEBUG ---");
  console.log("User in Request:", req.user);
  console.log("User Role:", req.user?.role);

  if (!req.user || !req.user.role) {
    return res.status(403).json({ message: "Access denied: No role found" });
  }

  if (req.user.role.toLowerCase() !== "vendor") {
    return res.status(403).json({
      message: "Vendor access only",
      receivedRole: req.user.role,
    });
  }

  next();
};

export default vendor;
