
const normalizeSameSite = (value) => {
  const raw = (value || "strict").toLowerCase();
  if (raw === "none") return "none";
  if (raw === "lax") return "lax";
  return "strict";
};

const toExpressSameSite = (value) => {
  if (value === "none") return "none";
  if (value === "lax") return "lax";
  return "strict";
};

export const getAuthCookieOptions = () => {
  const sameSite = normalizeSameSite(process.env.AUTH_COOKIE_SAMESITE);
  const secure =
    process.env.AUTH_COOKIE_SECURE === "true" ||
    process.env.NODE_ENV === "production" ||
    sameSite === "none";

  return {
    httpOnly: true,
    secure,
    sameSite: toExpressSameSite(sameSite),
    maxAge: 7 * 24 * 60 * 60 * 1000, 
  };
};

export const getClearAuthCookieOptions = () => {
  const { httpOnly, secure, sameSite } = getAuthCookieOptions();
  return { httpOnly, secure, sameSite };
};

export const getCsrfCookieOptions = () => {
  const authOptions = getAuthCookieOptions();
  return {
    httpOnly: false, 
    secure: authOptions.secure,
    sameSite: authOptions.sameSite,
    path: "/",
  };
};

// --- Action Functions ---

export const sendTokenCookie = (res, token) => {
  const options = getAuthCookieOptions();
  res.cookie("jwt", token, options);
};

export const clearTokenCookie = (res) => {
  const options = getClearAuthCookieOptions();
  res.clearCookie("jwt", options);
};