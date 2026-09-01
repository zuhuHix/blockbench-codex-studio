import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function createBearerAuth(expectedToken: string): RequestHandler {
  if (expectedToken.length < 32) {
    throw new Error("Bearer token must contain at least 32 characters.");
  }

  return (request, response, next) => {
    if (request.headers.origin !== undefined) {
      response.status(403).json({ error: "Browser origins are not accepted." });
      return;
    }

    const authorization = request.headers.authorization;
    const suppliedToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";

    if (!secureEqual(suppliedToken, expectedToken)) {
      response.setHeader("WWW-Authenticate", "Bearer");
      response.status(401).json({ error: "Invalid bearer token." });
      return;
    }

    next();
  };
}
