module.exports = ({ env }) => ({
  // Local development override so forgot-password / reset-password emails
  // (and celebration/newsletter confirmation emails) can actually be sent
  // and tested end-to-end without deploying. Uses the same Brevo SMTP
  // credentials already present in Contenthub/.env for production.
  email: {
    config: {
      provider: '@strapi/provider-email-nodemailer',
      providerOptions: {
        host: 'smtp-relay.brevo.com',
        port: 587,
        secure: false, // STARTTLS on 587
        auth: {
          user: env('BREVO_SMTP_USER'),
          pass: env('BREVO_SMTP_KEY'),
        },
      },
      settings: {
        defaultFrom: env('EMAIL_DEFAULT_FROM', 'wishhappybday@gmail.com'),
        defaultReplyTo: env('EMAIL_DEFAULT_REPLY_TO', 'wishhappybday@gmail.com'),
      },
    },
  },
});
