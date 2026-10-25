export function validateVercelEnvironment(env) {
  const errors = [];
  const required = [
    "VITE_CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
    "DATABASE_URL",
    "OFFICE_MANAGER_EMAIL",
    "APP_URL",
  ];
  for (const name of required) {
    if (!env[name]?.trim()) errors.push(`${name} is required.`);
  }
  const publicKey = env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
  const serverPublicKey = env.CLERK_PUBLISHABLE_KEY?.trim();
  const secretKey = env.CLERK_SECRET_KEY?.trim();
  if (publicKey && !/^pk_(test|live)_[A-Za-z0-9=]+$/.test(publicKey)) {
    errors.push("VITE_CLERK_PUBLISHABLE_KEY is not a valid Clerk publishable key.");
  } else if (publicKey) {
    const decoded = Buffer.from(publicKey.replace(/^pk_(test|live)_/, ""), "base64").toString("utf8");
    if (!/^[a-z0-9.-]+\$$/i.test(decoded) || !decoded.includes(".")) {
      errors.push("VITE_CLERK_PUBLISHABLE_KEY must contain a valid Clerk instance domain.");
    }
  }
  if (secretKey && !/^sk_(test|live)_[A-Za-z0-9_-]+$/.test(secretKey)) {
    errors.push("CLERK_SECRET_KEY is not a valid Clerk secret key.");
  }
  if (publicKey && secretKey && publicKey.split("_")[1] !== secretKey.split("_")[1]) {
    errors.push("Clerk public and secret keys must use the same test/live environment.");
  }
  if (publicKey && serverPublicKey && publicKey !== serverPublicKey) {
    errors.push("CLERK_PUBLISHABLE_KEY and VITE_CLERK_PUBLISHABLE_KEY must match.");
  }
  if (env.VITE_CLERK_PROXY_URL?.trim()) {
    errors.push("Remove VITE_CLERK_PROXY_URL: this deployment uses independent Clerk, not the managed proxy.");
  }
  if (env.OFFICE_MANAGER_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.OFFICE_MANAGER_EMAIL.trim())) {
    errors.push("OFFICE_MANAGER_EMAIL must be a single valid email address.");
  }
  if (env.APP_URL?.trim()) {
    try {
      const url = new URL(env.APP_URL.trim());
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
        errors.push("APP_URL must be the HTTPS site origin without a path, credentials, query, or fragment.");
      }
    } catch { errors.push("APP_URL must be a valid HTTPS site origin."); }
  }
  if (env.DATABASE_URL?.trim()) {
    try {
      if (!["postgres:", "postgresql:"].includes(new URL(env.DATABASE_URL.trim()).protocol)) {
        errors.push("DATABASE_URL must be a PostgreSQL connection URL.");
      }
    } catch { errors.push("DATABASE_URL must be a valid PostgreSQL connection URL."); }
  }
  return errors;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const errors = validateVercelEnvironment(process.env);
  if (errors.length) {
    console.error("Vercel configuration is incomplete. Set these values in Vercel Environment Variables, then rebuild:");
    for (const message of errors) console.error(`- ${message}`);
    process.exitCode = 1;
  } else {
    console.log("Vercel environment validation passed. No credential values were printed.");
  }
}
