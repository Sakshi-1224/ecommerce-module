const vendor = (req, res, next) => {
  if (req.user.role !== "vendor") {
    return res.status(403).json({ message: "Vendor only" });
  }
  next();
};

export default vendor;
