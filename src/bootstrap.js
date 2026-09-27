"use strict";

const fs = require("fs-extra");
const path = require("path");
const mime = require("mime-types");
const {
  categories,
  authors,
  articles,
  global,
  about,
} = require("../data/data.json");

const CELEBRATION_EMAIL_FROM = "Wish Happy Bday <wishhappybday@gmail.com>";
const CELEBRATION_EMAIL_SUBJECT = "Your birthday celebration is ready";
const CELEBRATION_SITE_ORIGIN = "https://www.wishhappybdayto.me";

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getEmailService = () =>
  strapi.plugin?.("email")?.service("email") ||
  strapi.plugins?.email?.services?.email;

const sendWelcomeEmail = async (email, name) => {
  try {
    const emailService = getEmailService();
    if (emailService) {
      await emailService.send({
        to: email,
        subject: "Thanks for subscribing!",
        text: `Hi ${name || ""},\n\nThank you for subscribing to Time Pass!`,
        html: `<p>Hi ${name || ""},</p>
               <p>Thank you for subscribing to Time Pass! We'll keep you updated with our latest news.</p>
               <p>— The Team</p>`,
      });
      strapi.log.info(`Welcome email sent to ${email}`);
    } else {
      strapi.log.error(
        "Email plugin service not found. Make sure @strapi/plugin-email is installed and configured.",
      );
    }
  } catch (err) {
    strapi.log.error("Error sending welcome email:", err);
  }
};

const sendCelebrationCreatedEmail = async ({
  hostemail,
  hostname,
  personname,
  customroute,
}) => {
  const emailService = getEmailService();
  if (!emailService) {
    strapi.log.error(
      "Celebration confirmation email was not sent: email plugin service is unavailable.",
    );
    return;
  }

  const celebrationUrl = `${CELEBRATION_SITE_ORIGIN}/${encodeURIComponent(
    customroute,
  )}`;
  const safeHostName = escapeHtml(hostname);
  const safePersonName = escapeHtml(personname);

  try {
    await emailService.send({
      to: hostemail,
      from: CELEBRATION_EMAIL_FROM,
      replyTo: CELEBRATION_EMAIL_FROM,
      subject: CELEBRATION_EMAIL_SUBJECT,
      text: `Hi ${hostname},\n\nYour celebration for ${personname} has been created successfully.\n\nView and share it here: ${celebrationUrl}`,
      html: `<p>Hi ${safeHostName},</p>
<p>Your celebration for <strong>${safePersonName}</strong> has been created successfully.</p>
<p><a href="${celebrationUrl}">View celebration</a></p>`,
    });
    strapi.log.info(
      `Celebration confirmation email sent for route "${customroute}".`,
    );
  } catch (error) {
    // A notification failure must not roll back a celebration that is already created.
    strapi.log.error(
      `Celebration confirmation email failed for route "${customroute}":`,
      error,
    );
  }
};

async function seedExampleApp() {
  const shouldImportSeedData = await isFirstRun();

  if (shouldImportSeedData) {
    try {
      console.log("Setting up the template...");
      await importSeedData();
      console.log("Ready to go");
    } catch (error) {
      console.log("Could not import seed data");
      console.error(error);
    }
  } else {
    console.log(
      "Seed data has already been imported. We cannot reimport unless you clear your database first.",
    );
  }
}

async function isFirstRun() {
  const pluginStore = strapi.store({
    environment: strapi.config.environment,
    type: "type",
    name: "setup",
  });
  const initHasRun = await pluginStore.get({ key: "initHasRun" });
  await pluginStore.set({ key: "initHasRun", value: true });
  return !initHasRun;
}

/**
 * Creates a custom "Admin" users-permissions role (distinct from Strapi's
 * own Admin Panel users/roles) the first time the app boots. It starts as a
 * clone of the "Authenticated" role's permissions so admin users keep every
 * capability a normal logged-in user has; admin-only dashboard endpoints are
 * additionally gated in code via the `is-admin` / `is-owner-or-admin`
 * policies, which check `role.type === "admin"` directly.
 *
 * Promote a specific user to this role from:
 * Strapi Admin Panel -> Users & Permissions -> Users -> select user -> Role.
 */
