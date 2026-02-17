// Replit Auth setup - from javascript_log_in_with_replit blueprint
import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";
import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

const DEMO_AUTH_ENABLED =
  process.env.LOCAL_DEMO_AUTH === "true" ||
  process.env.REPLIT_DOMAINS === "localhost" ||
  !process.env.REPLIT_DOMAINS ||
  !process.env.REPL_ID;

const DEMO_USER_ID = "demo-user-local";
const DEMO_USER_EMAIL = "demo+nexora-local@localhost";

function buildDemoSessionUser() {
  const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  return {
    id: DEMO_USER_ID,
    claims: {
      sub: DEMO_USER_ID,
      email: DEMO_USER_EMAIL,
      first_name: "Demo",
      last_name: "User",
      profile_image_url: null,
      exp: expiresAt,
    },
    expires_at: expiresAt,
  };
}

async function ensureDemoUser() {
  const byId = await storage.getUser(DEMO_USER_ID);
  if (byId) return;

  const byEmail = await storage.getUserByEmail(DEMO_USER_EMAIL);
  if (byEmail) {
    await storage.updateUser(byEmail.id, {
      firstName: "Demo",
      lastName: "User",
      profileImageUrl: null,
    });
    return;
  }

  await storage.upsertUser({
    id: DEMO_USER_ID,
    email: DEMO_USER_EMAIL,
    firstName: "Demo",
    lastName: "User",
    profileImageUrl: null,
  });
}

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(
  claims: any,
) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

export async function setupAuth(app: Express) {
  if (DEMO_AUTH_ENABLED) {
    console.warn("⚠️ Demo auth enabled. Replit OIDC is bypassed for local development.");
    await ensureDemoUser();

    app.get("/api/login", (_req, res) => {
      res.redirect("/");
    });

    app.get("/api/callback", (_req, res) => {
      res.redirect("/");
    });

    app.get("/api/logout", (_req, res) => {
      res.redirect("/");
    });

    return;
  }

  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const claims = tokens.claims();
    if (!claims) {
      return verified(new Error("No claims in token"));
    }
    const user = {
      id: claims["sub"],
    };
    updateUserSession(user, tokens);
    await upsertUser(claims);
    verified(null, user);
  };

  for (const domain of process.env
    .REPLIT_DOMAINS!.split(",")) {
    const strategy = new Strategy(
      {
        name: `replitauth:${domain}`,
        config,
        scope: "openid email profile offline_access",
        callbackURL: `https://${domain}/api/callback`,
      },
      verify,
    );
    passport.use(strategy);
  }

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (DEMO_AUTH_ENABLED) {
    try {
      await ensureDemoUser();
      req.user = buildDemoSessionUser() as any;
      return next();
    } catch (error) {
      console.error("Failed to provision demo user:", error);
      return res.status(500).json({ message: "Demo auth initialization failed" });
    }
  }

  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
