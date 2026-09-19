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