async function ensureAdminRole() {
  const existingAdminRole = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'admin' } });
  if (existingAdminRole) return;

  const authenticatedRole = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'authenticated' } });

  const adminRole = await strapi.query('plugin::users-permissions.role').create({
    data: {
      name: 'Admin',
      description:
        'Can view, pause, and delete every celebration across all users in the WishHappyBday dashboard.',
      type: 'admin',
    },
  });

  if (!authenticatedRole) return;

  const authenticatedPermissions = await strapi
    .query('plugin::users-permissions.permission')
    .findMany({ where: { role: authenticatedRole.id } });

  await Promise.all(
    authenticatedPermissions.map((permission) =>
      strapi.query('plugin::users-permissions.permission').create({
        data: { action: permission.action, role: adminRole.id },
      }),
    ),
  );

  strapi.log.info(
    'Created the "Admin" users-permissions role. Assign it to trusted users from the Strapi admin panel.',
  );
}

/**
 * Strapi's users-permissions plugin blocks every custom controller action
 * for a role until a matching `plugin::users-permissions.permission` row
 * exists for it — this check happens before our own `is-owner-or-admin` /
 * `is-admin` policies ever run. Grants here are the "can this role call this
 * route at all" layer; the policies remain the "does this specific record
 * belong to this specific user" layer. Idempotent: safe to run every boot.
 */
async function ensureRolePermissions(roleType, controller, actions) {
  const role = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: roleType } });
  if (!role) return;

  for (const action of actions) {
    const actionName = `api::${controller}.${controller}.${action}`;
    const existing = await strapi
      .query('plugin::users-permissions.permission')
      .findOne({ where: { action: actionName, role: role.id } });
    if (existing) continue;

    await strapi.query('plugin::users-permissions.permission').create({
      data: { action: actionName, role: role.id },
    });
  }
}

/**
 * Strapi's /api/auth/forgot-password endpoint does not accept a redirect URL
 * per request — it always links to the single URL configured here (plugin
 * store, same value shown in the admin panel under Settings -> Users &
 * Permissions Plugin -> Advanced Settings -> "Reset password page"). Only
 * sets it when empty so a value configured by hand (e.g. for production) is
 * never overwritten.
 */
async function ensureResetPasswordPageUrl() {
  const store = strapi.store({
    type: 'plugin',
    name: 'users-permissions',
    key: 'advanced',
  });
  const settings = await store.get();
  if (settings?.email_reset_password) return;

  await store.set({
    value: {
      ...settings,
      email_reset_password:
        process.env.FRONTEND_RESET_PASSWORD_URL ||
        'http://localhost:3000/reset-password',
    },
  });
  strapi.log.info(
    'Set the users-permissions "Reset password page" URL for local development. Update it in the Strapi admin panel before deploying to production.',
  );
}

/**
 * Strapi's Google provider only requests the `email` scope by default,
 * which means Google never returns the person's name — every Google
 * sign-up then falls back to an email-derived username with no real display
 * name. Requesting `profile` too (Google's standard scope for basic profile
 * info: name, picture) fixes this at the source. Idempotent and safe to run
 * even before Google credentials are configured.
 */
async function ensureGoogleOAuthScope() {
  const store = strapi.store({
    type: 'plugin',
    name: 'users-permissions',
    key: 'grant',
  });
  const grant = await store.get();
  if (!grant?.google) return;

  const currentScope = Array.isArray(grant.google.scope) ? grant.google.scope : [];
  const hasProfile = currentScope.includes('profile');
  if (hasProfile) return;

  await store.set({
    value: { ...grant, google: { ...grant.google, scope: [...currentScope, 'profile'] } },
  });
  strapi.log.info('Added the "profile" scope to the Google OAuth provider so sign-ups get a real name.');
}

/**
 * The built-in Google provider's `authCallback` (in
 * @strapi/plugin-users-permissions/server/src/services/providers-registry.js)
 * calls Google's token-introspection endpoint (`/tokeninfo`), which only
 * ever returns `email` + `email_verified` — never a name, no matter which
 * OAuth scopes are granted. It hard-codes `username: body.email.split('@')[0]`.
 * That is the actual reason Google sign-ups never got a real display name,
 * not the scope alone (`ensureGoogleOAuthScope` above is still needed so
 * Google agrees to grant profile info at all).
 *
 * This overrides just that one provider's `authCallback` to call Google's
 * real userinfo endpoint instead, which does return `name` when the
 * `profile` scope was granted, and uses it as the new user's username (the
 * best available "display name" for a first-time Google sign-up — the user
 * can still rename themselves afterwards from /dashboard).
 */
