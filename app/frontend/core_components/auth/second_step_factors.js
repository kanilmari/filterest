// second_step_factors.js
// Describes the copy, format and secondary actions of each sign-in code field.
// Connects standalone/modal controllers to the shared second-step renderer.
// Exists so future profile and setup mounts can reuse the same field contract.
const common = {
    step: 'verification_step', heading: 'verification_heading', primary: 'verification_sign_in',
    maxCodeLength: 6, empty: 'verification_code_empty', label: 'verification_code_label',
    attributes: { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', minlength: '6', maxlength: '32', pattern: '[0-9]{6}' },
};
const deliveredAttributes = {
    type: 'text', inputmode: 'text', autocomplete: 'one-time-code', minlength: '9', maxlength: '32',
    pattern: '[A-Za-z0-9]{9}', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false',
};
export const SECOND_STEP_FACTORS = Object.freeze({
    fixed_pin: {
        ...common, instruction: 'verification_pin_instruction', label: 'verification_pin_label',
        hint: 'verification_pin_hint', error: 'verification_pin_error', empty: 'verification_pin_empty',
        format: 'verification_pin_format', reveal: true, maxCodeLength: 8,
        helpAction: 'verification_pin_help_action', help: 'verification_pin_help',
        attributes: {
            type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', minlength: '4', maxlength: '32',
            pattern: '[0-9]{4,8}', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false',
        },
    },
    totp: {
        ...common, instruction: 'verification_totp_instruction', hint: 'verification_totp_hint',
        error: 'verification_totp_error', format: 'verification_totp_format',
        helpAction: 'verification_totp_help_action', help: 'verification_totp_help',
    },
    email: {
        ...common, instruction: 'verification_email_instruction', hint: 'verification_email_hint',
        error: 'verification_email_error', format: 'verification_email_format',
        attributes: deliveredAttributes, resend: true, recipient: true, maxCodeLength: 9,
    },
    recovery: {
        ...common, step: 'reset_step', heading: 'reset_heading', instruction: 'password_reset_send_attempted',
        label: 'reset_code_label', hint: 'reset_code_hint', error: 'reset_code_error', empty: 'reset_code_empty',
        format: 'verification_email_format', primary: 'reset_password', maxCodeLength: 9, attributes: deliveredAttributes, resend: true,
    },
});
