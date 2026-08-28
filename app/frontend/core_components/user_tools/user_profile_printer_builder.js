// user_profile_printer_builder.js
// Builds request bodies for the user profile and password update flows.
// Bridges form field values and endpoint_router body_data payloads.
// Exists so the request-body rules can be unit tested without DOM setup.

/**
 * sanitizeOtpCode — removes whitespace from OTP input before submission.
 * Operates between form fields and API payloads.
 * Exists to keep OTP values stable even when users paste spaced codes.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeOtpCode(value) {
    return typeof value === 'string' ? value.replace(/\s/g, '') : '';
}

/**
 * buildProfileUpdateBody — builds the profile update payload from form values.
 * Operates between profile form state and the updateUserProfile endpoint.
 * Exists so profile request-body rules can be tested independently of DOM code.
 *
 * @param {{
 *   originalUsername: string,
 *   originalEmail: string,
 *   username: string,
 *   email: string,
 *   emailOtp: unknown,
 *   currentPassword?: string,
 * }} values
 * @returns {Record<string, string>}
 */
export function buildProfileUpdateBody(values) {
    const body = {};
    const usernameChanged = values.username !== values.originalUsername;
    const emailChanged = values.email !== values.originalEmail;

    if (usernameChanged || emailChanged) {
        if (values.currentPassword) {
            body.current_password = values.currentPassword;
        }
    }

    if (usernameChanged) {
        body.username = values.username;
    }

    if (emailChanged) {
        body.email = values.email;

        const otpValue = sanitizeOtpCode(values.emailOtp);
        if (otpValue) {
            body.email_otp = otpValue;
        }
    }

    return body;
}

/**
 * buildPasswordUpdateBody — builds the password update payload from form values.
 * Operates between password form state and the updateUserProfile endpoint.
 * Exists so password request-body rules can be tested independently of DOM code.
 *
 * @param {{
 *   currentPassword: string,
 *   newPassword: string,
 *   passwordOtp: unknown,
 * }} values
 * @returns {Record<string, string>}
 */
export function buildPasswordUpdateBody(values) {
    const body = {
        current_password: values.currentPassword,
        new_password: values.newPassword,
    };

    const otpValue = sanitizeOtpCode(values.passwordOtp);
    if (otpValue) {
        body.password_otp = otpValue;
    }

    return body;
}