async function ensureGoogleProfileAuthCallback() {
  const providersRegistry = strapi.plugin('users-permissions').service('providers-registry');
  const existing = providersRegistry.get('google') || {};

  providersRegistry.add('google', {
    ...existing,
    enabled: true,
    icon: 'google',
    grantConfig: {
      ...(existing.grantConfig || {}),
      scope: ['email', 'profile'],
    },
    async authCallback({ accessToken }) {
      const response = await fetch(
        `https://openidconnect.googleapis.com/v1/userinfo?access_token=${encodeURIComponent(accessToken)}`,
      );
      const body = await response.json().catch(() => ({}));

      if (!response.ok || !body.email) {
        throw new Error('Email was not available from Google');
      }
      if (body.email_verified === false) {
        throw new Error('Email not verified by Google');
      }

      const name = typeof body.name === 'string' ? body.name.trim() : '';
      return {
        username: name || body.email.split('@')[0],
        email: body.email,
      };
    },
  });
}

async function ensureDashboardPermissions() {
  // Any logged-in user can call these; the `is-owner-or-admin` policy
  // restricts each one to the caller's own celebrations (or an admin).
  await ensureRolePermissions('authenticated', 'happy-birthday', [
    'mine',
    'pause',
    'resume',
    'deleteCelebration',
  ]);
  // The custom Admin role additionally gets the "every celebration" view.
  await ensureRolePermissions('admin', 'happy-birthday', [
    'mine',
    'pause',
    'resume',
    'deleteCelebration',
    'all',
  ]);
}

async function setPublicPermissions(newPermissions) {
  // Find the ID of the public role
  const publicRole = await strapi
    .query("plugin::users-permissions.role")
    .findOne({
      where: {
        type: "public",
      },
    });

  // Create the new permissions and link them to the public role
  const allPermissionsToCreate = [];
  Object.keys(newPermissions).map((controller) => {
    const actions = newPermissions[controller];
    const permissionsToCreate = actions.map((action) => {
      return strapi.query("plugin::users-permissions.permission").create({
        data: {
          action: `api::${controller}.${controller}.${action}`,
          role: publicRole.id,
        },
      });
    });
    allPermissionsToCreate.push(...permissionsToCreate);
  });
  await Promise.all(allPermissionsToCreate);
}

function getFileSizeInBytes(filePath) {
  const stats = fs.statSync(filePath);
  const fileSizeInBytes = stats["size"];
  return fileSizeInBytes;
}

function getFileData(fileName) {
  const filePath = path.join("data", "uploads", fileName);
  // Parse the file metadata
  const size = getFileSizeInBytes(filePath);
  const ext = fileName.split(".").pop();
  const mimeType = mime.lookup(ext || "") || "";

  return {
    filepath: filePath,
    originalFileName: fileName,
    size,
    mimetype: mimeType,
  };
}

async function uploadFile(file, name) {
  return strapi
    .plugin("upload")
    .service("upload")
    .upload({
      files: file,
      data: {
        fileInfo: {
          alternativeText: `An image uploaded to Strapi called ${name}`,
          caption: name,
          name,
        },
      },
    });
}

// Create an entry and attach files if there are any
async function createEntry({ model, entry }) {
  try {
    // Actually create the entry in Strapi
    await strapi.documents(`api::${model}.${model}`).create({
      data: entry,
    });
  } catch (error) {
    console.error({ model, entry, error });
  }
}

async function checkFileExistsBeforeUpload(files) {
  const existingFiles = [];
  const uploadedFiles = [];
  const filesCopy = [...files];

  for (const fileName of filesCopy) {
    // Check if the file already exists in Strapi
    const fileWhereName = await strapi.query("plugin::upload.file").findOne({
      where: {
        name: fileName.replace(/\..*$/, ""),
      },
    });

    if (fileWhereName) {
      // File exists, don't upload it
      existingFiles.push(fileWhereName);
    } else {
      // File doesn't exist, upload it
      const fileData = getFileData(fileName);
      const fileNameNoExtension = fileName.split(".").shift();
      const [file] = await uploadFile(fileData, fileNameNoExtension);
      uploadedFiles.push(file);
    }
  }
  const allFiles = [...existingFiles, ...uploadedFiles];
  // If only one file then return only that file
  return allFiles.length === 1 ? allFiles[0] : allFiles;
}

