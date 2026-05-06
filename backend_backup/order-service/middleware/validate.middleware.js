import { ZodError } from "zod";

export const validate = (schema) => (req, res, next) => {
  try {
    schema.parse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    next();
  } catch (err) {
    // Zod exposes validation details on `issues` (not always `errors`).
    if (err instanceof ZodError) {
      const extractedErrors = err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));

      return res.status(400).json({
        message: "Invalid request data",
        errors: extractedErrors,
      });
    }

    // If this wasn't a validation error (e.g. schema is misconfigured), bubble it up.
    return next(err);
  }
};
