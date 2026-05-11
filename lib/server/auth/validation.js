const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;

export function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

export function isValidEmail(email) {
  return EMAIL_REGEX.test(normalizeEmail(email));
}

export function validatePassword(password) {
  if (!password || typeof password !== "string") {
    return { valid: false, message: "密码不能为空" };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, message: `密码长度至少为 ${PASSWORD_MIN_LENGTH} 个字符` };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: "密码必须包含至少一个大写字母" };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: "密码必须包含至少一个小写字母" };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: "密码必须包含至少一个数字" };
  }
  return { valid: true };
}
