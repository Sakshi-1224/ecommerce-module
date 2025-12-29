const admin = (req, res, next) => {
   if (!req.user) {
    return res
      .status(401)
      .json({ message: "Unauthorized: No user data found" });
  }
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin only" });
  }
  next();
};

export default admin;
