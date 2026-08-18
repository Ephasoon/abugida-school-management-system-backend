// src/utils/response.js
// ============================================================
// Standardizes all API responses so every endpoint returns
// data in the same consistent format.
//
// Every response looks like this:
//   { success: true,  data: {...},  message: "..." }   ← success
//   { success: false, error: "...", message: "..." }   ← failure
// ============================================================

/**
 * Send a success response.
 * @param {object} res      - Express response object
 * @param {any}    data     - The data to return
 * @param {string} message  - Human-readable success message
 * @param {number} status   - HTTP status code (default 200)
 */
const sendSuccess = (res, data = null, message = 'Success', status = 200) => {
  return res.status(status).json({
    success: true,
    message,
    data,
  });
};

/**
 * Send an error response.
 * @param {object} res     - Express response object
 * @param {string} message - Human-readable error message
 * @param {number} status  - HTTP status code (default 400)
 * @param {any}    errors  - Optional extra error details
 */
const sendError = (res, message = 'Something went wrong', status = 400, errors = null) => {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(status).json(body);
};

module.exports = { sendSuccess, sendError };
