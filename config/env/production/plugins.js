module.exports = ({ env }) => ({
  // email: {
  //   config: {
  //     provider: "@strapi/provider-email-nodemailer",
  //     providerOptions: {
  //       host: "smtp-relay.brevo.com", // Brevo SMTP gateway
  //       port: 587, // use 465 if you need SSL-only
  //       secure: false, // STARTTLS on 587
  //       auth: {
  //         user: env("BREVO_SMTP_USER"), // usually same as your login email
  //         pass: env("BREVO_SMTP_KEY"), // your SMTP key
  //       },
  //     },
  //     settings: {
  //       defaultFrom: env("EMAIL_DEFAULT_FROM"),
  //       defaultReplyTo: env("EMAIL_DEFAULT_REPLY_TO"),
  //     },
  //   },
  // },
  email: {
    config: {
      settings: {
        // Format: "Sender Name <sender-email@domain.com>"
        defaultFrom: "wishhappybday@gmail.com",
        // Format: "Reply Name <reply-email@domain.com>" or "reply-email@domain.com"
        defaultReplyTo: "wishhappybday@gmail.com",
      },
    },
  },
});
