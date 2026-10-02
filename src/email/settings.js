'use strict';

const REPLY_TO = 'wishhappybday@gmail.com';

function applyAuthReplyTo(settings) {
  let changed = false;
  for (const key of ['email_confirmation', 'reset_password']) {
    const options = settings[key]?.options;
    if (options && options.response_email !== REPLY_TO) {
      options.response_email = REPLY_TO;
      changed = true;
    }
  }
  return changed;
}

module.exports = { REPLY_TO, applyAuthReplyTo };
