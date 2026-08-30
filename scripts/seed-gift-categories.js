"use strict";

/**
 * One-off, idempotent seed script for the birthday-celebration gift catalog.
 *
 * - Grants the Public role read access (find/findOne) to the new
 *   gift-product, gift-category, blog-article and blog-category content
 *   types, mirroring how `templates`/`music` are already exposed to the
 *   birthday-celebration frontend (see scripts/seed.js for the same pattern).
 * - Seeds the "love" / "family" / "friend" gift categories (their slugs are
 *   matched 1:1 against the celebration wizard's `resolveVariant()` output)
 *   plus two example extra categories ("Luxury Gifts", "Small Gifts") to
 *   show the taxonomy isn't limited to those three.
 *
 * Safe to run multiple times: existing permissions/categories (matched by
 * action/slug) are left untouched instead of being duplicated.
 *
 * Usage: npm run seed:gift-categories
 */

const READ_ONLY_PERMISSIONS = {
  "gift-product": ["find", "findOne"],
  "gift-category": ["find", "findOne"],
  "blog-article": ["find", "findOne"],
  "blog-category": ["find", "findOne"],
};

const GIFT_CATEGORIES = [
  {
    name: "Love",
    slug: "love",
    icon: "💖",
    description: "Romantic gift ideas for a partner or spouse's birthday.",
    displayOrder: 1,
  },
  {
    name: "Family",
    slug: "family",
    icon: "👨‍👩‍👧‍👦",
    description: "Thoughtful gifts for parents, siblings and family birthdays.",
    displayOrder: 2,
  },
  {
    name: "Friend",
    slug: "friend",
    icon: "🤝",
    description: "Fun and easy gift ideas for a friend's birthday.",
    displayOrder: 3,
  },
  {
    name: "Luxury Gifts",
    slug: "luxury-gifts",
    icon: "💎",
    description: "Premium picks for a milestone birthday or someone extra special.",
    displayOrder: 4,
  },
  {
    name: "Small Gifts",
    slug: "small-gifts",
    icon: "🎀",
    description: "Budget-friendly, easy-to-ship gift ideas.",
    displayOrder: 5,
  },
];

async function setPublicPermissions(newPermissions) {
  const publicRole = await strapi.query("plugin::users-permissions.role").findOne({
    where: { type: "public" },
  });

  if (!publicRole) {
    strapi.log.warn("Could not find the Public role; skipping permission grants.");
    return;
  }

  for (const controller of Object.keys(newPermissions)) {
    for (const action of newPermissions[controller]) {
      const fullAction = `api::${controller}.${controller}.${action}`;

      const existing = await strapi.query("plugin::users-permissions.permission").findOne({
        where: { action: fullAction, role: publicRole.id },
      });

      if (existing) {
        continue;
      }

      await strapi.query("plugin::users-permissions.permission").create({
        data: { action: fullAction, role: publicRole.id },
      });
      strapi.log.info(`Granted Public role permission: ${fullAction}`);
    }
  }
}

async function seedGiftCategories() {
  const uid = "api::gift-category.gift-category";

  for (const category of GIFT_CATEGORIES) {
    // Use the lower-level query engine (not the Document Service) for the
    // existence check: it looks at the raw table directly instead of being
    // subject to draft/publish status filtering, so it reliably finds a
    // match regardless of which status the previous run created.
    const existing = await strapi.db.query(uid).findOne({
      where: { slug: category.slug },
    });

    if (existing) {
      strapi.log.info(`Gift category "${category.name}" already exists, skipping.`);
      continue;
    }

    await strapi.documents(uid).create({
      data: category,
      status: "published",
    });
    strapi.log.info(`Created gift category "${category.name}" (${category.slug}).`);
  }
}

async function main() {
  const { createStrapi, compileStrapi } = require("@strapi/strapi");

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = "info";

  try {
    await setPublicPermissions(READ_ONLY_PERMISSIONS);
    await seedGiftCategories();
    strapi.log.info("Gift category seed complete.");
  } catch (error) {
    strapi.log.error("Gift category seed failed.");
    console.error(error);
  }

  await app.destroy();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