async function updateBlocks(blocks) {
  const updatedBlocks = [];
  for (const block of blocks) {
    if (block.__component === "shared.media") {
      const uploadedFiles = await checkFileExistsBeforeUpload([block.file]);
      // Copy the block to not mutate directly
      const blockCopy = { ...block };
      // Replace the file name on the block with the actual file
      blockCopy.file = uploadedFiles;
      updatedBlocks.push(blockCopy);
    } else if (block.__component === "shared.slider") {
      // Get files already uploaded to Strapi or upload new files
      const existingAndUploadedFiles = await checkFileExistsBeforeUpload(
        block.files,
      );
      // Copy the block to not mutate directly
      const blockCopy = { ...block };
      // Replace the file names on the block with the actual files
      blockCopy.files = existingAndUploadedFiles;
      // Push the updated block
      updatedBlocks.push(blockCopy);
    } else {
      // Just push the block as is
      updatedBlocks.push(block);
    }
  }

  return updatedBlocks;
}

async function importArticles() {
  for (const article of articles) {
    const cover = await checkFileExistsBeforeUpload([`${article.slug}.jpg`]);
    const updatedBlocks = await updateBlocks(article.blocks);

    await createEntry({
      model: "article",
      entry: {
        ...article,
        cover,
        blocks: updatedBlocks,
        // Make sure it's not a draft
        publishedAt: Date.now(),
      },
    });
  }
}

async function importGlobal() {
  const favicon = await checkFileExistsBeforeUpload(["favicon.png"]);
  const shareImage = await checkFileExistsBeforeUpload(["default-image.png"]);
  return createEntry({
    model: "global",
    entry: {
      ...global,
      favicon,
      // Make sure it's not a draft
      publishedAt: Date.now(),
      defaultSeo: {
        ...global.defaultSeo,
        shareImage,
      },
    },
  });
}

async function importAbout() {
  const updatedBlocks = await updateBlocks(about.blocks);

  await createEntry({
    model: "about",
    entry: {
      ...about,
      blocks: updatedBlocks,
      // Make sure it's not a draft
      publishedAt: Date.now(),
    },
  });
}

async function importCategories() {
  for (const category of categories) {
    await createEntry({ model: "category", entry: category });
  }
}

async function importAuthors() {
  for (const author of authors) {
    const avatar = await checkFileExistsBeforeUpload([author.avatar]);

    await createEntry({
      model: "author",
      entry: {
        ...author,
        avatar,
      },
    });
  }
}

async function importSeedData() {
  // Allow read of application content types
  await setPublicPermissions({
    article: ["find", "findOne"],
    category: ["find", "findOne"],
    author: ["find", "findOne"],
    global: ["find", "findOne"],
    about: ["find", "findOne"],
  });

  // Create all entries
  await importCategories();
  await importAuthors();
  await importArticles();
  await importGlobal();
  await importAbout();
}

async function main() {
  const { createStrapi, compileStrapi } = require("@strapi/strapi");

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = "error";

  await seedExampleApp();
  await app.destroy();

  process.exit(0);
}

// --- START: Modified module.exports ---
module.exports = async ({ strapi }) => {
  // Run your existing seed data function
  await seedExampleApp();

  await ensureAdminRole();
  await ensureDashboardPermissions();
  await ensureResetPasswordPageUrl();
  await ensureGoogleOAuthScope();
  await ensureGoogleProfileAuthCallback();

  // Register the lifecycle hook for newsletter-subscriber
  strapi.db.lifecycles.subscribe({
    models: ["api::newsletter-subscriber.newsletter-subscriber"], // IMPORTANT: Verify this UID
    async afterCreate(event) {
      const { result } = event; // The newly created subscriber entry

      // Ensure the email and name fields exist on your content type
      if (result && result.email) {
        await sendWelcomeEmail(result.email, result.name);
      } else {
        strapi.log.warn(
          "Newsletter subscriber created without email. Skipping welcome email.",
          result,
        );
      }
    },
  });

  strapi.db.lifecycles.subscribe({
    models: ["api::happy-birthday.happy-birthday"],
    async afterCreate(event) {
      const { result } = event;

      if (
        !result?.hostemail ||
        !result?.hostname ||
        !result?.personname ||
        !result?.customroute
      ) {
        strapi.log.warn(
          "Celebration created without the fields needed for a confirmation email. Skipping notification.",
        );
        return;
      }

      await sendCelebrationCreatedEmail(result);
    },
  });
};
