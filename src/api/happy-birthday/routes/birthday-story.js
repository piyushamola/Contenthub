'use strict';
const config = {
  auth: {
    scope: ['api::celebration-purchase.celebration-purchase.createOrder'],
  },
  policies: ['api::happy-birthday.story-server'],
};
module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/birthday-stories',
      handler: 'birthday-story.create',
      config,
    },
    {
      method: 'POST',
      path: '/birthday-stories/wishes/:slug',
      handler: 'birthday-story.wish',
      config,
    },
    ...['read', 'save', 'attach', 'updatePublished'].map((action) => ({
      method: 'POST',
      path: `/birthday-stories/:documentId/${action}`,
      handler: `birthday-story.${action}`,
      config,
    })),
  ],
};
