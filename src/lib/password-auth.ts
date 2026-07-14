import { compare } from "bcryptjs";

const DUMMY_PASSWORD_HASH = "$2b$12$5P3MOwUu1mkhrOn6Bt9R8etsWXlVRiTry2UyxGJL10DuiX8tvLKP6";

export async function verifyPasswordCredential(
  password: string,
  passwordHash: string | null | undefined,
) {
  const matches = await compare(password, passwordHash ?? DUMMY_PASSWORD_HASH);
  return Boolean(passwordHash) && matches;
}
